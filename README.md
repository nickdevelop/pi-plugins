# pi-plugins

Pi coding-agent 的扩展集合，作为一个 [pi package](https://github.com/badlogic/pi-mono/blob/main/docs/packages.md) 发布：一个 git 仓库 = 一个可安装单元。

## 安装

```bash
pi install git:github.com/nickdevelop/pi-plugins
```

其它写法等价：`git:github.com/nickdevelop/pi-plugins@v0.1.0`（tag/commit 会被钉住）、`https://github.com/nickdevelop/pi-plugins`。

```bash
pi list                        # 查看已安装的 package
pi remove git:github.com/nickdevelop/pi-plugins
pi update --extensions         # 回到配置的 ref 重新对齐（钉住的 ref 不会移动）
pi -e git:github.com/nickdevelop/pi-plugins -p "hi"   # 不写入 settings，单次试用
```

## 包含的插件

| 插件 | 入口 | 作用 |
|---|---|---|
| [opencode-providers](./opencode-providers/README.md) | `opencode-providers/index.ts` | 把 OpenCode Console 的每个连接注册成 Pi 的一个独立 provider（只注册 `enabled` 模型），支持 `/login` 登录 |

装完后在 Pi 里：

```
/login                     → Sign in with an account → OpenCode Console → 粘贴 oc_sk_...
/opencode                  → 状态：provider 数、模型数、token 来源、被隐藏的免费档
/opencode refresh|list|models <provider>|probe <provider>
```

## 只加载需要的插件

在 `~/.pi/agent/settings.json`（或项目 `.pi/settings.json`）里按类型过滤，`!` 排除、`+`/`-` 精确增删：

```json
{
  "packages": [
    {
      "source": "git:github.com/nickdevelop/pi-plugins",
      "extensions": ["opencode-providers/index.ts"]
    }
  ]
}
```

## 开发

```bash
npm test                # 用 fixtures 模拟 Console，无需网络
npm run test:live       # 打真实 Console API，需要 OPENCODE_CONSOLE_TOKEN
npm run typecheck       # tsc --strict（通过 npx 临时取 typescript）
pi -e ./opencode-providers -p "hi"     # 本地目录直接试，不走安装
```

本仓库的 `node_modules/@earendil-works/*` 只是本地开发用的符号链接（已 gitignore）：扩展 import 的 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 由 Pi 运行时提供，因此声明在 `peerDependencies`，**不要**放进 `dependencies`（真实副本会绕过 Pi 的模块映射，产生重复注册）。

测试脚本用 Node 直接跑 `.ts`（`--experimental-strip-types`），只需要类型导入，因此无需安装任何依赖。

### 加一个新插件

1. 新建 `plugins-or-whatever/index.ts`（默认导出 `export default function (pi: ExtensionAPI) {}`）。
2. 在根 `package.json` 的 `pi.extensions` 数组里加一行路径（路径相对仓库根，支持 glob 与 `!` 排除）。
3. `pi -e ./新目录` 自测 → `npm test` → 提交推送，用户侧 `pi update --extensions` 即可拿到。

## 许可

MIT
