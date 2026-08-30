# 提案：workspace.session.tag 按轮次（turn）输出 items 数组

## Why

当前 `workspace.session.tag` 接口接收 `sessionId`、拉取该会话全量事件流（`session.history`），再把**整段**事件流折叠成**单条** `SessionEventTagItem`（包在 `value.item` 中返回）。

这导致一个会话若存在多次「用户发起 → 会话结束/异常终止」的轮次，前端无法区分：
- 这是第几轮、当前轮结束状态（正常完成 / 用户取消 / 异常终止 / 进行中）；
- 每轮的统计指标（轮内消息数、工具调用、文件操作、用户原话）被混在一起，无法逐轮跟进。

为支持「按每轮会话整合数据、重点跟进异常终止轮次」的诉求，需要把单条 `item` 改为 `items` 数组，每一轮（`turn`）对应一条，并补充轮次序号与结束原因。

## What Changes

- **BREAKING** 出参结构变更：`WorkspaceSessionTagResponse.value` 由 `{ item: SessionEventTagItem }` 改为 `{ items: SessionEventTagItem[]; hasMore: boolean }`；`hasMore` 从原 `item` 内上移到 `value` 级。
- 新增轮次切分逻辑：以 `turn/start` 为界，将事件流切分为多个「轮次段」，每轮段折叠成一条 `SessionEventTagItem`（方案 B：每 turn 一条 item）。
- 种子段不排陻：`session/end-seed` 之前的前导事件（`session/title`、`request/header`、`session/end-seed` 等）并入首个 turn 轮次，不丢失任何事件数据。
- 每条 item 新增两个字段：
  - `round: number` —— 1-based 轮次序号（取自该轮 `turn/start.data.turn`；纯前导段为 0）。
  - `endReason: RoundEndReason` —— 本轮结束/异常原因，取值：`completed` / `aborted` / `error` / `interrupted` / `max-tokens` / `blocked` / `ongoing` / `seed`。
- 复用现有 `foldStats` / `extractUserMessages` / `extractFileOperations` / `extractSessionTitle` 工具按段整合数据，不做重复实现。
- 宿主（`packages/dsh-session-host`）与客户端（`packages/dsh-session-client`）共享类型两处同步，保持契约一致。
- API 文档 `apiDocs/plugin-api/workspace.session.tag.md` 同步出参变更。

## Capabilities

### New Capabilities

- `session-event-tag-query`：按会话拉取事件流并按 turn 切分、逐轮折叠为 `SessionEventTagItem[]` 的查询能力。包含轮次切分算法、结束原因分类、出参 `items` 结构与 `round`/`endReason` 字段。模块归属：`packages/dsh-session-host/`（宿主 handler 与契约）、`packages/dsh-session-client/`（客户端类型同步）。

### Modified Capabilities

- （无既有 spec 受影响；`workspace-tag-query-api` 为另一个端点 `workspace.list.tag`，不在本次范围。）

## Impact

- **代码**：
  - `packages/dsh-session-host/src/contract.ts` —— 响应与 item 类型变更（新增 `RoundEndReason`）。
  - `packages/dsh-session-host/src/utils/session-history.ts` —— 新增 `splitTurns` / `classifyRoundEndReason` 并导出。
  - `packages/dsh-session-host/src/index.ts` —— handler 循环生成 `items`、`hasMore` 上移。
  - `packages/dsh-session-client/src/utils/tag-api.ts` —— 同步 `WorkspaceSessionTagValue`。
  - `apiDocs/plugin-api/workspace.session.tag.md` —— 同步出参文档。
- **API/契约**：`workspace.session.tag` 响应结构为破坏性变更（单条 item → items 数组），调用方需适配。错误码与信封（`type`/`rpcId`/`result.ok`/`error`）保持不变。
- **依赖**：无新增依赖。`session.history` 分页拉取逻辑复用现有 `fetchAllSessionEvents`。
- **客户端 UI**：当前客户端仅 `console.log` 结果、未渲染 UI，本轮不涉及 UI 改动；但类型须同步以免 `typecheck` 失败。

---

## 设计说明

- **切分算法 `splitTurns(events)`**：事件已按 `seq` 升序；以 `turn/start` 为界开新一轮，该轮事件 = 本 `turn/start` 起至下一个 `turn/start` 之前（含自身 `turn/end`）的所有事件；首条 `turn/start` 之前的前导事件并入首个 turn 轮次；返回 `SessionHistoryEvent[][]`（顺序即轮次顺序）。
- **结束原因 `classifyRoundEndReason(events)`**：取该轮最后一条 `turn/end` 的 `reason.kind` → `completed`/`aborted`/`error`/`interrupted`/`max-tokens`/`blocked`；末轮且无 `turn/end`（中断/进行中）→ `ongoing`；纯前导段（无 `turn/start`）→ `seed`。
- **每轮整合**：复用现有 `foldStats` / `extractUserMessages` / `extractFileOperations` / `extractSessionTitle`，逐段折叠为一条 `SessionEventTagItem`，并填入 `round` / `endReason` / `title`。

## 任务列表

详细实现任务（含文件变更路径与 diff 片段）见 `tasks.md`，按以下顺序执行：

1. 更新 `contract.ts` 类型定义（响应 `items` + `RoundEndReason` + item 字段）。
2. 新增 `splitTurns` / `classifyRoundEndReason` 工具。
3. 改造 `index.ts` handler 循环生成 `items`。
4. 同步客户端 `WorkspaceSessionTagValue`。
5. 同步 API 文档 `workspace.session.tag.md`。
6. `pnpm typecheck` 校验。
7. Sub-agent 任务审计（末项，闭环）。

## 验证方案

- **单元/逻辑验证**：构造「多 turn + 前导种子段 + 异常终止（`turn/end.reason=error`/ `aborted`）」的样例事件序列，断言 `splitTurns` 切分轮数、`classifyRoundEndReason` 输出、`foldStats` 各段统计正确，且前导事件不丢失。
- **类型一致性**：运行 `pnpm typecheck`，确认 host 与 client 共享类型一致、无编译错误。
- **契约兼容性冒烟**：以既有 `api_session.history.md` 真实样例为输入，模拟 handler 全流程，确认 `value.items` 数组结构与文档一致、`hasMore` 位置正确、错误码与信封不变。
- **文档一致性**：核对 `apiDocs/plugin-api/workspace.session.tag.md` 出参与 `contract.ts` 类型一致。
