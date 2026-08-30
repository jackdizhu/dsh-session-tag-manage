/**
 * 浏览器端 UUID v4 生成工具
 *
 * 优先使用浏览器原生 crypto.randomUUID()，
 * 降级使用 Math.random() 手动拼接。
 *
 * 从 host utils/rpc-client.ts 的 generateUuid() 提取，
 * 适配浏览器环境（无 Node.js crypto 模块）。
 *
 * @module client/utils/uuid
 */

/** 生成 UUID v4 */
export function generateRpcId(): string {
  // 浏览器原生支持
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 降级：手动拼接
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
