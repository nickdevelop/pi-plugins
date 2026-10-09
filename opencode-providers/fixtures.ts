/**
 * Fixtures copied from the OpenCode Console API responses used by test.ts.
 * Shape is kept identical to the live payloads so mapping is tested realistically.
 */

export const PROVIDER_LIST = [
	{
		id: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
		configKey: "console-command-code",
		name: "command code",
		builtIn: false,
		modelManagementEnabled: true,
		providerSchemaManagementEnabled: true,
		enabled: true,
		freeModelsEnabled: true,
		newModelsEnabled: true,
		config: {
			tag: "http",
			baseUrl: "https://api.commandcode.ai/provider/v1",
			providerSchema: "oa-compat",
			auth: { mode: "bearer" },
		},
		providerSchema: "oa-compat",
		catalogSlug: null,
		baseUrl: "https://api.commandcode.ai/provider/v1",
		auth: { mode: "bearer" },
		credentialHint: "...nSmE",
		modelCount: 5,
		enabledModelCount: 4,
		updatedAt: "2026-10-08T03:45:08.000Z",
	},
	{
		id: "conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode",
		configKey: "opencode",
		name: "OpenCode",
		builtIn: true,
		modelManagementEnabled: false,
		providerSchemaManagementEnabled: false,
		enabled: true,
		freeModelsEnabled: true,
		newModelsEnabled: false,
		config: { tag: "opencode" },
		providerSchema: "oa-compat",
		catalogSlug: "opencode",
		baseUrl: "https://opencode.ai/inference",
		auth: null,
		credentialHint: "****",
		modelCount: 86,
		enabledModelCount: 6,
		updatedAt: "2026-10-07T14:08:24.000Z",
	},
	{
		id: "conn_01DISABLED00000000000000",
		configKey: "console-off",
		name: "paused box",
		builtIn: false,
		enabled: false,
		providerSchema: "oa-compat",
		baseUrl: "https://off.example.com/v1",
		auth: { mode: "bearer" },
		modelCount: 0,
		enabledModelCount: 0,
	},
];

export const COMMAND_CODE_DETAIL = {
	id: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
	configKey: "console-command-code",
	name: "command code",
	builtIn: false,
	enabled: true,
	providerSchema: "oa-compat",
	baseUrl: "https://api.commandcode.ai/provider/v1",
	auth: { mode: "bearer" },
	requestBaseUrl: "https://opencode.ai/inference/custom/conn_01M34AFH6R8YY5RDEJA5MSEHXD",
	models: [
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "deepseek/deepseek-v4.1-flash",
			apiId: "deepseek/deepseek-v4.1-flash",
			name: "DeepSeek V4.1 Flash",
			status: null,
			config: {
				enabled: true,
				capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
				limits: { context: 1000000 },
				costTiers: [{ type: "base", input: 0.15, output: 0.6, cacheRead: 0.003 }],
			},
			capabilities: { toolCall: true, inputTypes: ["text", "image"], outputTypes: ["text"] },
			limits: { context: 1000000 },
			costTiers: [{ type: "base", input: 0.15, output: 0.6, cacheRead: 0.003 }],
			available: true,
			enabled: true,
		},
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "gpt-6-luna",
			apiId: "gpt-6-luna",
			name: "GPT-6 Luna",
			family: "gpt-luna",
			status: null,
			config: {
				enabled: true,
				capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
				limits: { context: 1050000, output: 128000 },
				costTiers: [{ type: "base", size: 278528, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.04 }],
			},
			capabilities: { toolCall: true, reasoning: true, inputTypes: ["text", "image", "pdf"], outputTypes: ["text"] },
			limits: { context: 1050000, output: 128000 },
			costTiers: [{ type: "base", size: 278528, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.04 }],
			available: true,
			enabled: true,
		},
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "longcontext/model",
			apiId: "longcontext/model",
			name: "Long Context Model",
			status: null,
			capabilities: { toolCall: true, inputTypes: ["text"], outputTypes: ["text"] },
			limits: { context: 400000, output: 64000 },
			costTiers: [
				{ type: "base", input: 1, output: 2, cacheRead: 0.1 },
				{ type: "long-context", size: 278528, input: 2, output: 4, cacheRead: 0.2 },
			],
			available: true,
			enabled: true,
		},
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "xiaomi/mimo-v2.6-flash",
			apiId: "xiaomi/mimo-v2.6-flash",
			name: "MiMo V2.6 Flash",
			status: null,
			config: { enabled: false },
			capabilities: { toolCall: true, inputTypes: ["text", "image", "audio", "video", "pdf"], outputTypes: ["text"] },
			limits: { context: 1048576, output: 131072 },
			costTiers: [{ type: "base", input: 0.14, output: 0.28, cacheRead: 0.0028 }],
			available: true,
			enabled: false,
		},
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "retired/model",
			apiId: "retired/model",
			name: "Retired",
			status: "deprecated",
			capabilities: { toolCall: false, inputTypes: ["text"], outputTypes: ["text"] },
			limits: { context: 100000 },
			costTiers: [{ type: "base", input: 1, output: 1 }],
			available: true,
			enabled: true,
		},
		{
			// Vendor free model: zero costTiers but callable, so it must never be hidden.
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "inclusionai/ling-3.1-flash:free",
			apiId: "inclusionai/ling-3.1-flash:free",
			name: "Ling 3.1 Flash",
			capabilities: { toolCall: true, inputTypes: ["text"], outputTypes: ["text"] },
			limits: { context: 262144 },
			costTiers: [{ type: "base", input: 0, output: 0, cacheRead: 0 }],
			available: true,
			enabled: true,
		},
		{
			providerId: "conn_01M34AFH6R8YY5RDEJA5MSEHXD",
			modelId: "no-limits/model",
			apiId: "no-limits/model",
			name: "No Limits",
			capabilities: { inputTypes: ["text"], outputTypes: ["text"] },
			costTiers: [],
			available: true,
			enabled: true,
		},
	],
};

