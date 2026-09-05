/**
 * 配置类型与加载（宿主端插件 dsh-debugger）
 *
 * 配置文件 dsh-debugger-config.json 置于本包根目录：
 * - rules：静态配置（禁用列表 / 关键字规则 / 自动裁剪阈值）
 * - skills：会话中存在的全部 SKILL 完整清单（每条仅 name/keyword/overview）
 * - skillsLog：增量变更审计流水（op: add/remove）
 * - usage：执行过程中实际被调用的 SKILL（count / lastUsedAt）
 *
 * 通过 fs.watch 热更新：文件变更后下一轮 agent/pre-step 重新计算有效禁用集。
 *
 * @module dsh-debugger/config
 */

import { readFileSync, watch, existsSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { flush as atomicFlush } from './records.js'

/** 关键字 → 前缀自动加载规则 */
export interface KeywordRule {
  keywords: string[]
  skillPrefix: string
}

/** 反馈规则（可选，用于"判断是否移除上下文 SKILL 以省 token"） */
export interface AutoTrim {
  enabled: boolean
  unusedTurnsThreshold: number
  keepKeywordMatched: boolean
}

/** skills 清单条目：仅三字段 */
export interface SkillRecord {
  name: string
  keyword: string
  overview: string
}

/** skillsLog 增量流水条目 */
export interface SkillLogEntry {
  at: string
  op: 'add' | 'remove'
  name: string
  keyword: string
  overview: string
}

/** usage 记录 */
export interface UsageRecord {
  count: number
  lastUsedAt: string
}

/**
 * 按 sessionId 记录"当前被 shadow 隐藏的技能名"，用于后续命中关键字后精确恢复。
 *
 * 真正的撤销句柄（disposer）是函数、无法序列化，故落盘只记**技能名清单**（审计 / 跨轮次追踪），
 * 实际恢复依赖进程内存中的 disposers（见 index.ts 的 sessions）。
 * 必须登记的原因：框架 `register` 对同名词条是 **first-wins**——重复注册会被忽略并返回
 * **no-op disposer**（撤销不了第一次的注册）。登记后可避免重复注册，保证 disposer 始终有效。
 */
export interface HiddenRecord {
  skills: string[]
  at: string
}

/** 调试模式配置：默认开启，在真实 LLM 接口调用前拦截，将请求参数写入 storageDomain（落盘临时文件） */
export interface DebugConfig {
  /** 是否启用调试拦截；默认 true */
  enabled: boolean
  /** storageDomain 领域名（经 json 后端持久化到 ~/.dsh/storages/<domain>.json） */
  domain: string
  /** 拦截后返回给会话的合成助手消息（用于让会话正常结束，不真正调用模型） */
  reply: string
}

/** 完整配置结构 */
export interface AutoEnableConfig {
  version: 1
  rules: {
    disabledSkills: string[]
    keywordRules: KeywordRule[]
    autoTrim: AutoTrim
  }
  skills: SkillRecord[]
  skillsLog: SkillLogEntry[]
  usage: Record<string, UsageRecord>
  /** sessionId → 当前被 shadow 隐藏的技能名清单（用于命中关键字后恢复） */
  hidden: Record<string, HiddenRecord>
  debug: DebugConfig
}

/** 默认配置（首次运行 / 文件损坏时回退） */
export function defaultConfig(): AutoEnableConfig {
  return {
    version: 1,
    rules: {
      disabledSkills: [],
      keywordRules: [],
      autoTrim: { enabled: false, unusedTurnsThreshold: 20, keepKeywordMatched: true },
    },
    skills: [],
    skillsLog: [],
    usage: {},
    hidden: {},
    debug: {
      enabled: true,
      domain: 'dsh-llm-debug',
      reply: '[DEBUG] LLM call blocked; request params recorded to a temp file.',
    },
  }
}

/**
 * 配置存储：加载 + fs.watch 热更新。
 *
 * 读取失败（JSON 损坏 / 缺字段）回退默认结构并继续，不阻断会话。
 */
export class ConfigStore {
  private current: AutoEnableConfig = defaultConfig()
  /**
   * 最近一次由本插件写出的文件内容。
   *
   * 本插件 **监听自己写的配置文件**：每次 flush 都会触发 fs.watch → reload() → 把
   * `current` 换成刚从磁盘解析出的新对象，从而**丢弃本轮正在进行的内存变更**
   * （表现为 hidden/审计字段改了却没落盘）。故记录自己写出的内容，watch 回调中
   * 若发现文件内容与本插件上次写出的一致，即判定为"自己的写入"并跳过 reload。
   */
  private lastWritten: string | undefined

  constructor(private readonly file: string) {
    this.reload()
    // 首次运行若文件不存在，写出默认结构，便于人工编辑与集成测试断言落点
    if (!existsSync(this.file)) this.flush()
  }

  /** 配置文件绝对路径 */
  get path(): string {
    return this.file
  }

  /** 当前配置（只读引用，调用方不应直接修改数组引用） */
  get(): AutoEnableConfig {
    return this.current
  }

  /** 从磁盘重新加载（合并默认结构，避免缺字段） */
  reload(): void {
    if (!existsSync(this.file)) {
      this.current = defaultConfig()
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<AutoEnableConfig>
      this.current = {
        ...defaultConfig(),
        ...parsed,
        rules: { ...defaultConfig().rules, ...parsed.rules },
        skills: parsed.skills ?? [],
        skillsLog: parsed.skillsLog ?? [],
        usage: parsed.usage ?? {},
        hidden: parsed.hidden ?? {},
        debug: { ...defaultConfig().debug, ...parsed.debug },
      }
    } catch {
      // 损坏回退默认并告警，不阻断会话
      this.current = defaultConfig()
    }
  }

  /**
   * 监听配置文件所在目录，文件名匹配时热重载。
   *
   * 观察者必须 `unref()`：否则 FSWatcher 会一直持有事件循环引用，导致 headless/CLI
   * 场景会话结束后进程无法退出（实测挂住直到被 timeout 杀掉）；而挂住的进程又会持续
   * 占用配置文件所在目录的句柄，使下一次 `flush` 的 rename 覆写报 Windows EPERM。
   * unref 后仍会在进程存活期间正常触发热重载（web 长驻进程不受影响）。
   *
   * 另：文件内容若与本插件上次写出的一致，判定为"自己的写入"并跳过 reload
   * （详见 lastWritten 注释）。
   */
  watch(onChange: () => void): void {
    const dir = dirname(this.file)
    const name = basename(this.file)
    const watcher = watch(dir, (_event, filename) => {
      if (filename !== name) return
      try {
        if (readFileSync(this.file, 'utf-8') === this.lastWritten) return
      } catch {
        // 读取失败按外部变更处理
      }
      this.reload()
      onChange()
    })
    watcher.unref()
  }

  /** 同步原子写盘（委托 records.flush：先写临时文件再 rename），避免半写文件 */
  flush(): void {
    this.lastWritten = JSON.stringify(this.current, null, 2)
    atomicFlush(this.file, this.current)
  }
}
