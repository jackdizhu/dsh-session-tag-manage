# Spec: Context Aware API Call

## Overview

客户端插件上下文感知的接口调用能力。客户端插件（`dsh-session-tag-manage-client`）在 Canvas 点击交互时，基于已订阅的会话与工作区上下文构建查询串并调用宿主端 `/dsh-session-host-test` 接口，控制台打印响应，用于验证上下文在宿主与客户端之间的传递。代码位于 `packages/dsh-session-client/`，交互对象为插件自有 Canvas 元素。

## Requirements

### Requirement: 上下文感知的接口调用
客户端插件 SHALL 在 Canvas 点击时基于订阅状态解析当前会话与所属工作区，构建查询串并调用 `/dsh-session-host-test`，控制台打印接口响应。

#### Scenario: 点击带上下文调用接口
- **WHEN** 用户点击 Canvas 蓝色块且存在当前会话、工作区上下文
- **THEN** 向 `/dsh-session-host-test?folderActive=<id>&sessionCurrent=<id>` 发起 fetch，并控制台打印接口响应 JSON

#### Scenario: 上下文缺失时降级调用
- **WHEN** 当前会话或工作区上下文解析为 `null`
- **THEN** 仅在非空时添加对应查询参数，仍调用 `/dsh-session-host-test`，控制台打印接口响应

#### Scenario: 接口调用失败兜底
- **WHEN** 接口请求抛错
- **THEN** 捕获异常并 `console.error` 打印失败日志，不阻断页面后续交互

### Requirement: 模块归属
客户端端代码 SHALL 位于 `packages/dsh-session-client/` 目录，入口文件为 `src/index.ts`；交互对象为插件自有 Canvas 元素。

#### Scenario: 目录结构
- **WHEN** 查看客户端端插件目录
- **THEN** 包含 `src/index.ts`，点击逻辑基于 `getCurrentSessionId(ctx)` / `getActiveWorkspaceId(...)` 解析上下文，遵循双包拆分规范与「客户端仅操作自身 DOM」约束