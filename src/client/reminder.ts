/**
 * 每日会话梳理桌面提醒（客户端，src/client/reminder.ts）。
 *
 * 需求（见 docs/design.md 第十一章 / spec daily-reminder）：
 * - 每日 `dailyReminderTime`（默认 17:00）执行一次梳理提醒，`desktopReminderEnabled` 为总开关。
 * - 统计口径：**当天有活动**（投影 `lastActiveAt` 落在本地时区今日）且标签 ∈ {`abnormal_end`, `waiting`}
 *   的会话；两项计数皆 0 时不打扰。
 * - 载体：浏览器 Web Notifications API（页签未激活也能展示）；权限拒绝时静默降级（不打扰、不报错）。
 * - 后台节流兜底：浏览器对后台页签 `setTimeout` 节流，补充监听 `visibilitychange` / `window.focus`——
 *   页面重新可见且已过今日提醒时刻、今日尚未提醒时立即补查。
 * - 去重：`localStorage['last-notified-date']` 记录最近一次提醒的本地日期（YYYY-MM-DD）。
 *
 * 说明：统计 / 文案 / 时间计算为纯函数（可单测），排程 / 通知 / 事件监听为 DOM 侧，经 `ctx.effect` 托管。
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { Config } from '../config'
import type { SessionTag } from '../events'
import '../projection-types' // 副作用导入：激活 SessionProjectionMap 声明合并（typecheck）

/** localStorage 去重键：记录最近一次提醒的本地日期（YYYY-MM-DD）。带插件命名空间避免与同源其它插件冲突。 */
const LAST_NOTIFIED_KEY = 'dsh-session-tag-manage:last-notified-date'

/** 需纳入提醒统计的待关注标签闭集。 */
const ATTENTION_TAGS: ReadonlySet<SessionTag> = new Set(['waiting', 'abnormal_end'])

/** 投影标签值的结构最小面（与 SessionSummary.projectionValues['session-tag'] 对齐，供纯函数解耦）。 */
export interface TagProjectionLike {
  tag?: SessionTag | null
  lastActiveAt?: number | null
}

/** 单个会话投影的最小结构（解耦 SessionSummary 全量字段，便于单测构造）。 */
export interface TagSummaryLike {
  projectionValues?: {
    'session-tag'?: TagProjectionLike
  }
}

/** 今日活动统计结果：两项计数（waiting / abnormal_end）。 */
export interface TodayCounts {
  waiting: number
  abnormal: number
}

/** 判断两个 Date 是否属同一本地自然日。 */
export function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * 统计今日有活动且标签 ∈ {waiting, abnormal_end} 的会话数。
 * 无投影 / 标签为空 / lastActiveAt 为空 / 非今日活动 的会话一律不计入。
 * @param byId - 会话投影表（`SessionListState.byId` 即可）。
 * @param now - 统计基准时刻（默认当前时间，便于测试注入固定日期）。
 */
export function countTodaySessions(
  byId: Record<string, TagSummaryLike>,
  now: Date = new Date(),
): TodayCounts {
  let waiting = 0
  let abnormal = 0
  for (const summary of Object.values(byId)) {
    const projection = summary.projectionValues?.['session-tag']
    if (!projection?.tag || projection.lastActiveAt == null) continue
    if (!ATTENTION_TAGS.has(projection.tag)) continue
    if (!isSameLocalDate(new Date(projection.lastActiveAt), now)) continue
    if (projection.tag === 'waiting') waiting += 1
    else abnormal += 1
  }
  return { waiting, abnormal }
}

/**
 * 组装通知文案：`有 XX 个会话等待确认、XX 个会话异常`。
 * 两项皆 0 时返回 null（调用方不打扰）。
 */
export function formatReminderText(counts: TodayCounts): string | null {
  const { waiting, abnormal } = counts
  if (waiting === 0 && abnormal === 0) return null
  return `有 ${waiting} 个会话等待确认、${abnormal} 个会话异常`
}

/** 本地日期键（YYYY-MM-DD），用于去重与"今日"判定。 */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 解析 HH:mm 为"时 * 60 + 分"（调用方保证配置已通过 Schema 格式校验）。
 * 防御非法输入：任一字段非数字时回退默认 17:00（分钟数 1020），避免 NaN 传染
 * 导致 `setTimeout(cb, NaN)` 被当作 0 从而无延迟死循环刷屏。
 */
function minutesOfDay(time: string): number {
  const [hh, mm] = time.split(':').map(Number)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 17 * 60 + 0
  return hh * 60 + mm
}

