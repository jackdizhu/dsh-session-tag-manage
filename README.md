# dsh-session-tag-manage

DeepSeek DSH 插件仓库 —— 当前主插件为 **dsh-debugger**（LLM 调用调试拦截），用于拦截并审计每一轮 LLM 请求/响应，便于调试与排障。

## 项目概述

本仓库基于 DeepSeek Harness (DSH) 插件系统构建，采用**单包插件**架构：

- **插件包** (`dsh-debugger`)：DSH 宿主端调试插件，拦截 `llm/stream` 流式调用用于调试与审计。

核心能力：

- **全局调试开关** `debug.enabled`（默认关闭，需 `/debugger on` 开启拦截）。
- **`/debugger` 指令**：`/debugger [on|off|status]`（无参数等同 `on`；支持中文别名 `开启/关闭/状态`），在 Web/CLI 指令平面切换全局开关。
- **LLM 流拦截**：开启后拦截 `llm/stream`，对请求参数 `sanitize`（剔除 `signal` 等敏感字段）后落盘（优先 storage KV 单元，不可达时回退 `os.tmpdir()/dsh-llm-debug-<uuid>.json`），并合成响应流（`block-start → text-delta → block-end → finish`）作为调试回执返回。

> 历史会话标签管理相关的设计文档与 OpenSpec 变更见 `docs/` 与 `openspec/changes/archive/`。

## 安装

> 仓库地址：`https://github.com/jackdizhu/dsh-session-tag-manage`

通过 DSH 的 `plugin add` 命令即可从 GitHub 直接安装本插件，无需克隆仓库。支持按「版本标签」或「分支引用」安装。

### 按版本标签安装（推荐）

使用已发布的版本标签（tag）安装，可锁定到稳定版本：

```bash
# 安装发布版本 v.debug.1.0
dsh plugin add github:jackdizhu/dsh-session-tag-manage#v.debug.1.0
```

### 按分支引用安装

使用分支引用安装（如 `dsh-debugger` 跟踪最新开发状态）：

```bash
# 安装 dsh-debugger 分支最新代码
dsh plugin add github:jackdizhu/dsh-session-tag-manage#dsh-debugger
```

### 安装后生效

安装完成后重启 DSH 使插件加载：

```bash
dsh web
```

**可用版本标签**：`v.debug.1.0`。

## 目录结构

```
dsh-session-tag-manage/
├── package.json                    # 项目配置 + workspace 声明
├── pnpm-workspace.yaml             # pnpm 工作区配置
├── cordis.yml                      # 本地开发 patch 注册（dsh web --patch）
├── tsconfig.json                   # TypeScript 基础配置
├── tsdown.config.ts                # 构建配置（构建 packages/dsh-debugger）
├── vitest.config.ts                # 测试配置
├── AGENT.md                        # 项目约定
├── LICENSE                         # MIT
├── packages/
│   └── dsh-debugger/               # DSH 调试插件（单包）
│       ├── package.json            # 包配置（name: dsh-debugger, main: dist/index.js）
│       ├── cordis.patch.yml        # 插件注册配置
│       ├── dsh-debugger-config.json# 运行时配置（debug.enabled 等）
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts            # 插件入口：/debugger 指令注册 + llm/stream 拦截
│       │   ├── debug.ts            # LLM 流拦截、sanitize 与合成响应
│       │   ├── config.ts           # DebuggerConfig / ConfigStore
│       │   ├── records.ts          # 配置原子落盘
│       │   └── commands/
│       │       └── index.ts             # /debugger [on|off|status] handler
│       ├── __tests__/
│       │   ├── command.test.ts
│       │   ├── debug.test.ts
│       │   └── records.test.ts
│       └── dist/                   # 构建产物（dist/index.js）
├── scripts/
│   ├── auto-register.js            # 跨平台自动注册（web + headless）
│   ├── auto-register.cmd           # Windows
│   ├── auto-register.sh            # Linux/macOS
│   └── wrap-client-bundle.mjs      # 客户端 bundle 包装（旧双包架构遗留，当前未使用）
├── docs/                           # 设计文档
├── issues/                         # 问题追踪（001~004 + README）
├── openspec/                       # OpenSpec 变更管理（历史变更已归档至 changes/archive）
├── apiDocs/                        # API 文档
├── rules/                          # 规则（issues / openspec）
├── types/                          # @deepseek-ai 类型 shim（deepseek-ai.d.ts）
├── src/                            # 客户端占位 / 其他源码
├── lib/ stubs/ test/ tests/        # 库、类型桩、测试
└── git-source/                     # deepseek-harness 源码镜像（参考用，非插件本体）
```

