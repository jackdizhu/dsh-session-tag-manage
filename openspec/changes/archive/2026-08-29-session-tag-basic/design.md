# 基础设计实现 - 设计文档

## 一、设计说明

本设计实现 DSH 会话管理插件的基础功能，验证双包拆分（host/client）的开发范式和宿主→客户端通信通路。

### 核心目标

1. 验证 Cordis 插件框架在 DSH 环境下的可用性
2. 建立宿主 HTTP 路由注册的标准模式
3. 建立客户端 Canvas 渲染与交互的标准模式
4. 确保双包构建（Host ESM + Client CJS）流程正确

### 技术约束

- 宿主侧通过 `ctx.webServer` 注册 HTTP 路由
- 客户端侧通过 DOM 定位渲染 Canvas，不触碰宿主数据源之外的 DOM
- 双包拆分：`packages/dsh-session-host`（宿主）/ `packages/dsh-session-client`（客户端）
- 构建产物：Host ESM（Node.js ES2024）+ Client CJS（Browser，UMD wrapper）

## 二、目录结构设计

```
dsh-session-tag-manage/
├── package.json                    # 项目配置 + scripts
├── pnpm-workspace.yaml             # workspace 声明（packages/*）
├── cordis.yml                      # 本地开发 patch 注册（按包名）
├── tsconfig.json                   # TypeScript 基础配置（ES2024，@deepseek-ai 别名指向 types/）
├── tsdown.config.ts                # 构建配置（三产物）
├── vitest.config.ts                # 测试配置（jsdom/node 环境匹配）
├── types/
│   └── deepseek-ai.d.ts            # @deepseek-ai 包类型 mock（运行时由宿主提供）
├── scripts/
│   ├── wrap-client-bundle.mjs      # 客户端 bundle 注册包装（__ModuleLoader__.load）
│   └── auto-register.js/.cmd/.sh   # 插件注册辅助脚本
├── packages/
│   ├── dsh-session-host/
│   │   ├── package.json            # 宿主包配置 + dsh manifest
│   │   ├── tsconfig.json
│   │   ├── cordis.patch.yml        # 包内 patch 注册
│   │   ├── src/
│   │   │   └── index.ts            # 宿主入口：HTTP 路由注册
│   │   ├── __tests__/
│   │   │   └── index.test.ts       # 宿主端测试
│   │   └── dist/                   # 构建产物（ESM）
│   └── dsh-session-client/
│       ├── package.json            # 客户端包配置 + dsh manifest
│       ├── tsconfig.json
│       ├── cordis.patch.yml        # 包内 patch 注册
│       ├── src/
│       │   ├── index.ts            # 浏览器半区：Canvas 交互
│       │   └── host.ts             # Node 半区：空插件（loader 挂载）
│       ├── __tests__/
│       │   └── index.test.ts       # 客户端测试
│       └── dist/                   # 构建产物（host.js ESM + index.cjs 包装后）
├── docs/                           # 设计文档（已有）
├── openspec/                       # OpenSpec 变更管理
└── rules/                          # 项目规则
```

## 三、宿主端设计（packages/dsh-session-host）

### 3.1 插件入口（src/index.ts）

```typescript
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-session-tag-manage-host'
export const inject = ['webServer']

export function apply(ctx: Context) {
  // dsh-host-webserver 的 register 接收路由对象 { kind, path, handler }，
  // handler 收到的是 node:http 的 IncomingMessage / ServerResponse（无 res.json 方法），
  // 因此自行 writeHead + end 输出 JSON。
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-session-host-test',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ serverTime: Date.now() }))
    },
  })
}
```

> 注：`@deepseek-ai/*` 依赖由 DSH 宿主运行时提供，本地类型通过 `types/deepseek-ai.d.ts` 模拟（`register` 接收路由对象）。

### 3.2 包配置（package.json）

```json
{
  "name": "dsh-session-tag-manage-host",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "peerDependencies": {},
  "dependencies": {}
}
```

> 注：patch 文件为包内 `cordis.patch.yml`（按包名注册，便于打包分发）；`@deepseek-ai/*` 不声明为依赖，运行时由 DSH 宿主提供。

