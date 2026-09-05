/**
 * 调试模式拦截（宿主端插件 dsh-debugger）
 *
 * 利用 DSH 的 `llm/stream` 瀑布事件（绑定于 `ctx.llm`，由 LlmRuntime 发出）：
 * 在每一轮真实模型流式调用前拦截。调试模式（默认开启）下：
 *   1. 将完整请求参数（GenerateOptions）清洗后写入 storage（经 json 后端
 *      持久化到 ~/.dsh/storages/<unit>.json 临时文件）；
 *   2. 不调用真实 LLM（不执行 next()），直接合成一条助手文本流式响应让会话正常结束。
 * 调试模式关闭时透传 next()，行为等同不装此插件。
 *
 * 说明：storageDomain 形式由 @deepseek-ai/dsh-storage-domain 在“嵌套 ctx”上 provide，
 * 宿主根插件无法 inject 到（与早前 agent.ctx.skills 同源限制）；故直接走 storage 枢纽
 * 的 json 后端 KV 单元（同一份落盘文件，语义等价）。storage 后端不可用时回退为直接写
 * os.tmpdir() 下的 JSON 文件，保证“参数落盘临时文件”这一核心诉求不被阻断。
 *
 * @module dsh-debugger/debug
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AutoEnableConfig, ConfigStore, DebugConfig } from './config.js'

/** 单条被拦截请求的参数记录 */
interface LlmDebugRequest {
  id: string
  sessionId?: string
  purpose?: string
  provider: string
  model: string
  time: number
  /** 清洗后的完整请求参数（已剔除 signal，深拷贝可序列化） */
  request: unknown
}

/** 持久化单元名（须匹配 storage 后端的 UNIT_NAME_RE：小写字母/数字/下划线） */
const UNIT = 'dsh_llm_debug'
const TABLE = 'requests'

/** KV 单元描述符（等价于一个无 schema 校验的领域单元） */
const unitDescriptor = {
  name: UNIT,
  version: 1,
  tables: [TABLE],
  hasGlobal: false,
  layout: 'single' as const,
}

/**
 * 清洗请求参数：剔除不可序列化的 `signal`（AbortSignal），并深拷贝为纯数据，
 * 避免持久化冻结对象或引用循环。返回可安全 JSON 化的副本。
 */
function sanitize(options: unknown): unknown {
  const src = (options ?? {}) as Record<string, unknown>
  const rest: Record<string, unknown> = {}
  for (const key of Object.keys(src)) {
    if (key === 'signal') continue
    rest[key] = src[key]
  }
  try {
    return JSON.parse(JSON.stringify(rest))
  } catch {
    // 极端情况下退化为剔除 signal 的浅拷贝
    return rest
  }
}

/**
 * 合成调试响应流：与真实适配器同构的分块序列
 * （block-start → text-delta → block-end → finish），让会话按正常助手消息结束。
 */
async function* debugStream(text: string): AsyncIterable<unknown> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * 安装调试模式拦截。
 *
 * @param ctx - 插件上下文（须 inject `llm` 与 `storage`）
 * @param store - 配置存储（读取 debug.enabled / reply）
 */
export function installDebugMode(ctx: Context, store: ConfigStore): void {
  let unitPromise: Promise<unknown> | undefined
  let useFallback = false

  /** 懒打开 KV 单元；任何失败转回退模式（直接写 os.tmpdir 文件） */
  const openUnit = (): Promise<unknown> | undefined => {
    if (useFallback) return undefined
    if (!unitPromise) {
      unitPromise = Promise.resolve()
        .then(() => {
          const backend = (ctx.storage as any).backend.get('json')
          if (!backend?.kv) throw new Error('json backend kv facet unavailable')
          return backend.kv.open(unitDescriptor)
        })
        .catch((err) => {
          useFallback = true
          unitPromise = undefined
          // 存储不可用不应阻断会话：回退路径继续落盘
          void err
          return undefined
        })
    }
    return unitPromise
  }

  /** 落盘一条请求记录：优先 storage json 后端，失败/回退写临时文件。返回落地位置描述。 */
  const record = async (rec: LlmDebugRequest): Promise<string> => {
    const unit = await openUnit()
    if (unit) {
      try {
        await (unit as any).putRecord(TABLE, rec.id, rec)
        return `storage backend (~/.dsh/storages/${UNIT}.json)`
      } catch {
        // 落盘失败转回退，不抛出
      }
    }
    // storage / storageDomain 在宿主根插件不可 inject（确认的限制）→ 回退写 os.tmpdir 临时文件。
    // debug.domain 同时作为临时文件名前缀，使配置字段具实际语义（呼应 storageDomain 命名）。
    const prefix = store.get().debug.domain || 'dsh-llm-debug'
    const file = join(tmpdir(), `${prefix}-${rec.id}.json`)
    try {
      writeFileSync(file, JSON.stringify(rec, null, 2), 'utf-8')
      return file
    } catch {
      // 终极兜底：忽略写入失败，仅内存记录
      return '(<write failed: could not write temp file>)'
    }
  }

  ctx.on('llm/stream', async function* (options: unknown, next: () => AsyncIterable<unknown>) {
    const cfg: AutoEnableConfig = store.get()
    const debug: DebugConfig = cfg.debug
    if (!debug.enabled) {
      // 调试关闭：透传真实适配器，行为等同不装此插件
      yield* next()
      return
    }
    // 调试开启：拦截真实 LLM 调用，记录参数，合成响应
    const src = (options ?? {}) as Record<string, unknown>
    const id = randomUUID()
    const rec: LlmDebugRequest = {
      id,
      sessionId: typeof src.sessionId === 'string' ? src.sessionId : undefined,
      purpose: typeof src.purpose === 'string' ? src.purpose : undefined,
      provider: String(src.provider ?? ''),
      model: String(src.model ?? ''),
      time: Date.now(),
      request: sanitize(options),
    }
    // 先落盘参数（storage 不可达时回退 os.tmpdir），再返回合成流，确保会话结束前写入完成。
    // 把落地位置回显到合成回复，便于定位实际生成的临时文件（避免误以为"未输出"）。
    const location = await record(rec)
    yield* debugStream(`${debug.reply}\n→ params: ${location}`)
  })
}
