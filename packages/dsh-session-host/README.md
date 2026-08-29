# dsh-session-host

> 插件命名：dsh-session-tag-manage-host

## 概述

DSH 会话管理插件的宿主端实现，通过 `ctx.webServer` 注册 HTTP 路由接口。

## 功能说明

### 基础设计

1. **HTTP 接口**：`/dsh-session-host-test`
   - 参数：无
   - 返回：`{ serverTime: <epoch_ms> }`（当前服务端时间戳）
   - 参考实现：`docs/dsh-session-manager.md`

### 扩展设计

2. **HTTP 接口**：`/dsh-session-host-get`
   - 参数：工作区 ID
   - 返回：当前工作区 `session` 会话数量

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 构建
pnpm build

# 运行测试
pnpm test
```

## 测试

```bash
# 运行宿主端测试
pnpm test --filter dsh-session-tag-manage-host
```

测试用例位于 `__tests__/index.test.ts`，覆盖：
- 插件规范导出（name、inject）
- 路由注册验证
- 响应格式验证
- 路径规范验证
