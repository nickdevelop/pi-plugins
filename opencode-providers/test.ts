/**
 * Tests for the OpenCode Console provider pack.
 *
 *   node --experimental-strip-types --no-warnings test.ts           # mocked console API
 *   LIVE=1 OPENCODE_CONSOLE_TOKEN=oc_sk_... node --experimental-strip-types --no-warnings test.ts
 *
 * The mocked run pins the cache outside the home directory so it never touches
 * the real Pi cache file.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { ANTHROPIC_DETAIL, ANTHROPIC_SUMMARY, COMMAND_CODE_DETAIL, DEFAULT_DETAILS, installMockFetch, OPENCODE_DETAIL, PROVIDER_LIST } from "./fixtures.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-occ-"));
process.env.OPENCODE_CONSOLE_TOKEN = "oc_sk_test_token";
delete process.env.OPENCODE_CONSOLE_ONLY;
delete process.env.OPENCODE_CONSOLE_SKIP;
delete process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER;
delete process.env.OPENCODE_CONSOLE_INCLUDE_BUILTIN;

const { default: extension } = await import("./index.ts");

interface Registration {
	connId: string;
	config: ProviderConfig;
}

function makeFakePi(): { pi: ExtensionAPI; registrations: Map<string, Registration>; commands: Map<string, unknown> } {
	const registrations = new Map<string, Registration>();
	const commands = new Map<string, unknown>();
	const pi = {
		registerProvider(id: string, config: ProviderConfig) {
			registrations.set(id, { connId: config.name ?? id, config });
		},
		unregisterProvider(id: string) {
			registrations.delete(id);
		},
		registerCommand(name: string, options: unknown) {
			commands.set(name, options);
		},
		on() {},
	} as unknown as ExtensionAPI;
	return { pi, registrations, commands };
}

/** Chat models of a registration; the pack only ever registers chat models (`reasoning` is chat-only). */
type ChatModel = Extract<ProviderModelConfig, { reasoning: boolean }>;

function modelsOf(config: ProviderConfig): ChatModel[] {
	return (config.models ?? []) as ChatModel[];
}

/** Minimal ExtensionContext for command handlers, collecting ui.notify output. */
function makeCtx(fake: ReturnType<typeof makeFakePi>, notices: Array<{ message: string; level: string | undefined }>) {
	return {
		signal: AbortSignal.timeout(5000),
		ui: { notify: (message: string, level?: string) => notices.push({ message, level }) },
		modelRegistry: {
			getAll: () =>
				[...fake.registrations].flatMap(([id, entry]) => modelsOf(entry.config).map((model) => ({ provider: id, ...model }))),
		},
	} as never;
}

type OpenCodeCommand = { handler: (args: string, ctx: never) => Promise<void> };

function commandOf(fake: ReturnType<typeof makeFakePi>): OpenCodeCommand {
	return fake.commands.get("opencode") as OpenCodeCommand;
}

/** Registered connection providers, ignoring the model-less `/login` anchor. */
function connectionsOf(fake: ReturnType<typeof makeFakePi>): string[] {
	return [...fake.registrations.keys()].filter((id) => id !== "opencode-console").sort();
}

/** Fresh agent dir per case, so nobody reads another case's catalog cache or auth.json. */
function freshAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-occ-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}

/** Load the extension into a fresh agent dir (cache-less: startup never fetches, so this
 *registers Nathan only the login anchor when a cache is missing). Optional dir keeps the cache. */
async function loadRaw(dir: string = freshAgentDir()): Promise<ReturnType<typeof makeFakePi>> {
	process.env.PI_CODING_AGENT_DIR = dir;
	const fake = makeFakePi();
	await extension(fake.pi);
	return fake;
}

/** Load + warm the catalog cache with one `/opencode refresh` (the runtime network path). */
async function load(dir: string = freshAgentDir()): Promise<ReturnType<typeof makeFakePi>> {
	const fake = await loadRaw(dir);
	const notices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(fake).handler("refresh", makeCtx(fake, notices));
	return fake;
}

// ---------------------------------------------------------------------------
// 1. Catalog mapping
// ---------------------------------------------------------------------------

installMockFetch({ details: DEFAULT_DETAILS });
// OpenCode's own connection only has free-tier models, which are hidden by default (case 2a),
// so register them here to exercise the full field mapping.
process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER = "0";
const run = await load();

