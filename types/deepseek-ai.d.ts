/**
 * @deepseek-ai 包模拟类型定义（本地开发/测试用，运行时由 DSH 宿主框架提供）
 *
 * ⚠️ 根 tsconfig 通过 paths 把**所有** `@deepseek-ai/*` 映射到本文件：
 * 即本文件是一个单一模块，须在顶层 export 全部被引用的类型名。
 * 各导出对应的真实包名以注释标注（cordis / dsh-agent / dsh-session /
 * dsh-skill / dsh-commands / dsh-client-runtime）。
 *
 * 契约依据：git-source/deepseek-harness 源码实证
 *   - PreStepDecision：packages/core/agent/src/runtime-types.ts
 *   - CommandResult / CommandInvocation：packages/interaction/commands
 *   - commands.register 入参：packages/compaction/command-compact、command-feedback
 */

/** cordis 插件上下文（@deepseek-ai/cordis） */
export interface Context {
  /**
   * 事件监听（字符串键事件：agent/pre-step、agent/disposed、冒泡的 llm/stream 等）。
   * 监听器载荷异构（各事件结构不同），统一 any[] 承接、由调用处以具体类型标注收窄。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上：事件载荷异构，框架侧无统一载荷类型
  on(event: string, listener: (...args: any[]) => unknown): unknown
  /** 生命周期托管：返回 disposer，随插件卸载自动回收 */
  effect(fn: () => unknown, name?: string): unknown
  /** 日志（宿主提供，可能缺席） */
  logger?: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  /** 技能注册表（宿主根插件可 inject；list 返回当前可技能清单） */
  skills: {
    list(options: SkillViewOptions): Promise<SkillListItem[]>
    register(...args: unknown[]): unknown
  }
  /** 指令注册表（宿主根插件可 inject；register 返回 disposer；重名抛错） */
  commands: {
    register(command: {
      name: string
      description: string
      input?: { hint?: string }
      recordInput?: boolean
      handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
    }): () => void
  }
  /** Web 路由注册（与 @deepseek-ai/dsh-host-webserver 运行时一致） */
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: unknown, res: unknown) => void
    }): void
  }
  /**
   * 存储枢纽（宿主根插件**不可 inject**，运行时才可能存在；
   * 调用方须以可选链 + try/catch 直读 json 后端 KV 单元）。
   */
  storage?: {
    backend: { get(name: string): unknown }
  }
}

/** agent 实体（@deepseek-ai/dsh-agent；仅声明本插件消费的最小面） */
export interface Agent {
  session: {
    id: string
    header: { cwd: string }
    events: SessionEvent[]
  }
}

/** pre-step 决策（@deepseek-ai/dsh-agent；与 core/agent/runtime-types 实证一致，reject 无文本字段） */
export type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }

/** 会话事件（@deepseek-ai/dsh-session；变体由 data 承载，按 type 收窄） */
export interface SessionEvent {
  type: string
  data?: Record<string, unknown>
}

/** 技能查询选项（@deepseek-ai/dsh-skill） */
export interface SkillViewOptions {
  cwd: string
  scope: unknown
}

/** 技能清单条目（skills.list 返回） */
export interface SkillListItem {
  name: string
  description: string
}

/** 指令调用载荷（@deepseek-ai/dsh-commands） */
export interface CommandInvocation {
  commandId: string
  agent: Agent
  rawInput: string
  signal: AbortSignal
}

/** 指令执行结果（@deepseek-ai/dsh-commands；success.text 经 command/done 渲染为持久 flow 节点） */
export type CommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

/** 客户端上下文（@deepseek-ai/dsh-client-runtime/client） */
export interface ClientContext {
  slots: unknown
}
