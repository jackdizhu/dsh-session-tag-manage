---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] dsh-session-projection API 版本不兼容，投影注册结构错误导致历史加载失败'
labels: ['bug']
assignees: ''
---

## 描述缺陷

点击会话列表中的会话时历史加载失败。原因：插件本地依赖的 `dsh-session-projection` v0.1.1-rc.2 与全局 DSH 运行时 v0.1.0-rc.7 的 `ProjectionDefinition` API 契约不一致，注册时传入 `stateSchema` + `wire:{viewSchema,view}`，而全局运行时读取顶层 `schema` 与 `view`，均为 `undefined`。

## 复现步骤

1. 启动 `dsh web` 并加载插件
2. 点击会话列表中的某个会话
3. 观察历史加载失败：`Cannot read properties of undefined (reading 'parse')`
4. 无法查看会话内容

## 预期行为

投影注册校验 schema 与视图转换函数可被正确读取，会话历史正常加载。

## 实际行为

```
history unavailable for session "session-97eeee58-63b2-44d8-854f-22fdb5518832":
TypeError: Cannot read properties of undefined (reading 'parse')（internal）
```

## 环境信息

- dsh 版本：`dsh --version`（全局运行时 v0.1.0-rc.7）
- 插件依赖版本：`@deepseek-ai/dsh-session-projection` v0.1.1-rc.2
- 操作系统：Windows

## 日志 / 报错

见「实际行为」中的错误信息。

## 根因与解决

- **根因**：全局运行时 `SessionProjectionRegistry.register()` 直接存储传入的 definition，随后在 `snapshot()`/`viewCheckpoint()`/`restore()`/`drive()` 中调用 `def.schema.parse(def.view(...))`。插件传入 `stateSchema` + `wire` 结构，`def.schema` 与 `def.view` 均为 `undefined`。本地 v0.1.1-rc.2 有内部「擦除」转换（`erased`）将 `stateSchema` + `wire` 转为内部格式，而全局 v0.1.0-rc.7 不做此转换。编译用本地类型、运行用全局版本，类型检查通过但运行时崩溃。

API 契约差异：

| 字段 | 插件本地 (v0.1.1-rc.2) | 全局运行时 (v0.1.0-rc.7) |
|---|---|---|
| 状态校验 schema | `stateSchema` | 不使用 |
| 视图校验 schema | `wire.viewSchema` | `schema`（顶层） |
| 视图转换函数 | `wire.view` | `view`（顶层） |

- **解决**：以全局运行时形状为准，在源码中直接写顶层 `schema` + `view`，用 `as any` 屏蔽本地类型差异（移除原不稳定的 `patch-projection.js` postbuild 脚本）。

```ts
ctx.sessionProjections.register({
  key: 'session-tag',
  schema: viewSchema,          // wire.viewSchema → 顶层 schema
  stateVersion: 3,             // view 含 source 等字段，升版本使旧持久化缓存失效
  init,
  apply,
  view(state) { return { tag: state.tag, source: state.source, lastActiveAt: state.lastActiveAt } },
} as any) // 本地包与全局运行时 API 契约不同，以全局运行时形状为准
```

## 其他补充

- 涉及文件：[src/projection.ts](file:///c:/global-user-data/ai-workspace/dsh-session-tag-manage/src/projection.ts)。
- 需注意：刷新持久化缓存走 `stateVersion` 升版本，而非仅修补结构。