assert.deepEqual(connectionsOf(run), ["occ-command-code", "occ-opencode"], "one provider per enabled connection");
assert.equal(run.registrations.get("opencode-console")?.config.oauth, run.registrations.get("occ-opencode")?.config.oauth, "connections share the anchor's sign-in method");
assert.equal(run.registrations.get("occ-command-code")?.config.name, "command code", "display name comes from connection.name");
assert.equal(run.registrations.get("occ-opencode")?.config.name, "OpenCode");

for (const config of [...run.registrations.values()].map((entry) => entry.config)) {
	if (config.api === undefined) continue; // the login anchor does not stream anything
	assert.equal(config.api, "openai-completions", "oa-compat streams through openai-completions");
	assert.equal(config.apiKey, "$OPENCODE_CONSOLE_TOKEN", "token stays in the environment");
	assert.match(String(config.baseUrl), /^https:\/\/opencode\.ai\/inference\/(custom\/conn_|openai\/v1)$|\/inference\/custom\/conn_/, "requests target the Console proxy");
}

const commandCode = modelsOf(run.registrations.get("occ-command-code")!.config);
assert.deepEqual(
	commandCode.map((model) => model.id),
	["deepseek/deepseek-v4.1-flash", "gpt-6-luna", "longcontext/model", "inclusionai/ling-3.1-flash:free"],
	"only enabled, available, non-deprecated models are registered",
);

const longContext = commandCode.find((model) => model.id === "longcontext/model")!;
assert.deepEqual(
	longContext.cost,
	{
		input: 1,
		output: 2,
		cacheRead: 0.1,
		cacheWrite: 0,
		tiers: [{ inputTokensAbove: 278528, input: 2, output: 4, cacheRead: 0.2, cacheWrite: 0 }],
	},
	"request-wide Console cost tiers map to pi cost.tiers",
);

const gpt = commandCode.find((model) => model.id === "gpt-6-luna")!;
assert.equal(gpt.name, "GPT-6 Luna");
assert.equal(gpt.reasoning, true, "capabilities.reasoning maps to pi reasoning");
assert.equal(gpt.contextWindow, 1_050_000, "limits.context maps to contextWindow");
assert.equal(gpt.maxTokens, 128_000, "limits.output maps to maxTokens");
assert.deepEqual(gpt.input, ["text", "image"], "unsupported input modalities are dropped");
assert.deepEqual(gpt.cost, { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.04 }, "base cost tier maps 1:1");

const deepseek = commandCode.find((model) => model.id === "deepseek/deepseek-v4.1-flash")!;
assert.equal(deepseek.reasoning, false);
assert.equal(deepseek.maxTokens, 32_000, "missing limits.output falls back to the default output ceiling");
assert.equal(deepseek.cost.cacheWrite, 0, "absent cacheWrite defaults to 0");

// ---------------------------------------------------------------------------
// 2. Filters
// ---------------------------------------------------------------------------

// 2a. The default hides free-tier models: OpenCode serves them to its own app only, so in Pi
// every request would fail with FreeTierError.
delete process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER;
const defaultRun = await load();
assert.equal(defaultRun.registrations.get("occ-opencode"), undefined, "free-tier-only connection disappears by default");
{
	const notices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(defaultRun).handler("status", makeCtx(defaultRun, notices));
	assert.ok(notices.some((notice) => /free tier: 1 OpenCode "-free" model\(s\) hidden.*no provider for: OpenCode/.test(notice.message)), "/opencode status explains the hidden free-tier models");
	assert.ok(notices.every((notice) => !/no usable enabled models|only free-tier/.test(notice.message)), "hiding free-tier models is expected and never warns at startup");
}
process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER = "0";

process.env.OPENCODE_CONSOLE_INCLUDE_BUILTIN = "0";
const noBuiltin = await load();
assert.deepEqual(connectionsOf(noBuiltin), ["occ-command-code"], "builtIn connections can be skipped");
delete process.env.OPENCODE_CONSOLE_INCLUDE_BUILTIN;

process.env.OPENCODE_CONSOLE_ONLY = "command code";
const only = await load();
assert.deepEqual(connectionsOf(only), ["occ-command-code"], "OPENCODE_CONSOLE_ONLY filters by name");
delete process.env.OPENCODE_CONSOLE_ONLY;

process.env.OPENCODE_CONSOLE_PREFIX = "off";
const bare = await load();
assert.deepEqual(connectionsOf(bare), ["command-code", "opencode"], 'prefix "off" uses the plain name');
delete process.env.OPENCODE_CONSOLE_PREFIX;

// ---------------------------------------------------------------------------
// 3. Failure isolation and catalog refresh
// ---------------------------------------------------------------------------

installMockFetch({ list: PROVIDER_LIST, details: { conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode: OPENCODE_DETAIL } });
const partial = await load();
assert.deepEqual(connectionsOf(partial), ["occ-opencode"], "a connection whose detail request fails is skipped, others still load");

