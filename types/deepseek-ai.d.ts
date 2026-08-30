/**
 * @deepseek-ai 包模拟类型定义
 *
 * 用于本地开发和测试，实际运行时由 DSH 宿主框架提供。
 * 仅声明本仓库插件所依赖的 API 子集；运行时由真实框架实现，
 * 本地此文件仅作类型契约，不修改任何 @deepseek-ai/* 框架源码。
 */

// ===== 技能注册表（@deepseek-ai/dsh-skill 子集） =====
declare module '@deepseek-ai/dsh-skill' {
  /** 技能视图查询选项（cwd / signal / scope） */
  export interface SkillViewOptions {
    cwd?: string
    signal?: unknown
    scope?: unknown
  }

  /** 技能摘要（用于注入目录 / 记录 overview） */
  export interface SkillSummary {
    name: string
    description: string
    invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
    source?: string
    provider?: string
  }

  /** 分层技能注册表：全局层 + agent 作用域层；同名词条"最近作用域层"胜出 */
  export interface SkillRegistry {
    list(opts?: SkillViewOptions): Promise<SkillSummary[]>
    register(skill: {
      name: string
      description: string
      content?: string
      invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
    }): () => void
  }
}

// ===== 会话模型（@deepseek-ai/dsh-session 子集） =====
declare module '@deepseek-ai/dsh-session' {
  export interface SessionHeader {
    cwd: string
    [key: string]: unknown
  }

  /** agent.session.events 中的单条事件 */
  export interface SessionEvent {
    type: string
    data: Record<string, any>
    time?: number
    seq?: number
  }

  /** 会话对象（agent.session） */
  export interface Session {
    id: string
    header: SessionHeader
    events: SessionEvent[]
  }

  export type SessionId = string
}

// ===== Agent 运行期（@deepseek-ai/dsh-agent 子集） =====
declare module '@deepseek-ai/dsh-agent' {
  export interface Agent {
    /** 会话身份（与 ACP record.agent.session.id / session.history sessionId 同源） */
    id: import('@deepseek-ai/dsh-session').SessionId
    /** 会话对象（agent.session） */
    session: import('@deepseek-ai/dsh-session').Session
    /** agent 作用域上下文：其 .skills 注册表在本 agent 作用域层读写（注册即 agent-local） */
    ctx: import('@deepseek-ai/cordis').Context
  }

  /** agent/pre-step 返回的决策（reject 表示拒绝该步） */
  export type PreStepDecision = { kind: string; [key: string]: unknown }
}

// ===== Cordis 上下文（@deepseek-ai/cordis 子集，扩展宿主插件所需服务） =====
declare module '@deepseek-ai/cordis' {
  export interface Context {
    webServer: {
      // 与 @deepseek-ai/dsh-host-webserver 运行时一致：register 接收路由对象
      // { kind, path, handler }，handler 收到 node:http 的 IncomingMessage / ServerResponse。
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: any, res: any) => void
      }): void
    }
    // 事件订阅（DSH 运行时事件为字符串键，如 agent/session-start / agent/pre-step / agent/disposed）
    on(event: string, listener: (...args: any[]) => any): void
    once(event: string, listener: (...args: any[]) => any): void
    // 全局技能注册表服务（本插件主要从 agent.skills 的 agent 作用域层操作）
    skills: import('@deepseek-ai/dsh-skill').SkillRegistry
    // 效应作用域：回调内注册的资源随 ctx 销毁自动撤销
    effect(callback: () => void): void
  }

  export type Inject = string[]
}

declare module '@deepseek-ai/dsh-host-webserver' {
  // 空模块声明
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface ClientContext {
    slots: any
  }
}