export const OPENCODE_DETAIL = {
	id: "conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode",
	configKey: "opencode",
	name: "OpenCode",
	builtIn: true,
	enabled: true,
	providerSchema: "oa-compat",
	baseUrl: "https://opencode.ai/inference",
	auth: null,
	requestBaseUrl: "https://opencode.ai/inference/openai/v1",
	models: [
		{
			providerId: "conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode",
			modelId: "mimo-v2.6-flash-free",
			apiId: "mimo-v2.6-flash-free",
			name: "MiMo-V2.6-Flash",
			status: "active",
			capabilities: { toolCall: true, reasoning: true, attachment: true, temperature: true, inputTypes: ["text", "image", "audio", "video"], outputTypes: ["text"] },
			limits: { context: 200000, output: 32000 },
			costTiers: [{ type: "base", input: 0, output: 0, cacheRead: 0 }],
			available: true,
			enabled: true,
		},
		{
			providerId: "conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode",
			modelId: "big-pickle",
			apiId: "big-pickle",
			name: "Big Pickle",
			status: "active",
			capabilities: { toolCall: true, reasoning: true, inputTypes: ["text"], outputTypes: ["text"] },
			limits: { context: 200000, input: 160000, output: 32000 },
			costTiers: [{ type: "base", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
			available: true,
			enabled: false,
		},
	],
};

/** Serves the fixtures through the Console URL shapes the extension requests. */
export function installMockFetch(overrides: { list?: unknown; details?: Record<string, unknown> } = {}): { requests: string[] } {
	const requests: string[] = [];
	const list = overrides.list ?? PROVIDER_LIST;
	const details = overrides.details ?? {};

	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		requests.push(url);
		const payload = (() => {
			if (url.endsWith("/providers")) return list;
			const match = /\/providers\/([^?]+)$/.exec(url);
			if (match) return details[decodeURIComponent(match[1])] ?? { error: "not found" };
			return { error: `unexpected url ${url}` };
		})();
		const ok = typeof payload === "object" && payload !== null && !("error" in payload);
		return new Response(JSON.stringify(payload), { status: ok ? 200 : 404, headers: { "content-type": "application/json" } });
	}) as typeof fetch;

	// Console calls use a fresh cache location per run.
	return { requests };
}

export const DEFAULT_DETAILS: Record<string, unknown> = {
	conn_01M34AFH6R8YY5RDEJA5MSEHXD: COMMAND_CODE_DETAIL,
	conn_01KGS82J4BJD9R59XFX4ASWSTD_opencode: OPENCODE_DETAIL,
};

/** An `anthropic` connection whose upstream baseUrl already carries /v1 — the classic 404 trap. */
export const ANTHROPIC_SUMMARY = {
	id: "conn_anthropic_trap",
	configKey: "console-anthropic",
	name: "Anthropic Trap",
	builtIn: false,
	enabled: true,
	providerSchema: "anthropic",
	baseUrl: "https://api.example.test/provider/v1",
	auth: { mode: "bearer" },
	modelCount: 1,
	enabledModelCount: 1,
};

export const ANTHROPIC_DETAIL = {
	...ANTHROPIC_SUMMARY,
	requestBaseUrl: "https://opencode.ai/inference/custom/conn_anthropic_trap",
	models: [
		{
			modelId: "claude-haiku-5-5",
			apiId: "claude-haiku-5-5",
			name: "Claude Haiku 5.5",
			status: "active",
			capabilities: { toolCall: true, reasoning: false, inputTypes: ["text", "image"], outputTypes: ["text"] },
			limits: { context: 1000000, output: 128000 },
			costTiers: [{ type: "base", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 0 }],
			available: true,
			enabled: true,
		},
	],
};