// Both details served again -> the provider set converges on reload.
installMockFetch({ details: DEFAULT_DETAILS });
const recovered = await load();
assert.deepEqual(connectionsOf(recovered), ["occ-command-code", "occ-opencode"], "recovered connection is registered again");

// refreshModels must serve the cached model list without any network request: only /login and
// /opencode refresh are allowed to call the console, even when the network has moved on.
const refresh = run.registrations.get("occ-command-code")!.config.refreshModels!;
const movedMock = installMockFetch({ list: [], details: {} }); // a different world on the network
const refreshed = (await refresh({ signal: AbortSignal.timeout(5000), allowNetwork: true, publish: async () => true })) as ProviderModelConfig[];
assert.deepEqual(
	refreshed.map((model) => model.id),
	["deepseek/deepseek-v4.1-flash", "gpt-6-luna", "longcontext/model", "inclusionai/ling-3.1-flash:free"],
	"refreshModels returns the cached model list",
);
assert.equal(movedMock.requests.length, 0, "refreshModels is network-free");

// A connection that is genuinely empty still warns, so real problems are not silenced with the
// expected free-tier case.
{
	const emptyDetail = { ...COMMAND_CODE_DETAIL, models: [] };
	installMockFetch({ details: { conn_01M34AFH6R8YY5RDEJA5MSEHXD: emptyDetail, conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode: OPENCODE_DETAIL } });
	const emptyRun = await loadRaw();
	const notices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(emptyRun).handler("refresh", makeCtx(emptyRun, notices));
	assert.ok(notices.some((notice) => /command code: no usable enabled models/.test(notice.message)), "a truly empty connection still warns");
}

// ---------------------------------------------------------------------------
// 3b. Anthropic connections: the console serves the Messages shape at `<base>/messages` while pi's
// client calls `<base>/v1/messages` (which the proxy forwards to a doubled upstream path -> 404).
// The pack rewrites its own anthropic requests; with the shim disabled it explains the fix.
// ---------------------------------------------------------------------------

{
	const mock = installMockFetch({ list: [ANTHROPIC_SUMMARY], details: { conn_anthropic_trap: ANTHROPIC_DETAIL } });
	const notices: Array<{ message: string; level: string | undefined }> = [];

	const fixed = await loadRaw();
	await commandOf(fixed).handler("refresh", makeCtx(fixed, notices));
	assert.ok(notices.every((notice) => !/\/v1/.test(notice.message)), "no warning while the path adaptation is active");

	await commandOf(fixed).handler("probe", makeCtx(fixed, notices));
	const probed = mock.requests.find((url) => url.includes("/messages"));
	assert.equal(probed, "https://opencode.ai/inference/custom/conn_anthropic_trap/messages", "outgoing anthropic request uses the console path");

	process.env.OPENCODE_CONSOLE_PATH_SHIM = "0";
	const raw = await loadRaw();
	const rawNotices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(raw).handler("refresh", makeCtx(raw, rawNotices));
	assert.ok(
		rawNotices.some((notice) => /\/v1\/messages[\s\S]*remove the trailing \/v1 from "https:\/\/api\.example\.test\/provider\/v1"/.test(notice.message)),
		"with the shim off, the doubled /v1 trap is reported with the exact fix",
	);
	const rawMock = installMockFetch({ list: [ANTHROPIC_SUMMARY], details: { conn_anthropic_trap: ANTHROPIC_DETAIL } });
	await commandOf(raw).handler("probe", makeCtx(raw, rawNotices));
	assert.ok(
		rawMock.requests.some((url) => url.endsWith("/v1/messages")),
		"with the shim off the request keeps pi's original path",
	);
	delete process.env.OPENCODE_CONSOLE_PATH_SHIM;
}

// ---------------------------------------------------------------------------
// 4. The /opencode command drives the same sync path at runtime
// ---------------------------------------------------------------------------

