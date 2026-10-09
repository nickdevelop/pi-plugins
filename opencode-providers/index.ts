/**
 * OpenCode Console provider pack.
 *
 * One extension, many providers: it reads the OpenCode Console connection list
 * (`GET /console/api/providers`), then the model catalog of every connection
 * (`GET /console/api/providers/{conn_id}`), and registers each enabled connection as its own Pi
 * provider with only its `enabled: true` models.
 *
 * Sign-in: the pack registers a fixed anchor provider (`opencode-console`) that owns the `/login`
 * entry, so a console token is pasted once and stored by Pi in `~/.pi/agent/auth.json`. Every
 * connection provider carries the same sign-in method, and `OPENCODE_CONSOLE_TOKEN` stays
 * supported; Pi itself prefers a stored credential and falls back to the configured API key.
 *
 * Requests are delegated to Pi's built-in `openai-completions` implementation, because every
 * Console connection is served through an OpenAI-compatible inference proxy (`requestBaseUrl`).
 *
 * Configuration (environment):
 *   OPENCODE_CONSOLE_TOKEN        console + inference token (or sign in with /login)
 *   OPENCODE_CONSOLE_TOKEN_FILE   read the token from this file instead
 *   OPENCODE_CONSOLE_API          console API base (default https://opencode.ai/console/api)
 *   OPENCODE_CONSOLE_PREFIX       provider id prefix (default "occ", "off" disables)
 *   OPENCODE_CONSOLE_ONLY         comma separated names / ids to keep
 *   OPENCODE_CONSOLE_SKIP         comma separated names / ids to drop
 *   OPENCODE_CONSOLE_INCLUDE_BUILTIN  "0" skips connections marked builtIn (default keep)
 *   OPENCODE_CONSOLE_SKIP_FREE_TIER   hide OpenCode's app-only "-free" models (default "1"; "0"
                                     registers them anyway; vendor ":free" models are always kept)
 *   OPENCODE_CONSOLE_TTL_MS       catalog cache lifetime (default 900000)
 *   OPENCODE_CONSOLE_TIMEOUT_MS   per-request timeout (default 10000)
 *   OPENCODE_CONSOLE_MAX_OUTPUT   output ceiling when a model omits limits.output
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Console API shapes (only the fields this pack reads)
// =============================================================================

interface ConsoleAuth {
	mode?: string;
	headerName?: string;
	headerPattern?: string;
}

interface ConsoleProviderSummary {
	id: string;
	configKey?: string;
	name: string;
	builtIn?: boolean;
	enabled?: boolean;
	providerSchema?: string;
	baseUrl?: string;
	auth?: ConsoleAuth | null;
	modelCount?: number;
	enabledModelCount?: number;
}

interface ConsoleProviderDetail extends ConsoleProviderSummary {
	requestBaseUrl?: string;
	models?: ConsoleModelEntry[];
}

interface CostTier {
	type?: string;
	/** Request-wide threshold in tokens for this tier. */
	size?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

