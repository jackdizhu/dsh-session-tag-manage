/**
 * 宿主侧 Typert RPC 服务：Web UI 手动标签更新（src/override.ts）。
 *
 * 需求（见 docs/design.md 第十二章 / spec manual-tag-update / 决策 7）：
 * - 客户端经 Typert RPC 调用宿主 `sessionTagOverride.set(sessionId, tag)`。
 * - 宿主依次校验：开关 `manualTagUpdateEnabled` → 标签 ∈ 五枚举闭集 → 会话存在；
 *   任一失败返回 `{ ok: false, reason }` 且不写入任何事件。
 * - 通过后追加一条 `source: 'user-override'` 的 `session-tag/assigned` 事件，
 *   投影 whole-value 快照"后写覆盖"自动同步标签数据与 UI 背景色。
 *
 * 实现说明（Typert SRC 源码模式，见 @deepseek-ai/dsh-typert-protocol README）：
 * - 继承 `TypertRemoteService`：构造时 `super(ctx, 'sessionTagOverride')` 完成
 *   Cordis 服务注册 + `bindTypertRemote` 绑定 Typert Gateway（协议包原生
 *   "显式绑定回退"路径，无需编译器生成宿主服务桩）。
 * - `@Remote` 装饰器标记 `set` 为可直接远程调用的公开实例方法；
 *   Gateway 的 SRC 回退路径经 `remoteMethods(service)` 发现并导出该方法。
 * - 客户端调用桩由构建时生成；本插件开发环境无 dsh CLI / Typert 编译器，
 *   客户端侧以手写类型合并桩（src/client/typert-stubs.ts）等价替代。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from './config'
import { VALID_TAGS, isSessionTag } from './events'
import type { SessionTag, TagId } from './events'

/** `set` 的业务返回（传输层包装见协议 `RemoteResult`，业务失败含 reason）。 */
export interface TagOverrideResult {
  ok: boolean
  reason?: string
}

/**
 * 宿主侧手动标签更新服务。
 *
 * 继承 `TypertRemoteService`：构造即注册 `sessionTagOverride` 服务并绑定 Typert
 * Gateway（服务随所属 fiber 卸载自动移除）。
 */
export class SessionTagOverrideService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'sessionTagOverride')
  }

  /**
   * 手动设置会话标签（Typert Remote 方法，wire 参数为 JSON 可序列化的普通值）。
   * @param sessionId - 目标会话 ID（wire 上为 string，宿主侧收窄为 SessionId 品牌）
   * @param tag - 五枚举之一（wire 上为 string，宿主侧校验后收窄为 SessionTag）
   * @returns 业务结果：`{ ok: true }` 表示已写入 user-override 事件；
   *   `{ ok: false, reason }` 表示校验失败且未写入任何事件
   */
  @Remote
  async set(sessionId: string, tag: SessionTag): Promise<TagOverrideResult> {
    // 校验 1：开关关闭 → 拒绝（客户端隐藏编辑入口只是交互层，此处为权威兜底）
    if (!this.config.manualTagUpdateEnabled) {
      return { ok: false, reason: 'manual tag update disabled' }
    }
    // 校验 2：标签不在五枚举闭集内 → 拒绝（isSessionTag 即运行时校验 VALID_TAGS）
    if (!isSessionTag(tag)) {
      return { ok: false, reason: 'invalid tag' }
    }
    // 校验 3：会话不存在 → 拒绝
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (!session) {
      return { ok: false, reason: 'session not found' }
    }
    // 全部通过：追加 user-override 标签事件（log-only、非 Surface、whole-value 快照）
    session.append('session-tag/assigned', {
      tagId: `tag-${session.id}` as TagId,
      tag,
      source: 'user-override',
      reason: 'web ui manual',
      assignedAt: Date.now(),
    })
    return { ok: true }
  }
}

/**
 * 注册手动标签更新服务（宿主入口调用，见 src/index.ts）。
 * @param ctx - Cordis Context（须已注入 `sessions` 服务）
 * @param config - 插件配置（`manualTagUpdateEnabled` 决定服务是否受理写入）
 * @returns 已注册的服务实例（构造即注册 + 绑定 Gateway）
 */
export function registerTagOverrideService(
  ctx: Context,
  config: Config,
): SessionTagOverrideService {
  return new SessionTagOverrideService(ctx, config)
}

/** 供类型合并桩（客户端）与测试引用的类型再导出。 */
export type { Session } from '@deepseek-ai/dsh-session'