{
	installMockFetch({ details: DEFAULT_DETAILS });
	const fake = await load();

	const notices: Array<{ message: string; level: string | undefined }> = [];
	const ctx = makeCtx(fake, notices);
	const command = commandOf(fake);

	await command.handler("list", ctx);
	assert.match(notices.at(-1)!.message, /occ-command-code\s+← conn_01M34AFH6R8YY5RDEJA5MSEHXD/, "/opencode list shows id -> connection");

	await command.handler("models occ-command-code", ctx);
	assert.match(notices.at(-1)!.message, /occ-command-code\/gpt-6-luna/, "/opencode models filters by provider");

	await command.handler("refresh", ctx);
	assert.ok(
		notices.some((notice) => /2 providers \/ 5 models/.test(notice.message)),
		"/opencode refresh reports the synced catalog",
	);
	assert.ok(
		notices.some((notice) => /"-free" model\(s\) registered/.test(notice.message)),
		"/opencode refresh surfaces the free-tier warning",
	);
	assert.equal(fake.registrations.size, 3, "refresh keeps both providers plus the login anchor");

	await command.handler("status", ctx);
	assert.ok(notices.some((notice) => /free tier: "-free" models registered/.test(notice.message)), "/opencode status says when free-tier models are registered");
}

// 4b. With the default settings the same refresh hides free-tier models instead of warning.
{
	delete process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER;
	installMockFetch({ details: DEFAULT_DETAILS });
	const fake = await load();
	const notices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(fake).handler("refresh", makeCtx(fake, notices));
	const kept = modelsOf(fake.registrations.get("occ-command-code")!.config).map((model) => model.id);
	assert.ok(kept.includes("inclusionai/ling-3.1-flash:free"), 'a vendor ":free" model stays registered: zero cost is not OpenCode\'s free tier');
	assert.ok(!kept.some((id) => /-free$/i.test(id)), "only OpenCode's own `-free` models are hidden");
	assert.ok(notices.some((notice) => /1 providers \/ 4 models/.test(notice.message)), 'OpenCode "-free" models are not registered by default');
	await commandOf(fake).handler("status", makeCtx(fake, notices));
	assert.ok(notices.some((notice) => /free tier: 1 OpenCode "-free" model\(s\) hidden/.test(notice.message)), "/opencode status explains the hidden free-tier models");
	process.env.OPENCODE_CONSOLE_SKIP_FREE_TIER = "0";
}

// ---------------------------------------------------------------------------
// 5. Without a token only the sign-in anchor is registered
// ---------------------------------------------------------------------------

delete process.env.OPENCODE_CONSOLE_TOKEN;
const tokenless = await load();
assert.deepEqual([...tokenless.registrations.keys()], ["opencode-console"], "no connections without a token, but the /login anchor is there");
const anchor = tokenless.registrations.get("opencode-console")!.config;
assert.equal(anchor.models, undefined, "the anchor carries no models");
assert.ok(anchor.oauth, "the anchor carries a /login method");
assert.equal(tokenless.commands.has("opencode"), true, "the /opencode command still registers");

// ---------------------------------------------------------------------------
// 6. /login: one pasted token signs in every connection
// ---------------------------------------------------------------------------

{
	installMockFetch({ details: DEFAULT_DETAILS });
	const fake = await loadRaw();
	const method = fake.registrations.get("opencode-console")!.config.oauth!;

	const progress: string[] = [];
	const credentials: OAuthCredentials = await method.login({
		onPrompt: async () => "  oc_sk_from_login  ",
		onProgress: (message: string) => progress.push(message),
		signal: AbortSignal.timeout(5000),
	} as unknown as OAuthLoginCallbacks);

	assert.equal(credentials.access, "oc_sk_from_login", "the trimmed token is what Pi stores");
	assert.equal(method.getApiKey(credentials), "oc_sk_from_login", "getApiKey hands the stored token back to Pi");
	assert.ok(await method.refreshToken(credentials, AbortSignal.timeout(1000)) === credentials, "console tokens do not rotate");
	assert.ok(progress.some((message) => /token accepted: \d+ connection/.test(message)), "login reports verification against the console");

	assert.deepEqual(
		connectionsOf(fake),
		["occ-command-code", "occ-opencode"],
		"connections are registered by the login itself, in the same session",
	);
	assert.equal(fake.registrations.get("occ-command-code")!.config.apiKey, "oc_sk_from_login", "signed-in providers use the literal token");
	assert.ok(fake.registrations.get("occ-command-code")!.config.oauth, "every provider offers the same /login method");

	// A bad token never reaches registration.
	installMockFetch({ list: { error: "unauthorized" }, details: DEFAULT_DETAILS });
	await assert.rejects(
		() =>
			method.login({
				onPrompt: async () => "oc_sk_bogus",
				signal: AbortSignal.timeout(5000),
			} as unknown as OAuthLoginCallbacks),
		/HTTP|failed/,
		"an invalid token fails the login",
	);
}

// ---------------------------------------------------------------------------
// 7. A token stored by an earlier /login bootstraps the next run
// ---------------------------------------------------------------------------

