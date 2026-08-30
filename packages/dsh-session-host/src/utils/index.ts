/**
 * 工具函数统一导出
 *
 * @module utils
 */

// ===== 存储工具 =====

export { StorageDomainManager } from './storage-domain.js'
export type { DomainInstance, DomainSpec } from './storage-domain.js'

export {
  readWorkspaceTags,
  writeWorkspaceTags,
  deleteWorkspaceFile,
  listWorkspaceIds,
  workspaceFileExists,
} from './file-storage.js'

// ===== RPC 通信工具 =====

export {
  dshRpcCall,
  fetchWorkspaceList,
} from './rpc-client.js'
export type {
  DshRpcRequest,
  DshRpcResponse,
  DshRpcSuccessResponse,
  DshRpcErrorResponse,
  DshRpcResult,
  DshRpcCallOptions,
  WorkspaceListParams,
  WorkspaceItem,
  WorkspaceListValue,
} from './rpc-client.js'

// ===== Session History 事件处理工具 =====

export {
  EventType,
  foldStats,
  fetchSessionHistory,
  fetchAllSessionEvents,
  extractUserMessages,
  extractFileOperations,
  extractSessionTitle,
  splitTurns,
  classifyRoundEndReason,
} from './session-history.js'
export type {
  SessionHistoryEvent,
  UserMessageData,
  AssistantMessageData,
  ToolCallData,
  ToolResultData,
  SessionTitleData,
  TurnStartData,
  TurnEndData,
  StepStartData,
  SessionHistoryValue,
  SessionHistoryParams,
  ToolCallStat,
  SessionStats,
} from './session-history.js'