## 四、客户端设计（packages/dsh-session-client）

### 4.1 插件入口（src/index.ts）

```typescript
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'dsh-session-tag-manage-client'
export const inject = ['slots']

export function apply(ctx: ClientContext) {
  console.log('[SessionTag] 插件 apply 函数被调用', ctx)
  console.log('[SessionTag] ctx.slots 可用:', !!ctx.slots)

  const initPlugin = () => {
    // 打印当前 DOM 快照（扫描 data-* 属性与会话节点，调试用）
    logSessionNodes()

    // 创建 Canvas 元素（fixed 定位在右下角，不依赖特定容器）
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 60
    canvas.style.cssText = 'cursor: pointer; position: fixed; right: 16px; bottom: 16px; z-index: 99999; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
    canvas.setAttribute('data-session-tag-canvas', 'true')

    // 绘制蓝色块
    const ctx2d = canvas.getContext('2d')
    if (ctx2d) {
      ctx2d.fillStyle = '#3b82f6'
      ctx2d.fillRect(0, 0, 100, 60)
    }

    // 绑定点击事件
    canvas.addEventListener('click', (event) => {
      console.log('[SessionTag] Canvas clicked:', {
        type: event.type,
        time: new Date().toLocaleString(),
        x: event.offsetX,
        y: event.offsetY,
      })
    })

    // 挂载到 body（fixed 定位）
    document.body.appendChild(canvas)

    // MutationObserver 监听会话节点变化 + 定时兜底日志 + 清理函数（window.__sessionTagCleanup）
    // 详见 packages/dsh-session-client/src/index.ts
  }

  initPlugin()
}
```

> 注：Canvas 采用 fixed 右下角固定定位挂载到 `document.body`，不侵入会话区域 DOM；`data-*` 稳定选择器仅用于 DOM 扫描与调试，不依赖编译期 hash 类名。

### 4.2 包配置（package.json）

```json
{
  "name": "dsh-session-tag-manage-client",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/host.js",
  "exports": {
    ".": "./dist/host.js",
    "./client": "./dist/index.cjs",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": { "platform": "web" }
  },
  "peerDependencies": {},
  "dependencies": {}
}
```

> 注：`dsh.client` 为对象形式 `{ platform: "web" }`；`main`/`exports["."]` 指向 Node 半区 `host.js`，浏览器逻辑通过 `exports["./client"]` 指向打包后的 `dist/index.cjs`。

### 4.3 Node 半区入口（src/host.ts）

DSH 的 loader 在宿主（Node）侧加载的是该包的 `main`（`src/host.ts` 编译产物 `dist/host.js`），
而真正的浏览器逻辑在 `dsh.client` + `exports["./client"]` 声明的浏览器 bundle 中。
`host.ts` 只提供一个空的 Cordis 插件，让 loader 条目在宿主侧成功挂载（fiber 存活），
从而被 dsh-client-modules 扫描并编入 `window.__DSH_BOOT__` 图。

```typescript
// src/host.ts —— 空插件，仅用于宿主侧挂载
export function apply() {}
```

## 五、构建配置

### 5.1 tsdown.config.ts

```typescript
import { defineConfig } from 'tsdown'

export default defineConfig([
  // 宿主端产物（ESM）
  {
    entry: ['packages/dsh-session-host/src/index.ts'],
    outDir: 'packages/dsh-session-host/dist',
    format: 'esm',
    target: 'es2024',
    external: ['@deepseek-ai/*'],
  },
  // 客户端插件 Node 半区（ESM）：空插件，让 loader 条目在宿主侧挂载成功
  {
    entry: ['packages/dsh-session-client/src/host.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'esm',
    target: 'es2024',
  },
  // 客户端插件浏览器半区（CJS 主体）
  {
    entry: ['packages/dsh-session-client/src/index.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'cjs',
    target: 'es2024',
  },
])
```

> 注：tsdown 不支持 footer/尾部包装，客户端浏览器半区 CJS 的 `window.__ModuleLoader__.load({ id, factory })` 自注册包装由 `scripts/wrap-client-bundle.mjs` 在 `pnpm build` 后统一拼接（产物为 `dist/index.cjs`），与官方 `dsh-client-runtime/lib/client.js` 格式一致。