/**
 * 计算距下一个 `HH:mm` 时刻的毫秒数（严格未来：今日该时刻已过则排到明天）。
 * @param time - HH:mm 格式。
 * @param now - 基准时刻（默认当前时间，便于测试注入）。
 */
export function msUntil(time: string, now: Date = new Date()): number {
  const target = new Date(now)
  target.setHours(Math.floor(minutesOfDay(time) / 60), minutesOfDay(time) % 60, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  return target.getTime() - now.getTime()
}

/** 判断当前时刻是否已过 `HH:mm`（含恰好等于该时刻）。 */
export function isPastReminderTime(time: string, now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() >= minutesOfDay(time)
}

/**
 * 注册每日提醒：开关关闭时直接返回（不排程、不弹）。
 * @param ctx - 客户端 Cordis Context（须已注入 sessions 服务）。
 * @param config - 插件配置（dailyReminderTime / desktopReminderEnabled）。
 */
export function setupDailyReminder(ctx: ClientContext, config: Config): void {
  if (!config.desktopReminderEnabled) return
  const sessions = ctx.sessions as unknown as ISessions

  /** 当日已提醒标记（localStorage 读失败视为未提醒）。 */
  function lastNotifiedToday(): boolean {
    try {
      return localStorage.getItem(LAST_NOTIFIED_KEY) === todayKey()
    } catch {
      return false
    }
  }

  /** 标记今日已提醒。 */
  function markNotifiedToday(): void {
    try {
      localStorage.setItem(LAST_NOTIFIED_KEY, todayKey())
    } catch {
      // 隐私模式 / 存储不可用：静默忽略，去重仅尽力而为
    }
  }

  /**
   * 真正弹出桌面通知（仅实际弹出成功时标记今日已提醒）。
   * 竞态防护：
   * - `notifyInFlight`：requestPermission 异步窗口内（visibilitychange 与 focus 几乎同时触发）
   *   避免重复发起，杜绝同一天弹两次；
   * - `disposed`：插件卸载后异步权限回调不得再弹通知；
   * - 先 `new Notification` 成功后再标记今日，构造抛异常时不写标记（允许当日重试）。
   */
  let notifyInFlight = false
  let disposed = false
  function notify(): void {
    if (typeof Notification === 'undefined') return
    if (lastNotifiedToday()) return // 当日已提醒过：定时器与聚焦两条路径共用，统一在此去重
    if (notifyInFlight) return // 权限请求未决期间去重（防止 default 权限下双触发）
    notifyInFlight = true
    const finish = (): void => {
      notifyInFlight = false
    }
    const counts = countTodaySessions(sessions.list.getSnapshot().byId)
    const body = formatReminderText(counts)
    if (!body) {
      finish()
      return
    }
    const deliver = (): void => {
      if (disposed) {
        finish()
        return
      }
      try {
        // eslint-disable-next-line no-new
        new Notification('会话梳理提醒', { body })
        markNotifiedToday()
      } catch {
        // 构造失败：不写标记，允许当日重试
      } finally {
        finish()
      }
    }
    if (Notification.permission === 'granted') {
      deliver()
      return
    }
    if (Notification.permission === 'denied') {
      finish() // 拒绝：静默降级，不打扰不报错
      return
    }
    // 尚未决定：请求权限，授权成功才弹（失败静默）
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') deliver()
      else finish()
    })
  }

  // 定时排程循环：到点执行并排下一天（浏览器后台节流时可能延迟，由聚焦兜底补齐）
  let timer = 0
  function schedule(): void {
    timer = window.setTimeout(() => {
      notify()
      schedule()
    }, msUntil(config.dailyReminderTime))
  }

  // 聚焦 / 可见性兜底：已过今日提醒时刻且今日未提醒过 → 立即补查
  function checkFocus(): void {
    if (document.visibilityState !== 'visible') return
    if (!isPastReminderTime(config.dailyReminderTime)) return
    if (lastNotifiedToday()) return
    notify()
  }

  // 启动：排程 + 初始补查（覆盖"加载时已过提醒时刻"场景）+ 事件监听
  schedule()
  checkFocus()
  document.addEventListener('visibilitychange', checkFocus)
  window.addEventListener('focus', checkFocus)

  // 插件卸载：回收定时器与监听器；置 disposed 阻止异步权限回调继续弹通知
  ctx.effect(
    () => () => {
      disposed = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkFocus)
      window.removeEventListener('focus', checkFocus)
    },
    'session-tag-manage.reminder.dispose',
  )
}
