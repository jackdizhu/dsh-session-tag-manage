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
├── package.json                    # 项目配置 + workspace 声明
├── cordis.yml                      # 本地开发 patch 注册
├── tsconfig.json                   # TypeScript 基础配置
├── tsdown.config.ts                # 构建配置（双产物）
├── packages/
│   ├── dsh-session-host/
│   │   ├── package.json            # 宿主包配置 + dsh manifest
│   │   ├── src/
│   │   │   └── index.ts            # 宿主入口：HTTP 路由注册
│   │   └── dist/                   # 构建产物
│   └── dsh-session-client/
│       ├── package.json            # 客户端包配置 + dsh manifest
│       ├── src/
│       │   └── index.ts            # 客户端入口：Canvas 交互
│       └── dist/                   # 构建产物
├── docs/                           # 设计文档（已有）
├── openspec/                       # OpenSpec 变更管理
└── rules/                          # 项目规则
```

## 三、宿主端设计（packages/dsh-session-host）

### 3.1 插件入口（src/index.ts）

```typescript
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-session-base-host'
export const inject = ['webServer']

export function apply(ctx: Context) {
  ctx.webServer.register('/dsh-session-host-test', (req, res) => {
    res.json({ serverTime: Date.now() })
  })
}
```

### 3.2 包配置（package.json）

```json
{
  "name": "dsh-session-base-host",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dsh": {
    "bundle": { "patch": "./cordis.yml" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-host-webserver": "*"
  }
}
```

## 四、客户端设计（packages/dsh-session-client）

### 4.1 插件入口（src/index.ts）

```typescript
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'dsh-session-base-client'
export const inject = ['slots']

export function apply(ctx: ClientContext) {
  // 查找目标 DOM 容器
  const container = document.querySelector('[data-session-row]') ?? document.body
  
  // 创建 Canvas 元素
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 60
  canvas.style.cssText = 'cursor: pointer; margin: 8px;'
  
  // 绘制蓝色块
  const ctx2d = canvas.getContext('2d')!
  ctx2d.fillStyle = '#3b82f6'
  ctx2d.fillRect(0, 0, 100, 60)
  
  // 绑定点击事件
  canvas.addEventListener('click', (event) => {
    console.log('[SessionTag] Canvas clicked:', {
      type: event.type,
      time: new Date().toLocaleString(),
      x: event.offsetX,
      y: event.offsetY,
    })
  })
  
  container.appendChild(canvas)
}
```

### 4.2 包配置（package.json）

```json
{
  "name": "dsh-session-base-client",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dsh": {
    "client": "./dist/index.js"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "*"
  }
}
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
  // 客户端产物（CJS）
  {
    entry: ['packages/dsh-session-client/src/index.ts'],
    outDir: 'packages/dsh-session-client/dist',
    format: 'cjs',
    banner: {
      js: `window.__ModuleLoader__ = window.__ModuleLoader__ || { load(opts) { var m = { exports: {} }; opts.factory(function(id){return require(id)}, m); return m.exports; } };`,
    },
  },
])
```

### 5.2 cordis.yml（本地开发）

```yaml
- insert:
    - id: dsh-session-base-host
      name: /absolute/path/to/packages/dsh-session-host/src/index.ts
```

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
插件加载 → 查找目标 DOM 容器
         → 创建 Canvas 元素
         → Canvas 2D 绘制蓝色块
         → 绑定 click 事件监听
         → 用户点击 → 控制台输出日志
```

## 七、验证方案

### 7.1 宿主接口验证

1. 启动开发服务器：`pnpm dsh web --patch /absolute/path/to/cordis.yml`
2. 执行 curl 命令：`curl http://localhost:PORT/dsh-session-host-test`
3. 预期结果：返回 JSON `{ "serverTime": <timestamp> }`，HTTP 200

### 7.2 客户端 Canvas 验证

1. 在 DSH Web UI 中打开任意会话
2. 确认 Canvas 蓝色块在目标 DOM 区域渲染
3. 点击蓝色块，检查浏览器控制台输出：
   - `[SessionTag] Canvas clicked: { type: "click", time: "...", x: ..., y: ... }`

### 7.3 构建验证

1. 执行构建命令：`pnpm build`
2. 确认产物生成：
   - `packages/dsh-session-host/dist/index.js`（ESM）
   - `packages/dsh-session-client/dist/index.js`（CJS）
3. 执行类型检查：`pnpm typecheck`，确认无类型错误

## 八、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Canvas DOM 定位不稳定 | 蓝色块未渲染到目标区域 | 使用稳定的 DOM 选择器（如 `data-session-row`），降级到 `document.body` |
| 宿主路由注册失败 | HTTP 接口不可用 | 检查 `ctx.webServer` 是否正确注入，确认插件依赖配置 |
| 构建产物格式不兼容 | 客户端插件加载失败 | 确保 CJS 产物通过 UMD wrapper 正确导出，测试 `window.__ModuleLoader__` 加载 |

## 九、任务列表

见 `tasks.md`。

## 十、验证步骤

1. **环境准备**：安装依赖（`pnpm install`），确认 DSH 开发环境可用
2. **宿主接口测试**：启动开发服务器，curl 测试 `/dsh-session-host-test` 接口
3. **客户端交互测试**：在 DSH Web UI 中验证 Canvas 渲染与点击日志
4. **构建产物检查**：执行构建，验证双产物格式与内容
5. **类型检查**：执行 `pnpm typecheck`，确认无类型错误
6. **集成测试**：完整运行插件，确认宿主→客户端通信通路正常