### 5.2 cordis.yml（本地开发）

```yaml
# 根目录 cordis.yml：loader 条目按包名解析（host 半区走包 main，浏览器半区由
# dsh-client-modules 按包名扫描 dsh.client / exports["./client"]）。
# 注意：不能用 file:// 源码路径，否则客户端插件无法被编入 __DSH_BOOT__。
# 修改源码后需执行 pnpm build 再启动。
- insert:
    - id: dsh-session-tag-manage-host
      name: dsh-session-tag-manage-host
    - id: dsh-session-tag-manage-client
      name: dsh-session-tag-manage-client
```

> 注：两个包内还各自维护 `cordis.patch.yml`（dsh manifest `bundle.patch` 指向，内容为按包名注册），用于打包分发场景。

## 六、数据流设计

### 6.1 宿主 HTTP 请求流

```
客户端 → HTTP GET /dsh-session-host-test
        → ctx.webServer 路由匹配
        → 路由处理器执行
        → 返回 { serverTime: Date.now() }
```

### 6.2 客户端 Canvas 交互流

```
插件加载 → 打印 ctx 调试日志 → DOM 节点扫描（data-* 属性盘点）
         → 创建 Canvas 元素（fixed 右下角定位）
         → Canvas 2D 绘制蓝色块（#3b82f6）
         → 挂载到 document.body
         → 绑定 click 事件监听
         → MutationObserver + 定时器监听会话节点变化
         → 用户点击 → 控制台输出 { type, time, x, y }
```

## 七、验证方案

### 7.1 宿主接口验证

1. 启动开发服务器：`pnpm dsh web --patch cordis.yml`
2. 执行 curl 命令：`curl http://localhost:PORT/dsh-session-host-test`
3. 预期结果：返回 JSON `{ "serverTime": <timestamp> }`，HTTP 200

### 7.2 客户端 Canvas 验证

1. 在 DSH Web UI 中打开任意会话
2. 确认 Canvas 蓝色块渲染在页面右下角（fixed 定位）
3. 点击蓝色块，检查浏览器控制台输出：
   - `[SessionTag] Canvas clicked: { type: "click", time: "...", x: ..., y: ... }`
   - 插件启动时输出 ctx 调试日志、DOM 节点扫描报告、MutationObserver 启动日志

### 7.3 构建验证

1. 执行构建命令：`pnpm build`（tsdown 三产物 + wrap-client-bundle 拼接注册包装）
2. 确认产物生成：
   - `packages/dsh-session-host/dist/index.js`（ESM）
   - `packages/dsh-session-client/dist/host.js`（Node 半区 ESM）
   - `packages/dsh-session-client/dist/index.cjs`（浏览器半区 CJS，已带 `__ModuleLoader__` 注册包装）
3. 执行类型检查：`pnpm typecheck`，确认无类型错误

## 八、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Canvas 定位与宿主布局冲突 | 蓝色块遮挡页面内容 | 采用 fixed 右下角固定定位（z-index 99999），不侵入会话区域 DOM |
| 宿主路由注册失败 | HTTP 接口不可用 | 检查 `ctx.webServer` 是否正确注入，确认插件依赖配置 |
| 构建产物格式不兼容 | 客户端插件加载失败 | 确保 CJS 产物通过 UMD wrapper 正确导出，测试 `window.__ModuleLoader__` 加载 |

## 九、任务列表

见 `tasks.md`。

## 十、验证步骤

1. **环境准备**：安装依赖（`pnpm install`），确认 DSH 开发环境可用
2. **宿主接口测试**：启动开发服务器，curl 测试 `/dsh-session-host-test` 接口
3. **客户端交互测试**：在 DSH Web UI 中验证 Canvas 渲染与点击日志
4. **构建产物检查**：执行构建，验证三产物格式与内容
5. **类型检查**：执行 `pnpm typecheck`，确认无类型错误
6. **集成测试**：完整运行插件，确认宿主→客户端通信通路正常
