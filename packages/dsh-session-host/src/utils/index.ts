/**
 * 工具函数统一导出
 *
 * @module utils
 */

export { StorageDomainManager } from './storage-domain.js'
export type { DomainInstance, DomainSpec } from './storage-domain.js'

export {
  readWorkspaceTags,
  writeWorkspaceTags,
  deleteWorkspaceFile,
  listWorkspaceIds,
  workspaceFileExists,
} from './file-storage.js'
