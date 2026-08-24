/**
 * 插件配置：Schemastery Schema 定义 7 个可配置字段。
 *
 * 字段说明：
 * - delayMs：AI 回复正常结束后延迟打标时长（默认 7 分钟）
 * - analysisModel：规则判不了时用于语义判定的模型 id
 * - analysisProvider：LLM 兜底判定的 provider 路由（默认 deepseek）
 * - maxLastTurnMessages：参与分析的最后一轮消息条数上限
 * - highlightTags：需要重点高亮（Web UI 强调色）的标签集合
 * - dailyReminderTime：每日会话梳理提醒时间，HH:mm 格式（默认 17:00）
 * - desktopReminderEnabled：浏览器桌面通知总开关（默认开启）
 * - manualTagUpdateEnabled：Web UI 手动改标签开关（默认开启）
 */
import Schema from '@deepseek-ai/schemastery'

/** 插件配置输出类型（由 Schema.object 校验后得到）。 */
export interface Config {
  /** 延迟分析时长（毫秒），默认 7 分钟 */
  delayMs: number
  /** 用于标签语义判定的模型 id */
  analysisModel: string
  /** LLM 兜底判定的 provider 路由 */
  analysisProvider: string
  /** 参与分析的最后一轮消息条数上限 */
  maxLastTurnMessages: number
  /** 需要重点高亮的标签集合 */
  highlightTags: string[]
  /** 每日会话梳理提醒时间（HH:mm），运行时校验格式 */
  dailyReminderTime: string
  /** 浏览器桌面消息提醒开关 */
  desktopReminderEnabled: boolean
  /** Web UI 手动更新标签开关 */
  manualTagUpdateEnabled: boolean
}

/** 配置 Schema：默认值与格式校验。 */
export const Config: Schema<Config> = Schema.object({
  delayMs: Schema.number().default(7 * 60 * 1000),
  analysisModel: Schema.string().default('deepseek-v4-flash'),
  analysisProvider: Schema.string().default('deepseek'),
  maxLastTurnMessages: Schema.number().default(50),
  highlightTags: Schema.array(Schema.string()).default(['abnormal_end', 'waiting']),
  // HH:mm 格式运行时校验：00:00 ~ 23:59
  dailyReminderTime: Schema.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('17:00'),
  desktopReminderEnabled: Schema.boolean().default(true),
  manualTagUpdateEnabled: Schema.boolean().default(true),
})
