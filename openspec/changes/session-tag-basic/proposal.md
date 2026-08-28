## Why

DSH 会话管理插件需要验证宿主→客户端通信通路的可行性。基础设计通过实现一个最简的 HTTP 接口（返回服务端时间）和客户端 Canvas 交互（蓝色块点击 + 控制台日志），建立双包拆分（host/client）的开发范式，为后续复杂功能（会话标签分析、投影渲染、桌面通知等）奠定技术基础。

当前项目处于设计阶段，两个 package 目录仅有 README.md，尚无实际代码实现。本次变更将完成从零到一的首个可运行插件。

## What Changes

- **新增宿主端插件**（`packages/dsh-session-host/`）：实现 `/dsh-session-host-test` HTTP 接口，无参返回当前服务端时间戳
- **新增客户端插件**（`packages/dsh-session-client/`）：在 DOM 节点区域创建 Canvas，绘制蓝色块支持点击，点击后控制台打印点击事件与时间日志
- **新增项目配置**：`package.json`（双包声明）、`tsconfig.json`、`cordis.yml`（本地开发 patch 注册）、`tsdown.config.ts`（Host ESM + Client CJS 双产物构建）、`vitest.config.ts`（测试配置）
- **参考实现对齐**：宿主 HTTP 路由注册对齐 `docs/dsh-session-manager.md`，客户端 Canvas 交互对齐 `docs/dsh-tidychat.md`

## Capabilities

### New Capabilities

- `host-http-interface`: 宿主端 HTTP 接口实现，通过 `ctx.webServer` 注册 `/dsh-session-host-test` 路由，返回服务端时间
- `client-canvas-interaction`: 客户端 Canvas 交互实现，在 DOM 节点区域创建 Canvas 绘制蓝色块，支持点击事件并打印日志

### Modified Capabilities

（无既有 capability 需修改）

## Impact

- **代码结构**：`packages/dsh-session-host/` 和 `packages/dsh-session-client/` 将从空目录变为完整插件包
- **依赖**：引入 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-host-webserver`（宿主）、`@deepseek-ai/dsh-client-runtime`（客户端）、`vitest`（测试框架）
- **构建**：引入 `tsdown` 构建工具，产出 Host ESM + Client CJS 双产物
- **开发流程**：通过 `pnpm dsh web --patch cordis.yml` 可本地开发调试
- **API 兼容性**：HTTP 接口命名遵循 `/dsh-session-host-*` 约定，为后续扩展接口预留命名空间

## 验证步骤

1. **宿主接口验证**：启动开发服务器后，curl 访问 `/dsh-session-host-test`，确认返回 JSON 格式的服务端时间戳
2. **客户端 Canvas 验证**：在 DSH Web UI 中确认 Canvas 蓝色块正确渲染，点击后控制台输出点击事件与时间日志
3. **双包构建验证**：执行构建命令，确认 `dist/host/index.js`（ESM）和 `dist/client/index.js`（CJS）产物正确生成
4. **TypeScript 类型检查**：执行 `pnpm typecheck`，确认无类型错误
5. **单元测试验证**：执行 `pnpm test`，确认所有测试用例通过

## 单元测试设计（Vitest）

### 测试框架配置

- 测试框架：Vitest（ESM 原生支持，与项目 TypeScript ESM 技术栈一致）
- 测试文件位置：`packages/dsh-session-host/__tests__/` 和 `packages/dsh-session-client/__tests__/`
- 测试配置：根目录 `vitest.config.ts`，支持 workspace 模式覆盖双包

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

describe('dsh-session-base-host 插件', () => {
  let apply: typeof import('../src/index.ts').apply

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-base-host')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('webServer')
  })

  it('apply 函数应注册 /dsh-session-host-test 路由', () => {
    apply(mockCtx)
    expect(mockRegister).toHaveBeenCalledOnce()
    expect(mockRegister).toHaveBeenCalledWith(
      '/dsh-session-host-test',
      expect.any(Function)
    )
  })

  it('路由处理器应返回包含 serverTime 的 JSON', () => {
    apply(mockCtx)
    const handler = mockRegister.mock.calls[0][1]
    
    const mockReq = {} as any
    const mockRes = {
      json: vi.fn(),
    } as any
    
    handler(mockReq, mockRes)
    
    expect(mockRes.json).toHaveBeenCalledOnce()
    const response = mockRes.json.mock.calls[0][0]
    expect(response).toHaveProperty('serverTime')
    expect(typeof response.serverTime).toBe('number')
    expect(response.serverTime).toBeGreaterThan(0)
  })

  it('路由路径应以 /dsh-session-host- 开头', () => {
    apply(mockCtx)
    const routePath = mockRegister.mock.calls[0][0]
    expect(routePath).toMatch(/^\/dsh-session-host-/)
  })
})
```

### 客户端测试用例（packages/dsh-session-client/__tests__/index.test.ts）

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// 模拟 DOM 环境
const mockAppendChild = vi.fn()
const mockContainer = {
  appendChild: mockAppendChild,
} as unknown as Element

// 模拟 querySelector
Object.defineProperty(document, 'querySelector', {
  value: vi.fn().mockReturnValue(mockContainer),
  writable: true,
})

describe('dsh-session-base-client 插件', () => {
  let apply: typeof import('../src/index.ts').apply
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-base-client')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('slots')
  })

  it('apply 函数应创建 Canvas 元素并追加到容器', () => {
    apply({} as ClientContext)
    
    expect(mockAppendChild).toHaveBeenCalledOnce()
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.tagName).toBe('CANVAS')
  })

  it('Canvas 应具有正确的尺寸（100x60）', () => {
    apply({} as ClientContext)
    
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(60)
  })

  it('Canvas 应设置 cursor: pointer 样式', () => {
    apply({} as ClientContext)
    
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('Canvas 应绑定 click 事件监听器', () => {
    apply({} as ClientContext)
    
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    const clickEvent = new MouseEvent('click', {
      offsetX: 50,
      offsetY: 30,
    })
    canvas.dispatchEvent(clickEvent)
    
    expect(consoleSpy).toHaveBeenCalledOnce()
    const logCall = consoleSpy.mock.calls[0]
    expect(logCall[0]).toContain('[SessionTag]')
  })

  it('点击事件日志应包含 type、time、x、y 属性', () => {
    apply({} as ClientContext)
    
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    const clickEvent = new MouseEvent('click', {
      offsetX: 25,
      offsetY: 15,
    })
    canvas.dispatchEvent(clickEvent)
    
    const logCall = consoleSpy.mock.calls[0]
    const logData = logCall[1]
    expect(logData).toHaveProperty('type', 'click')
    expect(logData).toHaveProperty('time')
    expect(logData).toHaveProperty('x', 25)
    expect(logData).toHaveProperty('y', 15)
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
pnpm test --filter dsh-session-base-host

# 运行客户端测试
pnpm test --filter dsh-session-base-client

# 生成覆盖率报告
pnpm test:coverage
```
