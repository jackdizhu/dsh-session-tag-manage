/**
 * 客户端 → 宿主 Typert RPC 手写类型桩（src/client/typert-stubs.ts）。
 *
 * 背景（SRC 源码模式，见 src/override.ts 实现说明）：本插件开发环境无 dsh CLI /
 * Typert 编译器，无法在构建时生成客户端调用桩。此处以 **类型声明合并** 等价模拟
 * 编译器产物：
 * - 合并 `TypertRemoteNamespaceMap`，使 `ctx.remote.sessionTagOverride.set(...)`
 *   类型安全（宿主服务方法签名与客户端桩面同构，见 src/override.ts `@Remote set`）；
 * - 导出运行时解析器 `sessionTagOverrideRpc`：真实构建中编译器生成的桩经
 *   `TypertClientRemote.$mount(contribution)` 挂载到 `ctx.remote`；SRC 模式下
 *   运行时可能缺省，返回 undefined 由调用方优雅降级（保留原值并提示）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionTag } from '../events.ts'
import type { TagOverrideResult } from '../override.ts'

/** 声明合并：把 `sessionTagOverride` 命名空间并入 Typert 客户端远程表（等价编译器生成）。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    sessionTagOverride: {
      set(sessionId: string, tag: SessionTag): Promise<RemoteResult<TagOverrideResult>>
    }
  }
}

/** 客户端可调用的 `sessionTagOverride` 桩面（与声明合并结果同构，供解析函数与调用方引用）。 */
export interface SessionTagOverrideClient {
  set(sessionId: string, tag: SessionTag): Promise<RemoteResult<TagOverrideResult>>
}

/**
 * 解析客户端 Typert RPC 桩。
 * 真实构建：编译器生成的桩经 `$mount` 挂载到 `ctx.remote.sessionTagOverride`；
 * SRC 模式（无编译器）运行时可能缺省，返回 undefined 由调用方优雅降级。
 * @param ctx - 客户端 Cordis Context（`remote` 为客户端运行时提供的 TypertClientRemote）
 * @returns 桩面；缺省时 undefined
 */
export function sessionTagOverrideRpc(ctx: Context): SessionTagOverrideClient | undefined {
  const remote = (ctx as { remote?: { sessionTagOverride?: SessionTagOverrideClient } }).remote
  return remote?.sessionTagOverride
}
