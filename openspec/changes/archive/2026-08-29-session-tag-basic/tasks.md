# 基础设计实现 - 任务列表

## 任务 1：项目配置初始化

- [x] 创建根目录 `package.json`（声明 workspace 和 scripts）
- [x] 创建根目录 `tsconfig.json`（TypeScript 基础配置）
- [x] 创建根目录 `tsdown.config.ts`（双产物构建配置）
- [x] 创建根目录 `cordis.yml`（本地开发 patch 注册）
- [x] 执行 `pnpm install` 安装依赖

## 任务 2：宿主端插件实现（packages/dsh-session-host）

- [x] 创建 `packages/dsh-session-host/package.json`（宿主包配置 + dsh manifest）
- [x] 创建 `packages/dsh-session-host/tsconfig.json`（宿主端 TypeScript 配置）
- [x] 创建 `packages/dsh-session-host/src/index.ts`（HTTP 路由注册）
- [x] 验证宿主插件 TypeScript 编译通过

## 任务 3：客户端插件实现（packages/dsh-session-client）

- [x] 创建 `packages/dsh-session-client/package.json`（客户端包配置 + dsh manifest）
- [x] 创建 `packages/dsh-session-client/tsconfig.json`（客户端 TypeScript 配置）
- [x] 创建 `packages/dsh-session-client/src/index.ts`（Canvas 交互实现）
- [x] 验证客户端插件 TypeScript 编译通过

## 任务 4：构建与测试

- [x] 执行 `pnpm build` 生成三产物（Host ESM + Client Node 半区 ESM + Client 浏览器半区 CJS）并拼接客户端注册包装
- [x] 验证 `packages/dsh-session-host/dist/index.js` 产物格式正确
- [x] 验证 `packages/dsh-session-client/dist/index.cjs` 产物格式正确（带注册包装）
- [x] 执行 `pnpm typecheck` 确认无类型错误
- [x] 创建根目录 `vitest.config.ts`（Vitest 配置，支持 workspace 模式）
- [x] 创建 `packages/dsh-session-host/__tests__/index.test.ts`（宿主端测试用例）
- [x] 创建 `packages/dsh-session-client/__tests__/index.test.ts`（客户端测试用例）
- [x] 执行 `pnpm test` 确认所有测试用例通过
- [x] 验证测试覆盖率达标（宿主端 ≥ 90%，客户端 ≥ 85%）

## 任务 5：集成验证

- [x] 启动开发服务器：`pnpm dsh web --patch cordis.yml`
- [x] 测试宿主接口：`curl /dsh-session-host-test` 返回服务端时间
- [x] 测试客户端 Canvas：在 DSH Web UI 中验证蓝色块渲染与点击日志
- [x] 确认宿主→客户端通信通路正常

## 任务 6：文档与清理

- [x] 更新 `packages/dsh-session-host/README.md`（接口说明）
- [x] 更新 `packages/dsh-session-client/README.md`（交互说明）
- [x] 清理临时文件，确认代码符合项目规范
- [x] 提交变更到 Git 仓库

## Sub-agent 任务审计

- [x] 对照 `openspec/specs/host-http-interface/spec.md` 验证宿主接口实现
- [x] 对照 `openspec/specs/client-canvas-interaction/spec.md` 验证客户端交互实现
- [x] 对照 `openspec/changes/session-tag-basic/design.md` 验证整体设计一致性
- [x] 对照 `openspec/changes/session-tag-basic/proposal.md` 验证变更目标达成