## 安装依赖

```bash
# 在项目根目录执行
pnpm install
```

> 若本机通过 corepack 管理 pnpm 时遇到 `MODULE_NOT_FOUND`，请确认 pnpm 已正确安装，或改用托管 Node 直接运行脚本。

## 本地开发

### 方式 1：本地源码开发（推荐）

先构建插件产物，再用 `--patch` 加载本地 `cordis.yml` 注册 `dsh-debugger`：

```bash
# 1. 构建插件产物
pnpm build

# 2. 启动开发服务器（patch 注册 dsh-debugger）
pnpm run dev

# 或手动执行
dsh web --patch cordis.yml
```

### 方式 2：注册到 DSH profile

通过自动注册脚本把插件 junction 到 DSH 的 web / headless 两个 profile，并写入对应 `cordis.patch.yml`：

```bash
# 自动注册（推荐）
pnpm run register

# 或手动执行
dsh plugin add <项目根目录>/packages/dsh-debugger

# 重启 DSH 使插件加载
dsh web
```

**自动注册脚本说明：**

| 脚本 | 平台 | 使用方式 |
|------|------|----------|
| `scripts/auto-register.js` | 跨平台 | `node scripts/auto-register.js` 或 `pnpm run register` |
| `scripts/auto-register.cmd` | Windows | `scripts\auto-register.cmd` 或 `pnpm run register:win` |
| `scripts/auto-register.sh` | Linux/macOS | `./scripts/auto-register.sh` 或 `pnpm run register:unix` |

**安装后需要重启 DSH 才能生效。**

## 构建

```bash
# 构建 dsh-debugger 单包产物（ESM → packages/dsh-debugger/dist/index.js）
pnpm build
```

构建产物：

- `packages/dsh-debugger/dist/index.js`（ESM，Node.js 宿主端）

> 构建配置见根 `tsdown.config.ts`；`scripts/wrap-client-bundle.mjs` 为旧双包架构遗留，当前未使用。

## 测试

```bash
# 运行所有测试
pnpm test

# 仅运行 dsh-debugger 包测试（按文件名过滤）
pnpm test dsh-debugger

# 生成覆盖率报告
pnpm test:coverage
```

## 类型检查

```bash
pnpm typecheck
```

## 插件配置说明

### 配置项（`dsh-debugger-config.json`）

插件读取包内 `packages/dsh-debugger/dsh-debugger-config.json`：

```json
{
  "version": 1,
  "debug": {
    "enabled": false,
    "domain": "dsh-llm-debug",
    "reply": "[DEBUG] LLM call blocked; request params recorded to a temp file."
  }
}
```

| 字段 | 说明 |
|------|------|
| `debug.enabled` | 全局调试开关。**默认 `false`（装上不拦截，需 `/debugger on` 开启）**；经 `/debugger off` 改写后落盘持久，跨重启保持。 |
| `debug.domain` | storage KV 单元域名（不可达时回退临时文件 `os.tmpdir()/dsh-llm-debug-<uuid>.json`）。 |
| `debug.reply` | 拦截后合成回执的文案。 |

### `/debugger` 指令

| 指令 | 说明 |
|------|------|
| `/debugger` 或 `/debugger on` | 全局开启调试拦截 |
| `/debugger off` | 全局关闭，LLM 调用透传真实接口 |
| `/debugger status` | 查询当前全局开关状态 |
| `/debugger 开启 \| 关闭 \| 状态` | 中文别名，效果同上 |

开启后，每一轮 LLM 调用会被拦截：请求参数落盘临时文件，回复中显示文件路径。

## 技术栈

- **语言**：TypeScript 5（ESM）
- **插件框架**：Cordis（`@deepseek-ai/cordis`）
- **构建工具**：tsdown
- **测试框架**：Vitest
- **运行环境**：Node.js（宿主端插件）

## 相关文档

- [设计文档](docs/design.md)
- [OpenSpec 归档变更 · 设计](openspec/changes/archive/2026-08-29-session-tag-basic/design.md)
- [OpenSpec 归档变更 · 提案](openspec/changes/archive/2026-08-29-session-tag-basic/proposal.md)
- [问题追踪](issues/README.md)

## 许可证

MIT
