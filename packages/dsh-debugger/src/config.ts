/**
 * 配置类型与加载（宿主端插件 dsh-debugger）
 *
 * 配置文件 dsh-debugger-config.json 置于本包根目录，仅保留与本插件相关的两项：
 * - version：配置结构版本（当前恒为 1）
 * - debug：调试模式配置（enabled 全局开关 / domain 存储领域 / reply 合成回复）
 *
 * 旧版 dsh-skills-auto-enable 遗留的 rules/skills/skillsLog/usage/hidden 字段
 * 已全部移除，不再写入配置文件。
 *
 * 通过 fs.watch 热更新：文件变更后 /debugger 指令与 headless 兜底读取最新开关状态。
 *
 * @module dsh-debugger/config
 */

import { readFileSync, watch, existsSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { flush as atomicFlush } from './records.js'

/**
 * 调试模式配置：全局开关，默认关闭（装上不拦截真实 LLM 调用，需 `/debugger on`
 * 显式开启）。经 `/debugger [on|off|status]` 指令或 headless 兜底改写本字段并落盘，
 * fs.watch 自跳 reload（lastWritten 相同）后同进程即时生效、跨重启保持。
 */
export interface DebugConfig {
  /**
   * 是否启用调试拦截（全局）。
   * 默认 false（装上不拦截，需 /debugger on 开启）；置 true 后全部会话拦截 LLM。
   */
  enabled: boolean
  /** storageDomain 领域名（经 json 后端持久化到 ~/.dsh/storages/<domain>.json） */
  domain: string
  /** 拦截后返回给会话的合成助手消息（用于让会话正常结束，不真正调用模型） */
  reply: string
}

/** 完整配置结构（仅本插件相关的两项） */
export interface DebuggerConfig {
  version: 1
  debug: DebugConfig
}

/** 兼容别名：历史代码 / 测试中的旧类型名 */
export type AutoEnableConfig = DebuggerConfig

/** 默认配置（首次运行 / 文件损坏时回退） */
export function defaultConfig(): DebuggerConfig {
  return {
    version: 1,
    debug: {
      enabled: false,
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
  private current: DebuggerConfig = defaultConfig()
  /**
   * 最近一次由本插件写出的文件内容。
   *
   * 本插件 **监听自己写的配置文件**：每次 flush 都会触发 fs.watch → reload() → 把
   * `current` 换成刚从磁盘解析出的新对象，从而**丢弃本轮正在进行的内存变更**
   * （表现为 debug.enabled 改了却没落盘）。故记录自己写出的内容，watch 回调中
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

  /** 当前配置（只读引用，调用方不应直接修改引用内容） */
  get(): DebuggerConfig {
    return this.current
  }

  /** 从磁盘重新加载（合并默认结构，避免缺字段） */
  reload(): void {
    if (!existsSync(this.file)) {
      this.current = defaultConfig()
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<DebuggerConfig>
      this.current = {
        version: 1,
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

  /**
   * 设置全局调试开关并立即落盘。
   *
   * `/debugger on|off` 指令与 headless pre-step 兜底的**唯一写入口**：先更新内存
   * `current`（同进程拦截判定即时读取生效），再 flush 写盘（跨重启保持）。flush
   * 记录的 lastWritten 与 watch 回调比对一致 → 判定"自己的写入"跳过 reload，
   * 不会丢弃本轮变更。
   */
  setDebugEnabled(enabled: boolean): void {
    this.current = { ...this.current, debug: { ...this.current.debug, enabled } }
    this.flush()
  }
}
