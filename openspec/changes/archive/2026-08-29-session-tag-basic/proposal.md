## Why

DSH 会话管理插件需要验证宿主→客户端通信通路的可行性。基础设计通过实现一个最简的 HTTP 接口（返回服务端时间）和客户端 Canvas 交互（蓝色块点击 + 控制台日志），建立双包拆分（host/client）的开发范式，为后续复杂功能（会话标签分析、投影渲染、桌面通知等）奠定技术基础。

当前项目处于设计阶段，两个 package 目录仅有 README.md，尚无实际代码实现。本次变更将完成从零到一的首个可运行插件。

## What Changes

- **新增宿主端插件**（`packages/dsh-session-host/`）：实现 `/dsh-session-host-test` HTTP 接口，无参返回当前服务端时间戳（`ctx.webServer.register` 接收路由对象，`writeHead + end` 输出 JSON）
- **新增客户端插件**（`packages/dsh-session-client/`）：创建 Canvas（100x60 蓝色块，fixed 右下角定位挂载到 `document.body`），支持点击并在控制台打印点击事件与时间日志，附带 DOM 节点扫描与 MutationObserver 监听；另有 Node 半区 `src/host.ts` 保证 loader 宿主侧挂载
- **新增项目配置**：`package.json`（scripts + workspace）、`pnpm-workspace.yaml`（packages/*）、`tsconfig.json`（ES2024，`@deepseek-ai/*` 别名指向 `types/`）、`cordis.yml`（本地开发 patch 注册，按包名）、`tsdown.config.ts`（Host ESM + Client Node 半区 ESM + Client 浏览器半区 CJS 三产物构建）、`vitest.config.ts`（jsdom/node 环境匹配）、`scripts/wrap-client-bundle.mjs`（客户端 bundle 注册包装）、`types/deepseek-ai.d.ts`（`@deepseek-ai` 类型 mock）
- **参考实现对齐**：宿主 HTTP 路由注册对齐 `docs/dsh-session-manager.md`，客户端 Canvas 交互对齐 `docs/dsh-tidychat.md`

## Capabilities

### New Capabilities

- `host-http-interface`: 宿主端 HTTP 接口实现，通过 `ctx.webServer` 注册 `/dsh-session-host-test` 路由，返回服务端时间
- `client-canvas-interaction`: 客户端 Canvas 交互实现，在 DOM 节点区域创建 Canvas 绘制蓝色块，支持点击事件并打印日志

### Modified Capabilities

（无既有 capability 需修改）

## Impact

- **代码结构**：`packages/dsh-session-host/` 和 `packages/dsh-session-client/` 将从空目录变为完整插件包（含 src、__tests__、cordis.patch.yml、dist）；新增 `scripts/`、`types/` 支持脚本
- **依赖**：`@deepseek-ai/*` 由 DSH 宿主运行时提供（本地以 `types/deepseek-ai.d.ts` 类型 mock，测试以 vitest alias 指向）；本地 devDependencies 引入 `vitest`、`jsdom`、`tsdown`、`typescript`、`@types/node`
- **构建**：引入 `tsdown` 构建工具，产出三产物（Host ESM、Client Node 半区 ESM、Client 浏览器半区 CJS），并由 `scripts/wrap-client-bundle.mjs` 对浏览器 CJS 拼接 `window.__ModuleLoader__.load()` 注册包装
- **开发流程**：通过 `pnpm dsh web --patch cordis.yml` 可本地开发调试
- **API 兼容性**：HTTP 接口命名遵循 `/dsh-session-host-*` 约定，为后续扩展接口预留命名空间

## 验证步骤

1. **宿主接口验证**：启动开发服务器后，curl 访问 `/dsh-session-host-test`，确认返回 JSON 格式的服务端时间戳
2. **客户端 Canvas 验证**：在 DSH Web UI 中确认 Canvas 蓝色块正确渲染，点击后控制台输出点击事件与时间日志
3. **双包构建验证**：执行构建命令，确认 `packages/dsh-session-host/dist/index.js`（ESM）、`packages/dsh-session-client/dist/host.js`（Node 半区 ESM）和 `packages/dsh-session-client/dist/index.cjs`（浏览器半区 CJS，带注册包装）产物正确生成
4. **TypeScript 类型检查**：执行 `pnpm typecheck`，确认无类型错误
5. **单元测试验证**：执行 `pnpm test`，确认所有测试用例通过

## 单元测试设计（Vitest）

### 测试框架配置

- 测试框架：Vitest（ESM 原生支持，与项目 TypeScript ESM 技术栈一致）
- 测试文件位置：`packages/dsh-session-host/__tests__/` 和 `packages/dsh-session-client/__tests__/`
- 测试配置：根目录 `vitest.config.ts`
  - 环境匹配：客户端 `jsdom`、宿主端 `node`（`environmentMatchGlob`）
  - `resolve.alias` 将 `@deepseek-ai/*` 指向 `types/deepseek-ai.d.ts`（运行时由宿主提供）

### 宿主端测试用例（packages/dsh-session-host/__tests__/index.test.ts）

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

// 模拟 ctx.webServer
const mockRegister = vi.fn()
const mockCtx = {
  webServer: {
    register: mockRegister,
  },
} as unknown as Context

describe('dsh-session-tag-manage-host 插件', () => {
  let apply: typeof import('../src/index.ts').apply

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-tag-manage-host')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('webServer')
  })

  it('apply 函数应以路由对象注册 /dsh-session-host-test', () => {
    apply(mockCtx)
    expect(mockRegister).toHaveBeenCalledOnce()
    const route = mockRegister.mock.calls[0][0]
    expect(route).toMatchObject({ kind: 'exact', path: '/dsh-session-host-test' })
    expect(typeof route.handler).toBe('function')
  })

  it('路由处理器应返回包含 serverTime 的 JSON', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]

    const mockReq = {} as any
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any

    route.handler(mockReq, mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toHaveProperty('serverTime')
    expect(typeof body.serverTime).toBe('number')
    expect(body.serverTime).toBeGreaterThan(0)
  })

  it('路由路径应以 /dsh-session-host- 开头', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    expect(route.path).toMatch(/^\/dsh-session-host-/)
  })
})
```

### 客户端测试用例（packages/dsh-session-client/__tests__/index.test.ts）

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

describe('dsh-session-tag-manage-client 插件', () => {
  let apply: typeof import('../src/index.ts').apply
  let logSpy: ReturnType<typeof vi.spyOn>
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleGroupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    delete (window as any).__sessionTagCleanup
    document.body.innerHTML = ''
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  afterEach(() => {
    logSpy.mockRestore()
    consoleGroupSpy.mockRestore()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-tag-manage-client')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('slots')
  })

  it('apply 函数应创建 Canvas 元素并固定定位到右下角', () => {
    apply({} as ClientContext)
    const canvas = document.body.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.tagName).toBe('CANVAS')
  })

  it('Canvas 应具有正确的尺寸（100x60）', () => {
    apply({} as ClientContext)
    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(60)
  })

  it('Canvas 应设置右下角固定定位样式', () => {
    apply({} as ClientContext)
    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.cursor).toBe('pointer')
    expect(canvas.style.position).toBe('fixed')
    expect(canvas.style.right).toBe('16px')
    expect(canvas.style.bottom).toBe('16px')
  })

  it('Canvas 应设置 data-session-tag-canvas 属性', () => {
    apply({} as ClientContext)
    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.getAttribute('data-session-tag-canvas')).toBe('true')
  })

  it('apply 应打印 ctx 上下文日志', () => {
    const ctx = { slots: { register: vi.fn() } } as unknown as ClientContext
    apply(ctx)
    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    expect(allLogs.some(log => String(log).includes('ctx 上下文'))).toBe(true)
  })

  it('apply 应启动 MutationObserver', () => {
    apply({} as ClientContext)
    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    expect(allLogs.some(log => String(log).includes('MutationObserver 已启动'))).toBe(true)
  })

  it('apply 应提供 cleanup 函数', () => {
    apply({} as ClientContext)
    expect(typeof (window as any).__sessionTagCleanup).toBe('function')
  })

  it('apply 应打印 DOM 节点扫描报告', () => {
    apply({} as ClientContext)
    const groupCalls = consoleGroupSpy.mock.calls.map(c => c[0])
    expect(groupCalls.some(log => String(log).includes('DOM 节点扫描报告'))).toBe(true)
  })
})
```

### 测试覆盖率目标

| 模块 | 覆盖率目标 | 说明 |
|------|-----------|------|
| 宿主端插件 | ≥ 90% | 路由注册、响应格式、路径规范 |
| 客户端插件 | ≥ 85% | Canvas 创建、事件绑定、日志输出 |

### 测试执行命令

```bash
# 运行所有测试
pnpm test

# 运行宿主端测试
pnpm test --filter dsh-session-tag-manage-host

# 运行客户端测试
pnpm test --filter dsh-session-tag-manage-client

# 生成覆盖率报告
pnpm test:coverage
```
