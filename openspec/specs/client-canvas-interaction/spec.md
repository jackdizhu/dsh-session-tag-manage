# Spec: Client Canvas Interaction

## Overview

客户端插件基础能力。客户端插件（`dsh-session-tag-manage-client`）在目标 DOM 节点区域创建 Canvas 元素并绘制蓝色矩形块，支持点击事件，点击后在控制台输出事件类型、点击时间、点击坐标日志。客户端代码位于 `packages/dsh-session-client/`（双包拆分，与宿主端分离）。

## Requirements

### Requirement: Canvas 渲染
客户端插件 SHALL 在 DOM 节点区域创建 Canvas 元素，绘制蓝色矩形块（宽高 100x60px，背景色 #3b82f6）。

#### Scenario: Canvas 创建与绘制
- **WHEN** 客户端插件初始化完成且 DOM 节点区域可用
- **THEN** 在目标 DOM 容器中创建 Canvas 元素，绘制蓝色矩形块

#### Scenario: DOM 定位约束
- **WHEN** 客户端插件查找目标容器
- **THEN** 使用稳定的 DOM 选择器定位，不依赖编译期 hash 类名

### Requirement: 点击事件日志
客户端插件 SHALL 在用户点击蓝色块时，控制台输出包含事件类型、点击时间、点击坐标的日志。

#### Scenario: 点击事件输出
- **WHEN** 用户点击 Canvas 蓝色块区域
- **THEN** 控制台输出日志包含 `type: "click"`、`time: <toLocaleString>`、`x: <offsetX>`、`y: <offsetY>`

### Requirement: 工作区标签查询接口调用
客户端插件 SHALL 在 Canvas 点击时调用 `POST /dsh-session-tag-manage/workspace.list.tag` 接口，传入当前 `workspaceId`，获取该工作区所有会话的标签数据。

#### Scenario: 正常调用
- **WHEN** 用户点击 Canvas 蓝色块
- **THEN** 客户端发送 `POST /dsh-session-tag-manage/workspace.list.tag`，请求体为 `{ "workspaceId": "<当前工作区 ID>" }`，控制台打印接口响应数据

#### Scenario: 无工作区上下文
- **WHEN** 当前无活跃工作区（`workspaceId` 为空）
- **THEN** 客户端仍发送请求（`workspaceId` 为空字符串），接口返回空 `items` 数组

### Requirement: 模块归属
客户端端代码 SHALL 位于 `packages/dsh-session-client/` 目录，入口文件为 `src/index.ts`。

#### Scenario: 目录结构
- **WHEN** 查看客户端端插件目录
- **THEN** 包含 `package.json`、`src/index.ts`，遵循双包拆分规范