# opencode-providers

一个 Pi 扩展 = 一个 “provider 入口”：它读取 OpenCode Console 的连接列表，然后把**每个连接注册成 Pi 的一个独立 provider**。

```
GET https://opencode.ai/console/api/providers            -> 连接(provider)列表
GET https://opencode.ai/console/api/providers/{conn_id}  -> 该连接的模型目录
```

只注册 `models[].enabled === true` 的模型；其余 `capabilities` / `limits` / `costTiers` 按 Pi 的模型字段格式转换。

## 安装 / 运行

本插件是 [`@nickdevelop/pi-plugins`](https://github.com/nickdevelop/pi-plugins) 这个 pi package 的一部分：

```bash
pi install git:github.com/nickdevelop/pi-plugins     # 常驻安装（本仓库唯一入口）
pi -e ./opencode-providers                           # 或者本地目录单次试用
```

登录方式有两种，任选其一（env 优先）：

**1）`/login`（推荐，凭据存在 `~/.pi/agent/auth.json`）**

```bash
pi install git:github.com/nickdevelop/pi-plugins     # 或本地：pi -e ./opencode-providers
# 在 Pi 里：/login → Sign in with an account → OpenCode Console → 粘贴 oc_sk_... 回车
```

登录时扩展会立刻校验 token、拉取目录并注册所有连接，同时自动选一个可用模型，登录完就能直接对话。
之后每次启动都会自己读回这份凭据，不再需要环境变量；`/logout` 可注销。

**2）环境变量**

```bash
export OPENCODE_CONSOLE_TOKEN=oc_sk_xxx            # Console + 推理代理共用的 Bearer token
pi --list-models                                    # 已安装则直接可见；未安装则加 -e ./opencode-providers
```

## 登录宿主 provider

连接列表本身需要 token 才能获取，所以下载时会出现一个**不带模型**的锚点 provider `opencode-console`（显示名 `OpenCode Console`），它只负责提供 `/login` / `/logout` 入口；登录成功后才会出现真正的连接 provider。每个连接 provider 也挂着同一个登录方法，所以 `/login occ-command-code` 同样可用。

token 解析优先级：`OPENCODE_CONSOLE_TOKEN` / `OPENCODE_TOKEN` / `OPENCODE_CONSOLE_TOKEN_FILE` → `auth.json` 里的登录凭据（一个 token 服务所有连接）→ 本次 `/login` 刚输入的 token。

> 登录成功后 Pi 会提示 `no default model is configured for provider "opencode-console"`——因为锚点 provider 本身没有模型，可忽略：扩展已经自动选好模型（也可用 `/model` 手选）。

## 注册结果

| Console 字段 | Pi 字段 |
|---|---|
| `.[].name` | provider 显示名（`ProviderConfig.name`）；provider id 由其 slug 化得到（默认前缀 `occ-`） |
| `.[].id` | 内部 conn id：用于拉取模型目录、`/opencode list` 展示 |
| `requestBaseUrl`（回退 `baseUrl`） | `baseUrl`（Console 的 OpenAI 兼容代理端点） |
| `providerSchema: "oa-compat"` | `api: "openai-completions"`（委托 Pi 内置流式实现） |
| `providerSchema: "anthropic"` | `api: "anthropic-messages"`（注意 Base URL 不能带 `/v1`，见下节） |
| `auth: { mode: "bearer" }` | 环境变量登录时 `apiKey: "$OPENCODE_CONSOLE_TOKEN"`；`/login` 登录时用字面 token，Pi 发请求时自己拼 `Authorization: Bearer` |
| `models[].apiId` / `name` | 模型 `id` / `name` |
| `models[].capabilities.reasoning` | `reasoning` |
| `models[].capabilities.inputTypes` | `input`（只保留 Pi 支持的 `text` / `image`） |
| `models[].limits.context` | `contextWindow` |
| `models[].limits.output` | `maxTokens`（缺失时用 `OPENCODE_CONSOLE_MAX_OUTPUT`，默认 32000） |
| `models[].costTiers[type=base]` | `cost.{input,output,cacheRead,cacheWrite}`（每百万 token 美元价） |
| `models[].costTiers[].size`（更多档位） | `cost.tiers[].inputTokensAbove` |

被过滤掉的模型：`enabled !== true`、`available === false`、`status` 含 `deprecat`、缺少 `limits.context`、同一 provider 内 id 重复，以及默认隐藏的免费档模型。

每个 provider 都带 `refreshModels`：Pi 刷新模型目录（如打开 `/model`）时重新拉取该连接，失败时保留上一次的列表而不是清空。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENCODE_CONSOLE_TOKEN` / `OPENCODE_TOKEN` | — | 可选。不用它就用 `/login`；也支持 `OPENCODE_CONSOLE_TOKEN_FILE=/path` 从文件读 |
| `OPENCODE_CONSOLE_API` | `https://opencode.ai/console/api` | Console API 基址 |
| `OPENCODE_CONSOLE_PREFIX` | `occ` | provider id 前缀；`off` 表示直接用 slug 名 |
| `OPENCODE_CONSOLE_ONLY` / `OPENCODE_CONSOLE_SKIP` | — | 按 name / configKey / conn id 过滤（逗号分隔，子串匹配） |
| `OPENCODE_CONSOLE_INCLUDE_BUILTIN` | `1` | 设为 `0` 跳过 `builtIn: true` 的连接 |
| `OPENCODE_CONSOLE_SKIP_FREE_TIER` | `1` | 默认隐藏免费档模型；`0` 仍然注册它们（调起会报 `FreeTierError`） |
| `OPENCODE_CONSOLE_TTL_MS` | `900000` | 目录缓存有效期；未过期时启动不再发请求 |
| `OPENCODE_CONSOLE_TIMEOUT_MS` | `10000` | 单次请求超时 |
| `OPENCODE_CONSOLE_PATH_SHIM` | `1` | anthropic 连接的路径改写（`{base}/v1/messages` → `{base}/messages`）；`0` 关闭并改为启动告警 |
| `OPENCODE_CONSOLE_MAX_OUTPUT` | `32000` | 模型缺 `limits.output` 时的输出上限 |

目录缓存在 `$PI_CODING_AGENT_DIR/cache/opencode-providers.json`（默认 `~/.pi/agent/cache/…`）。`PI_OFFLINE=1` 时只用缓存。

## 会话内命令

- `/opencode` — 状态（provider 数、模型数、上次同步、token 来源、被隐藏的免费档数量）
- `/opencode refresh` — 强制重新拉取；连接消失会被 `unregisterProvider` 摘掉
- `/opencode list` — provider id ← conn id 对照
- `/opencode models <provider>` — 该 provider 下的模型
- `/opencode probe <provider> [model]` — 用 Pi 完全相同的请求路径打一次 `max_tokens=1` 的请求，直接打印 HTTP 状态和上游错误，用于判断是配置问题还是模型问题

## Anthropic 类型连接（providerSchema: "anthropic"）

Console 代理把**客户端路径**拼到该连接自己的 `baseUrl` 上：

| 连接 schema | Pi 实际请求 | 代理拼出的上游地址 |
|---|---|---|
| `oa-compat` | `{requestBaseUrl}/chat/completions` | `{baseUrl}/chat/completions` |
| `anthropic` | `{requestBaseUrl}/v1/messages` | `{baseUrl}/v1/messages` |

而 Pi 的 Anthropic 客户端（官方 SDK）固定请求 `{requestBaseUrl}/v1/messages`，被拼成 `{baseUrl}/v1/messages`；若 Base URL 已带 `/v1` 就是 `.../v1/v1/messages`，OpenCode 回 `404 Not found. Check the docs for available routes.`

**扩展会自动适配**：注册 anthropic 连接时，把自己的 Anthropic 请求从 `{base}/v1/messages` 改写成 Console 真正提供的 `{base}/messages`（只改这些地址，其它请求原样透传，不改动你 Console 里的配置——那个 URL 形状是 OpenCode 自家客户端要用的）。

用 `OPENCODE_CONSOLE_PATH_SHIM=0` 可关闭改写，此时扩展会在启动时告警并给出 Console 侧的改法（把 Base URL 结尾的 `/v1` 去掉）。

## 已知限制

- **免费档模型默认不注册**（id 以 `-free` 结尾，或 `costTiers` 全零）：OpenCode 服务端只允许它自家客户端调用，在 Pi 里必定返回 `{"type":"FreeTierError"}`。这是预期行为，启动时**不会**因此弹告警；隐藏数量与因此没有 provider 的连接名在 `/opencode` 状态里可见。确认后果后可以用 `OPENCODE_CONSOLE_SKIP_FREE_TIER=0` 强制注册（扩展不会伪装成 OpenCode 客户端去绕过该限制）。
- provider id 由 `name` slug 化而来：在 Console 里重命名连接会改变 provider id（旧会话里保存的 `provider/model` 需要重新选择）。
- Pi 的 chat 模型只支持 `text` / `image` 输入，`audio` / `video` / `pdf` 能力会被丢弃。
- 扩展自身不写凭据：`/login` 得知的 token 由 **Pi** 写入 `~/.pi/agent/auth.json`（`opencode-console` 条目）；扩展只读取自己那一条，且从不打印 token。
- Console token 不轮换，所以 `refreshToken` 直接返回原凭据，`expires` 设为 ≈10 年后，不会触发刷新。

## 测试

```bash
npm test                                            # 仓库根目录执行，用 fixtures 模拟 Console，无需网络
npm run test:live                                   # 打真实 Console API（需要 OPENCODE_CONSOLE_TOKEN）
npm run typecheck
node --experimental-strip-types --no-warnings opencode-providers/test.ts   # 等价的手动跑法
```

覆盖：一连接一 provider、仅 `enabled` 模型、字段映射（含多档 `costTiers`）、过滤器（含默认隐藏免费档、`=0` 时重新注册并警告）、单连接失败不影响其他连接、`refreshModels`、`/opencode` 命令、无 token 时只注册登录锚点、`/login` 流程（校验失败不落库、登录后立即注册并共享 token）、`auth.json` 凭据回读。