interface ConsoleModelEntry {
	modelId: string;
	apiId?: string;
	name?: string;
	status?: string | null;
	enabled?: boolean;
	available?: boolean;
	capabilities?: {
		toolCall?: boolean;
		reasoning?: boolean;
		attachment?: boolean;
		temperature?: boolean;
		inputTypes?: string[];
		outputTypes?: string[];
	};
	limits?: { context?: number; input?: number; output?: number };
	costTiers?: CostTier[];
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_API_BASE = "https://opencode.ai/console/api";
const DEFAULT_PREFIX = "occ";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT = 32_000;

/**
 * Anchor provider that owns the pack's `/login` entry.
 *
 * Connection providers are discovered from the console API, so none can exist before a token is
 * known. This fixed provider carries the sign-in method; Pi stores the pasted token for it in
 * `~/.pi/agent/auth.json`, which every later run reads back.
 */
const LOGIN_HOST_ID = "opencode-console";
const LOGIN_HOST_NAME = "OpenCode Console";
/** Console tokens do not rotate, so keep the stored credential far from any expiry check. */
const CREDENTIAL_TTL_MS = 3650 * 24 * 60 * 60 * 1000;

interface Config {
	apiBase: string;
	/** Token from the environment only; `/login` credentials are resolved separately. */
	envToken: string | undefined;
	/** Env variable the token came from, so Pi can resolve `$NAME` at request time. */
	tokenVar: string | undefined;
	providerPrefix: string;
	only: string[];
	skip: string[];
	includeBuiltin: boolean;
	skipFreeTier: boolean;
	ttlMs: number;
	timeoutMs: number;
	defaultMaxOutput: number;
	cachePath: string;
	authPath: string;
	offline: boolean;
	/** Rewrite Pi's `<base>/v1/messages` to the console's `<base>/messages` for anthropic connections. */
	pathShim: boolean;
}

function envValue(name: string): string | undefined {
	const value = process.env[name];
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function listValue(name: string): string[] {
	return (envValue(name) ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function numberValue(name: string, fallback: number): number {
	const parsed = Number(envValue(name));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readTokenFile(path: string | undefined): string | undefined {
	if (!path) return undefined;
	try {
		return readFileSync(path, "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Pi's agent directory (`$PI_CODING_AGENT_DIR`, else `~/.pi/agent`). Resolved locally so this file
 * also runs without Pi's module map, and the catalog cache lands next to Pi's own cache.
 */
function agentDir(): string {
	const override = envValue("PI_CODING_AGENT_DIR");
	if (override) return override.replace(/^~(?=$|\/)/, homedir());
	return join(homedir(), ".pi", "agent");
}

function readConfig(): Config {
	const tokenVar = envValue("OPENCODE_CONSOLE_TOKEN") ? "OPENCODE_CONSOLE_TOKEN" : envValue("OPENCODE_TOKEN") ? "OPENCODE_TOKEN" : undefined;
	const envToken = tokenVar ? envValue(tokenVar) : readTokenFile(envValue("OPENCODE_CONSOLE_TOKEN_FILE"));
	const prefixSetting = (envValue("OPENCODE_CONSOLE_PREFIX") ?? DEFAULT_PREFIX).toLowerCase();
	const apiBase = envValue("OPENCODE_CONSOLE_API") ?? envValue("OPENCODE_CONSOLE_API_URL") ?? DEFAULT_API_BASE;

	return {
		apiBase: apiBase.replace(/\/+$/, ""),
		envToken,
		tokenVar,
		providerPrefix: prefixSetting === "off" || prefixSetting === "none" || prefixSetting === "" ? "" : `${slugifySegment(prefixSetting.replace(/[_\s]+/g, "-"))}-`,
		only: listValue("OPENCODE_CONSOLE_ONLY"),
		skip: listValue("OPENCODE_CONSOLE_SKIP"),
		includeBuiltin: envValue("OPENCODE_CONSOLE_INCLUDE_BUILTIN") !== "0",
		skipFreeTier: envValue("OPENCODE_CONSOLE_SKIP_FREE_TIER") !== "0",
		ttlMs: numberValue("OPENCODE_CONSOLE_TTL_MS", DEFAULT_TTL_MS),
		timeoutMs: numberValue("OPENCODE_CONSOLE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
		defaultMaxOutput: numberValue("OPENCODE_CONSOLE_MAX_OUTPUT", DEFAULT_MAX_OUTPUT),
		cachePath: join(agentDir(), "cache", "opencode-providers.json"),
		authPath: join(agentDir(), "auth.json"),
		pathShim: envValue("OPENCODE_CONSOLE_PATH_SHIM") !== "0",
		offline: process.env.PI_OFFLINE !== undefined && process.env.PI_OFFLINE !== "",
	};
}

/**
 * Tokens stored by `/login`, read straight from `auth.json`.
 *
 * Pi holds a file lock only while writing, so a plain read is safe; a locked or partial read is
 * treated as "nobody is signed in". Never log the returned values.
 */
function readStoredTokens(authPath: string): Map<string, string> {
	const tokens = new Map<string, string>();
	try {
		const stored = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { access?: string; key?: string }>;
		for (const [providerId, credential] of Object.entries(stored ?? {})) {
			const token = (credential?.access ?? credential?.key)?.trim();
			if (token) tokens.set(providerId, token);
		}
	} catch {
		// No auth.json yet, or an unreadable file: nobody is signed in.
	}
	return tokens;
}

// =============================================================================
// Console API client
// =============================================================================

async function requestJson<T>(cfg: Config, token: string, path: string, signal?: AbortSignal): Promise<T> {
	const timeout = AbortSignal.timeout(cfg.timeoutMs);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

	let response: Response;
	try {
		response = await fetch(`${cfg.apiBase}${path}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			signal: combined,
		});
	} catch (error) {
		throw new Error(`OpenCode Console request failed (${path}): ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!response.ok) {
		const detail = response.status === 401 || response.status === 403 ? "the token was rejected" : await safeBodyText(response);
		throw new Error(`OpenCode Console ${path} -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
	}
	return (await response.json()) as T;
}

async function safeBodyText(response: Response): Promise<string> {
	try {
		return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 180);
	} catch {
		return "";
	}
}

function listProviders(cfg: Config, token: string, signal?: AbortSignal): Promise<ConsoleProviderSummary[]> {
	return requestJson<ConsoleProviderSummary[]>(cfg, token, "/providers", signal);
}

function fetchProviderDetail(cfg: Config, token: string, connId: string, signal?: AbortSignal): Promise<ConsoleProviderDetail> {
	return requestJson<ConsoleProviderDetail>(cfg, token, `/providers/${encodeURIComponent(connId)}`, signal);
}

async function mapLimited<A, B>(items: A[], limit: number, fn: (item: A) => Promise<B>): Promise<(B | undefined)[]> {
	const results: (B | undefined)[] = new Array(items.length);
	let cursor = 0;
	const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			try {
				results[index] = await fn(items[index]);
			} catch {
				results[index] = undefined; // the caller reports the failure and keeps any cached copy
			}
		}
	});
	await Promise.all(workers);
	return results;
}

// =============================================================================
// Catalog cache (fast startup, offline fallback)
// =============================================================================

interface CacheFile {
	savedAt: number;
	connections: ConsoleProviderDetail[];
}

function readCache(cfg: Config): CacheFile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(cfg.cachePath, "utf8")) as CacheFile;
		if (!Array.isArray(parsed?.connections) || typeof parsed.savedAt !== "number") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function writeCache(cfg: Config, connections: ConsoleProviderDetail[]): void {
	try {
		mkdirSync(dirname(cfg.cachePath), { recursive: true });
		writeFileSync(cfg.cachePath, JSON.stringify({ savedAt: Date.now(), connections } satisfies CacheFile));
	} catch {
		// The cache is an optimization; never fail startup because of it.
	}
}

// =============================================================================
// Conversion: Console catalog -> Pi model definitions
// =============================================================================

const API_BY_SCHEMA: Record<string, string> = {
	"oa-compat": "openai-completions",
	openai: "openai-completions",
	"openai-completions": "openai-completions",
	"oa-responses": "openai-responses",
	"openai-responses": "openai-responses",
	anthropic: "anthropic-messages",
	claude: "anthropic-messages",
	"anthropic-messages": "anthropic-messages",
};

function apiForSchema(schema: string | undefined): { api: string; warning?: string } {
	const api = API_BY_SCHEMA[(schema ?? "oa-compat").toLowerCase()];
	if (api) return { api };
	return { api: "openai-completions", warning: `unknown providerSchema "${schema}"; streaming as openai-completions` };
}

function slugifySegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

function providerIdFor(cfg: Config, detail: ConsoleProviderDetail, taken: Set<string>): string {
	const base = slugifySegment(detail.name) || slugifySegment(detail.configKey ?? "") || "conn";
	const preferred = `${cfg.providerPrefix}${base}`;
	let unique = preferred;
	let suffix = 2;
	while (taken.has(unique) || unique === LOGIN_HOST_ID) unique = `${preferred}-${suffix++}`;
	return unique;
}

/** The Console proxy exposes a per-connection OpenAI-compatible endpoint. */
function requestBaseUrlFor(detail: ConsoleProviderDetail): string | undefined {
	return (detail.requestBaseUrl ?? detail.baseUrl)?.replace(/\/+$/, "");
}

/**
 * Console proxy path arithmetic: `requestBaseUrl + <client path>` is forwarded verbatim onto the
 * connection's own `baseUrl`. Its Anthropic endpoints live at `<base>/messages`, while Pi's
 * Anthropic client (the vendor SDK) always calls `<base>/v1/messages`, so requests land on
 * `<upstream>/v1/messages` — doubled when the console Base URL already ends in `/v1` — and the
 * proxy answers `404 Not found. Check the docs for available routes.`
 *
 * The console URL shape is what OpenCode's own client expects, so the console side is not wrong;
 * the fix is to rewrite this pack's own Anthropic requests back to `/messages`.
 */
function consoleMessagesPath(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/messages`;
}

interface FetchShim {
	(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
	__opencodeConsoleShim?: boolean;
}

/**
 * Redirect `<base>/v1/messages` to `<base>/messages` for the console endpoints given, and touch
 * nothing else. Installed once over the global fetch, which Pi's provider clients all use.
 */
function installAnthropicPathShim(bases: string[]): void {
	const current = globalThis.fetch as unknown as FetchShim | undefined;
	if (!current || current.__opencodeConsoleShim) return;
	const targets = () => stateAnthropicBases;
	const shim = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request)?.url ?? "";
		for (const base of targets()) {
			const from = `${base.replace(/\/+$/, "")}/v1/messages`;
			if (!url.startsWith(from)) continue;
			const target = url.replace(from, consoleMessagesPath(base));
			if (typeof input === "string") return current(target, init);
			if (input instanceof URL) return current(new URL(target), init);
			return current(new Request(target, input as Request), init); // keep method/headers/body
		}
		return current(input, init);
	}) as unknown as FetchShim;
	shim.__opencodeConsoleShim = true;
	globalThis.fetch = shim as unknown as typeof fetch;
}

/** Bases whose Anthropic requests need the `/messages` rewrite; filled by syncProviders. */
let stateAnthropicBases: string[] = [];

/**
 * OpenCode's own app-only free tier: those models carry a `-free` suffix and the inference proxy
 * refuses them outside the OpenCode app (`403 FreeTierError: OpenCode's free tier can only be used
 * from within OpenCode`).
 *
 * Price is deliberately not a signal. A vendor free model on a custom connection, e.g.
 * `inclusionai/ling-3.1-flash:free`, also reports zero costTiers yet answers 200 through the same
 * proxy, so hiding by price removes models that work. Only OpenCode's own naming is trusted.
 */
function isAppOnlyFreeTier(entry: ConsoleModelEntry): boolean {
	return /-free$/i.test(entry.modelId) || /-free$/i.test(entry.apiId ?? "");
}

function convertCost(tiers: CostTier[] | undefined): ProviderModelConfig["cost"] {
	const sorted = [...(tiers ?? [])].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
	const base = sorted[0];
	const cost: ProviderModelConfig["cost"] = {
		input: base?.input ?? 0,
		output: base?.output ?? 0,
		cacheRead: base?.cacheRead ?? 0,
		cacheWrite: base?.cacheWrite ?? 0,
	};

	// Extra Console tiers describe request-wide price steps; Pi models the same concept with
	// `cost.tiers[].inputTokensAbove`.
	const steps = sorted
		.slice(1)
		.filter((tier) => typeof tier.size === "number" && tier.size > 0)
		.map((tier) => ({
			inputTokensAbove: tier.size as number,
			input: tier.input ?? cost.input,
			output: tier.output ?? cost.output,
			cacheRead: tier.cacheRead ?? cost.cacheRead,
			cacheWrite: tier.cacheWrite ?? cost.cacheWrite,
		}));
	if (steps.length > 0) cost.tiers = steps;
	return cost;
}

function convertModel(entry: ConsoleModelEntry, api: string, cfg: Config): ChatModelConfig | undefined {
	const id = (entry.apiId ?? entry.modelId)?.trim();
	if (!id) return undefined;

	const context = entry.limits?.context ?? 0;
	if (context <= 0) return undefined; // Pi needs a context window to size compaction

	const capabilities = entry.capabilities ?? {};
	const input: ("text" | "image")[] = ["text"];
	if ((capabilities.inputTypes ?? []).includes("image")) input.push("image");

	return {
		type: "chat",
		id,
		name: entry.name?.trim() || id,
		api: api as ChatModelConfig["api"],
		reasoning: capabilities.reasoning === true,
		input,
		cost: convertCost(entry.costTiers),
		contextWindow: context,
		maxTokens: Math.min(entry.limits?.output ?? cfg.defaultMaxOutput, Math.max(1, context - 1)),
	};
}

function convertConnection(
	detail: ConsoleProviderDetail,
	cfg: Config,
	report: (message: string) => void,
	anthropicBases: string[],
): { models: ChatModelConfig[]; api: string; baseUrl: string; hiddenFreeTier: number } | undefined {
	const baseUrl = requestBaseUrlFor(detail);
	if (!baseUrl) {
		report(`${detail.name}: no request endpoint (requestBaseUrl/baseUrl missing), skipped`);
		return undefined;
	}

	const { api, warning } = apiForSchema(detail.providerSchema);
	if (warning) report(`${detail.name}: ${warning}`);
	if (api === "anthropic-messages") {
		if (cfg.pathShim) anthropicBases.push(baseUrl);
		else if (/\/v\d+$/i.test((detail.baseUrl ?? "").replace(/\/+$/, ""))) {
			const upstream = (detail.baseUrl ?? "").replace(/\/+$/, "");
			report(`${detail.name}: pi calls <base>/v1/messages but the console serves ${baseUrl}/messages — set OPENCODE_CONSOLE_PATH_SHIM=0 aside, remove the trailing /v1 from "${upstream}" (currently ${upstream}/v1/messages -> 404)`);
		}
	}

	const models: ChatModelConfig[] = [];
	const seen = new Set<string>();
	let freeModels = 0;
	for (const entry of detail.models ?? []) {
		if (entry.enabled !== true) continue; // requirement: enabled models only
		if (entry.available === false) continue;
		if (/deprecat/i.test(entry.status ?? "")) continue;
		if (isAppOnlyFreeTier(entry)) {
			freeModels++;
			if (cfg.skipFreeTier) continue;
		}

		const model = convertModel(entry, api, cfg);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}

	if (freeModels > 0 && !cfg.skipFreeTier) {
		report(`${detail.name}: ${freeModels} "-free" model(s) registered; OpenCode serves its own free tier to its app only, so requests fail with FreeTierError`);
	}
	// Hiding free-tier models is the default, so a connection left with nothing is expected and
	// stays quiet; /opencode status reports it. Anything else is worth a warning.
	if (models.length === 0 && !(freeModels > 0 && cfg.skipFreeTier)) {
		report(`${detail.name}: no usable enabled models`);
	}
	return { models, api, baseUrl, hiddenFreeTier: cfg.skipFreeTier ? freeModels : 0 };
}

// =============================================================================
// Registration and sign-in
// =============================================================================

/** Only chat models are registered; the union's image/classifier variants lack `reasoning`. */
type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>;

interface State {
	registered: Map<string, string>; // provider id -> conn id
	modelTotal: number;
	notes: string[];
	lastSync: string;
	/** Token pasted into `/login` during this run, so sibling providers can share it. */
	sessionToken: string | undefined;
	/** Last event context, used to resolve and select a model after `/login`. */
	ctx: ExtensionContext | undefined;
	/** What the last sync registered, in preference order for the auto-select. */
	candidates: ModelCandidate[];
	/** OpenCode `-free` models hidden by the last sync (their requests fail with FreeTierError). */
	hiddenFreeTier: number;
	/** Connections that registered nothing because only `-free` models were available. */
	hiddenConnections: string[];
	/** Where each registered provider's requests actually go, for `/opencode probe`. */
	endpoints: Map<string, { baseUrl: string; api: string }>;
}

interface ModelCandidate {
	provider: string;
	id: string;
	reasoning: boolean;
	builtIn: boolean;
}

interface Resolver {
	/**
	 * Token precedence for catalog reads and request auth: environment, then the credential Pi
	 * stored in `auth.json` (anchor first, then any provider of this pack — one console token
	 * serves every connection), then a token pasted into `/login` during this run.
	 */
	(cfg: Config, state: State): { token: string; apiKey: string; source: string } | undefined;
}

const resolveToken: Resolver = (cfg, state) => {
	if (cfg.envToken) {
		// Pi resolves `$NAME` at request time, so a rotated env token needs no reload.
		return { token: cfg.envToken, apiKey: cfg.tokenVar ? `$${cfg.tokenVar}` : cfg.envToken, source: "env" };
	}

	const stored = readStoredTokens(cfg.authPath);
	const anchor = stored.get(LOGIN_HOST_ID);
	if (anchor) return { token: anchor, apiKey: anchor, source: `auth.json (${LOGIN_HOST_ID})` };
	if (state.sessionToken) return { token: state.sessionToken, apiKey: state.sessionToken, source: "login (this session)" };
	for (const connId of state.registered.values()) {
		const token = stored.get(connId);
		if (token) return { token, apiKey: token, source: `auth.json (${connId})` };
	}
	for (const [providerId, token] of stored) {
		if (cfg.providerPrefix && providerId.startsWith(cfg.providerPrefix)) return { token, apiKey: token, source: `auth.json (${providerId})` };
	}
	return undefined;
};

/**
 * One-token round trip against a registered provider, addressed exactly the way Pi addresses it,
 * so a console misconfiguration surfaces as a real HTTP status instead of a failed turn.
 */
async function probeEndpoint(cfg: Config, token: string, endpoint: { baseUrl: string; api: string }, modelId: string): Promise<string> {
	const anthropic = endpoint.api === "anthropic-messages";
	const url = `${endpoint.baseUrl}${anthropic ? "/v1/messages" : "/chat/completions"}`;
	const body = JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
	const headers: Record<string, string> = {
		"content-type": "application/json",
		authorization: `Bearer ${token}`,
	};
	if (anthropic) headers["anthropic-version"] = "2023-06-01";
	try {
		const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
		const text = await safeBodyText(response);
		const doubled = response.status === 404 && /\/v\d+\/v\d+|not a registered/i.test(text);
		const hint = doubled ? " | hint: drop the trailing /v1 from this connection's Base URL in the console" : "";
		return `${response.status} ${url}${response.ok ? " ok" : ` :: ${text}${hint}`}`;
	} catch (error) {
		return `error ${url}: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function matchesSelector(detail: ConsoleProviderDetail, selectors: string[]): boolean {
	if (selectors.length === 0) return false;
	const haystack = [detail.id, detail.configKey, detail.name].filter(Boolean).map((value) => String(value).toLowerCase());
	return selectors.some((selector) => haystack.some((value) => value === selector || value.includes(selector)));
}

function isWanted(detail: ConsoleProviderDetail, cfg: Config): boolean {
	if (!detail.enabled) return false;
	if (!cfg.includeBuiltin && detail.builtIn) return false;
	if (cfg.only.length > 0 && !matchesSelector(detail, cfg.only)) return false;
	if (matchesSelector(detail, cfg.skip)) return false;
	return true;
}

async function loadConnections(
	cfg: Config,
	state: State,
	token: string,
	signal?: AbortSignal,
): Promise<{ connections: ConsoleProviderDetail[]; source: string }> {
	void state;
	const cache = readCache(cfg);

	if (cfg.offline) {
		if (cache) return { connections: cache.connections, source: "cache (offline)" };
		throw new Error("offline and no cached OpenCode catalog");
	}

	if (!signal && cache && Date.now() - cache.savedAt < cfg.ttlMs) {
		return { connections: cache.connections, source: `cache (${Math.round((Date.now() - cache.savedAt) / 1000)}s old)` };
	}

	const summaries = await listProviders(cfg, token, signal);
	const wanted = summaries.filter((summary) => summary.enabled !== false);
	const details = await mapLimited(wanted, 4, (summary) => fetchProviderDetail(cfg, token, summary.id, signal));

	const connections: ConsoleProviderDetail[] = [];
	const cachedByConn = new Map((cache?.connections ?? []).map((entry) => [entry.id, entry]));
	wanted.forEach((summary, index) => {
		const detail = details[index];
		if (detail) connections.push(detail);
		else if (!signal) {
			const fallback = cachedByConn.get(summary.id);
			if (fallback) connections.push(fallback);
		}
	});

	if (connections.length === 0) throw new Error(`OpenCode Console returned no usable connections (${wanted.length} listed)`);
	if (!signal) writeCache(cfg, connections);
	return { connections, source: "console api" };
}

function syncProviders(
	pi: ExtensionAPI,
	cfg: Config,
	state: State,
	connections: ConsoleProviderDetail[],
	apiKey: string,
	login: ProviderConfig["oauth"],
	source: string,
): string {
	const taken = new Set<string>();
	let hiddenFreeTier = 0;
	const hiddenConnections: string[] = [];
	const collectedAnthropicBases: string[] = [];
	const wanted = new Map<string, { connId: string; models: number; builtIn: boolean; endpoint: { baseUrl: string; api: string }; modelsList: { id: string; reasoning: boolean }[] }>();

	for (const detail of connections) {
		if (!isWanted(detail, cfg)) continue;
		const converted = convertConnection(detail, cfg, (message) => state.notes.push(message), collectedAnthropicBases);
		if (!converted) continue;
		hiddenFreeTier += converted.hiddenFreeTier; // counted even when nothing else was usable
		if (converted.models.length === 0) {
			if (converted.hiddenFreeTier > 0) hiddenConnections.push(detail.name);
			continue;
		}

		const id = providerIdFor(cfg, detail, taken);
		taken.add(id);
		wanted.set(id, {
			connId: detail.id,
			models: converted.models.length,
			builtIn: detail.builtIn === true,
			endpoint: { baseUrl: converted.baseUrl, api: converted.api },
			modelsList: converted.models.map((model) => ({ id: model.id, reasoning: model.reasoning })),
		});

		pi.registerProvider(id, {
			name: detail.name,
			baseUrl: converted.baseUrl,
			api: converted.api as ProviderConfig["api"],
			apiKey,
			// Same sign-in method as the anchor, so `/login` on this provider works too and the
			// token is stored for it. Pi prefers that credential over the API key fallback.
			oauth: login,
			models: converted.models,
			// /model refresh and `pi list --models`: re-read this one connection.
			refreshModels: async (context) => {
				const signal = context?.signal;
				if (signal?.aborted) throw new Error("aborted");
				const auth = resolveToken(cfg, state);
				if (!auth) throw new Error(`opencode-providers: not signed in for ${detail.name} (run /login)`);
				const fresh = await fetchProviderDetail(cfg, auth.token, detail.id, signal);
				const current = convertConnection(fresh, cfg, () => {}, []);
				if (!current) throw new Error(`opencode-providers: ${detail.name} has no usable enabled models`);
				return current.models;
			},
		} satisfies ProviderConfig);
	}

	for (const [id, connId] of state.registered) {
		if (!wanted.has(id)) {
			pi.unregisterProvider(id);
			state.notes.push(`unregistered "${id}" (connection ${connId} is gone or disabled)`);
		}
	}

	state.registered = new Map([...wanted].map(([id, entry]) => [id, entry.connId]));
	state.modelTotal = [...wanted.values()].reduce((total, entry) => total + entry.models, 0);
	state.candidates = [...wanted].flatMap(([id, entry]) => entry.modelsList.map((model) => ({ ...model, provider: id, builtIn: entry.builtIn })));
	state.endpoints = new Map([...wanted].map(([id, entry]) => [id, entry.endpoint]));
	state.hiddenFreeTier = hiddenFreeTier;
	state.hiddenConnections = hiddenConnections;
	stateAnthropicBases = collectedAnthropicBases;
	if (cfg.pathShim && collectedAnthropicBases.length > 0) installAnthropicPathShim(collectedAnthropicBases);
	state.lastSync = `${new Date().toISOString()} (${source})`;
	return `${wanted.size} providers / ${state.modelTotal} models from ${source}`;
}

/** Best model to adopt right after sign-in: a user-added connection first, then one that thinks. */
function preferredCandidate(state: State): ModelCandidate | undefined {
	return state.candidates.find((c) => !c.builtIn && c.reasoning) ?? state.candidates.find((c) => !c.builtIn) ?? state.candidates[0];
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function (pi: ExtensionAPI): Promise<void> {
	const cfg = readConfig();
	const state: State = { registered: new Map(), modelTotal: 0, notes: [], lastSync: "never", sessionToken: undefined, ctx: undefined, candidates: [], hiddenFreeTier: 0, hiddenConnections: [], endpoints: new Map() };

	/** Fetch the catalog with the best available token and (re-)register every connection. */
	async function syncNow(signal?: AbortSignal, tokenOverride?: string): Promise<string> {
		const auth = tokenOverride ? { token: tokenOverride, apiKey: tokenOverride, source: "login" } : resolveToken(cfg, state);
		if (!auth) {
			state.notes.push(`opencode-providers: not signed in — run /login and pick "${LOGIN_HOST_NAME}", or set OPENCODE_CONSOLE_TOKEN`);
			return "not signed in";
		}
		const { connections, source } = await loadConnections(cfg, state, auth.token, signal);
		return syncProviders(pi, cfg, state, connections, auth.apiKey, login, `${source}, ${auth.source}`);
	}

	/**
	 * One sign-in method shared by the anchor and every connection provider: paste the console
	 * token, verify it, register the catalog immediately, and hand the credential to Pi for
	 * storage in `auth.json`.
	 */
	const login = {
		name: `${LOGIN_HOST_NAME} (console token)`,
		/** Console tokens are long-lived static secrets; there is nothing to rotate. */
		async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
			return credentials;
		},
		getApiKey(credentials: OAuthCredentials): string {
			return String(credentials.access ?? "");
		},
		async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
			const entered = await callbacks.onPrompt({
				message: "Paste your OpenCode console token (opencode.ai/console, looks like oc_sk_...)",
				placeholder: "oc_sk_...",
			});
			const token = String(entered ?? "").trim();
			if (!token) throw new Error("no token entered");

			callbacks.onProgress?.("verifying token against opencode.ai ...");
			const listed = await listProviders(cfg, token, callbacks.signal);
			callbacks.onProgress?.(`token accepted: ${listed.length} connection(s), loading catalogs ...`);

			state.sessionToken = token;
			const summary = await syncNow(callbacks.signal, token);
			callbacks.onProgress?.(`signed in — ${summary}`);

			// Pi has no default model for this provider, so adopt one itself: logged in means usable.
			const candidate = preferredCandidate(state);
			const model = candidate ? state.ctx?.modelRegistry.find(candidate.provider, candidate.id) : undefined;
			if (model && (await pi.setModel(model))) callbacks.onProgress?.(`using ${candidate!.provider}/${candidate!.id}`);

			// `refresh` is unused; an empty string keeps Pi's credential shape stable.
			return { access: token, refresh: "", expires: Date.now() + CREDENTIAL_TTL_MS };
		},
	} satisfies NonNullable<ProviderConfig["oauth"]>;

	// Anchor provider: no models, only the sign-in method, so `/login` and `/logout` work even
	// before any connection has been discovered.
	pi.registerProvider(LOGIN_HOST_ID, { name: LOGIN_HOST_NAME, baseUrl: cfg.apiBase, oauth: login });

	const flushNotes = (ctx: ExtensionContext) => {
		if (state.notes.length === 0) return;
		ctx.ui.notify(state.notes.slice(0, 5).join("\n"), "warning");
		state.notes = [];
	};

	pi.on("session_start", (_event, ctx) => {
		state.ctx = ctx; // needed to resolve a Model for pi.setModel() after a later /login
		// A `/login` in another session, or a fresh env token, can make signing in possible later.
		if (state.registered.size === 0 && resolveToken(cfg, state)) {
			syncNow().catch((error) => state.notes.push(`opencode-providers: ${error instanceof Error ? error.message : String(error)}`));
		}
		flushNotes(ctx);
		ctx.ui.setStatus("opencode-providers", state.registered.size > 0 ? `⟡ opencode ${state.registered.size}` : undefined);
	});

	pi.registerCommand("opencode", {
		description: "OpenCode Console providers: status, refresh, list, models <provider>, probe <provider> [model]",
		getArgumentCompletions: (prefix) => {
			const actions = ["status", "refresh", "list", "models", "probe"];
			const filtered = actions.filter((action) => action.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [action = "status", ...rest] = args.trim().split(/\s+/);

			if (action === "refresh") {
				state.sessionToken = undefined; // re-resolve: env, auth.json, then this session's login
				try {
					ctx.ui.notify(`opencode: ${await syncNow(ctx.signal)}`, "info");
				} catch (error) {
					ctx.ui.notify(`opencode refresh failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				flushNotes(ctx);
				return;
			}

			if (action === "list") {
				const lines = [...state.registered].map(([id, connId]) => `${id}  ← ${connId}`);
				ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "opencode: no providers registered (run /login)", "info");
				return;
			}

			if (action === "models") {
				const target = rest.join(" ").trim();
				const lines = ctx.modelRegistry
					.getAll()
					.filter((model) => state.registered.has(model.provider) && (!target || model.provider.includes(target)))
					.map((model) => `${model.provider}/${model.id}  ${Math.round(model.contextWindow / 1024)}K  ${model.reasoning ? "thinking" : "-"}`);
				ctx.ui.notify(lines.length > 0 ? lines.slice(0, 40).join("\n") : "opencode: no matching models", "info");
				return;
			}

			if (action === "probe") {
				const probed = resolveToken(cfg, state);
				if (!probed) {
					ctx.ui.notify("opencode: not signed in, nothing to probe", "error");
					return;
				}
				const [target = "", modelArg = ""] = rest;
				const providers = [...state.endpoints.keys()].filter((id) => !target || id.includes(target));
				if (providers.length === 0) {
					ctx.ui.notify(`opencode: no provider matching "${target}" (see /opencode list)`, "error");
					return;
				}
				const lines: string[] = [];
				for (const id of providers.slice(0, 5)) {
					const endpoint = state.endpoints.get(id)!;
					const modelId = modelArg || state.candidates.find((candidate) => candidate.provider === id)?.id;
					lines.push(modelId ? await probeEndpoint(cfg, probed.token, endpoint, modelId) : `${id}: no models registered`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			const auth = resolveToken(cfg, state);
			ctx.ui.notify(
				[
					`opencode: ${state.registered.size} providers, ${state.modelTotal} models, last sync ${state.lastSync}`,
					`token: ${auth ? auth.source : "MISSING"} · api: ${cfg.apiBase}`,
					state.hiddenFreeTier > 0
						? `free tier: ${state.hiddenFreeTier} OpenCode "-free" model(s) hidden (app-only, requests fail with FreeTierError; OPENCODE_CONSOLE_SKIP_FREE_TIER=0 registers them anyway; vendor ":free" models are always kept)${
								state.hiddenConnections.length > 0 ? `; no provider for: ${state.hiddenConnections.join(", ")}` : ""
							}`
						: 'free tier: "-free" models registered',
					`sign in: /login → ${LOGIN_HOST_NAME} (or set OPENCODE_CONSOLE_TOKEN)`,
					`commands: /opencode refresh · /opencode list · /opencode models <provider>`,
				].join("\n"),
				"info",
			);
			flushNotes(ctx);
		},
	});

	// Pi waits for this factory, so models are ready before startup model selection.
	try {
		await syncNow();
	} catch (error) {
		state.notes.push(`opencode-providers: ${error instanceof Error ? error.message : String(error)}`);
	}
}
