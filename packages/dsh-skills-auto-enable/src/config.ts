/**
 * 配置类型与加载（宿主端插件 dsh-skills-auto-enable）
 *
 * 配置文件 dsh-skills-auto-enable-config.json 置于本包根目录：
 * - rules：静态配置（禁用列表 / 关键字规则 / 自动裁剪阈值）
 * - skills：会话中存在的全部 SKILL 完整清单（每条仅 name/keyword/overview）
 * - skillsLog：增量变更审计流水（op: add/remove）
 * - usage：执行过程中实际被调用的 SKILL（count / lastUsedAt）
 *
 * 通过 fs.watch 热更新：文件变更后下一轮 agent/pre-step 重新计算有效禁用集。
 *
 * @module dsh-skills-auto-enable/config
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
   */
  watch(onChange: () => void): void {
    const dir = dirname(this.file)
    const name = basename(this.file)
    const watcher = watch(dir, (_event, filename) => {
      if (filename === name) {
        this.reload()
        onChange()
      }
    })
    watcher.unref()
  }

  /** 同步原子写盘（委托 records.flush：先写临时文件再 rename），避免半写文件 */
  flush(): void {
    atomicFlush(this.file, this.current)
  }
}