{
	installMockFetch({ details: DEFAULT_DETAILS });
	const dir = mkdtempSync(join(tmpdir(), "pi-occ-"));
	writeFileSync(join(dir, "auth.json"), JSON.stringify({ "opencode-console": { type: "oauth", access: "oc_sk_saved", refresh: "", expires: 0 } }));

	// First run with only a stored credential: it is authorized to warm up once via /opencode
	// refresh, which also builds the cache for every run after it.
	const resumed = await loadRaw(dir);
	await commandOf(resumed).handler("refresh", makeCtx(resumed, []));
	assert.deepEqual(
		connectionsOf(resumed),
		["occ-command-code", "occ-opencode"],
		"the stored credential is read back, no env token needed",
	);
	assert.equal(resumed.registrations.get("occ-opencode")!.config.apiKey, "oc_sk_saved", "the stored token authorizes requests");

	// Next run: pure cache + stored token. Startup must not touch the network at all — even if the
	// console would fail or change.
	const untouched = installMockFetch({ list: [], details: {} }); // the network has moved on
	const again = makeFakePi();
	await extension(again.pi);
	assert.deepEqual(
		connectionsOf(again),
		["occ-command-code", "occ-opencode"],
		"the next startup registers from the cache, no network requests",
	);
	assert.equal(again.registrations.get("occ-opencode")!.config.apiKey, "oc_sk_saved", "startup still uses the stored token");
	assert.equal(untouched.requests.length, 0, "startup made zero console API requests");
}

process.env.OPENCODE_CONSOLE_TOKEN = "oc_sk_test_token";

// ---------------------------------------------------------------------------
// 8. Catalog reads are cache-first: only /login and /opencode refresh go to the network
// ---------------------------------------------------------------------------
{
	installMockFetch({ details: DEFAULT_DETAILS });

	// First run with a token but without a cache: startup must not fetch anything.
	const cold = await loadRaw();
	assert.deepEqual(connectionsOf(cold), [], "startup with a token but no cache registers nothing — and fetches nothing");
	const coldNotices: Array<{ message: string; level: string | undefined }> = [];
	await commandOf(cold).handler("status", makeCtx(cold, coldNotices));
	assert.ok(coldNotices.some((notice) => /no cached OpenCode catalog yet/.test(notice.message)), "the missing cache explains how to build it");

	// One refresh warms the cache; the next startup then serves it, even when the console changed.
	const dir = freshAgentDir();
	await load(dir);
	const changed = installMockFetch({ list: [ANTHROPIC_SUMMARY], details: { conn_anthropic_trap: ANTHROPIC_DETAIL } }); // a different world on the network
	const resumed = await loadRaw(dir);
	assert.deepEqual(connectionsOf(resumed), ["occ-command-code", "occ-opencode"], "startup serves the cached catalog even though the network has changed");
	assert.equal(changed.requests.length, 0, "startup made zero console API requests");

	const refresh = resumed.registrations.get("occ-command-code")!.config.refreshModels!;
	const refreshed = (await refresh({ signal: AbortSignal.timeout(5000), allowNetwork: true, publish: async () => true })) as ProviderModelConfig[];
	assert.ok(refreshed.some((model) => model.id === "gpt-6-luna"), "refreshModels also serves the cache after the network changed");
	assert.equal(changed.requests.length, 0, "refreshModels made zero console API requests");

	// /opencode refresh is the escape hatch: it re-reads the network and the cache follows.
	await commandOf(resumed).handler("refresh", makeCtx(resumed, []));
	assert.deepEqual(connectionsOf(resumed), ["occ-anthropic-trap"], "/opencode refresh re-reads the network and re-registers");

	const after = installMockFetch({ list: [], details: {} });
	const synced = await loadRaw(dir);
	assert.deepEqual(connectionsOf(synced), ["occ-anthropic-trap"], "the refreshed catalog is what the next startup reads from the cache");
	assert.equal(after.requests.length, 0, "still no startup network requests");
}

// ---------------------------------------------------------------------------
// 6. Optional live check against the real Console API
// ---------------------------------------------------------------------------

if (process.env.LIVE) {
	delete process.env.PI_CODING_AGENT_DIR;
	const live = await load();
	assert.ok(live.registrations.size > 1, "live console returned no connections");
	for (const [id, { config }] of live.registrations) {
		if (id === "opencode-console") continue;
		assert.ok(modelsOf(config).length > 0, `${id} registered without models`);
		assert.ok(modelsOf(config).every((model) => model.contextWindow > 0 && model.maxTokens > 0));
	}
	console.log(`live: registered ${[...live.registrations.keys()].join(", ")}`);
}

console.log("ok: all OpenCode Console provider assertions passed");
