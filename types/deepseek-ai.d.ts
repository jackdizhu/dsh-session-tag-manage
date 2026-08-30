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

// ===== LLM 服务（@deepseek-ai/dsh-llm 子集） =====
// 真实运行时由 DSH 宿主框架提供；本地仅声明本插件拦截所需的 API 子集。
declare module '@deepseek-ai/dsh-llm' {
  /** 一次完整模型请求（拦截点 llm/stream 的入参 options） */
  export interface GenerateOptions {
    provider: string
    model: string
    reasoningEffort?: string
    messages: unknown[]
    system?: string
    tools?: unknown[]
    temperature?: number
    maxTokens?: number
    stop?: string[]
    signal?: unknown
    sessionId?: unknown
    purpose?: 'compaction' | 'session-title' | string
  }

  /** 流式分块（合成响应用到的子集） */
  export type StreamChunk =
    | { type: 'block-start'; index: number; blockType: string }
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'reasoning-delta'; index: number; text: string }
    | { type: 'block-end'; index: number; block: unknown }
    | { type: 'usage'; usage: unknown }
    | { type: 'finish'; reason: unknown }

  /** 内容块（block-end 的 block 字段） */
  export interface ContentBlock {
    type: string
    text?: string
    [key: string]: unknown
  }
}

// ===== 领域存储（@deepseek-ai/dsh-storage-domain 子集） =====
// 真实运行时由 DSH 宿主框架提供；本地仅声明本插件写入所需的 API 子集。
declare module '@deepseek-ai/dsh-storage-domain' {
  /** 领域声明：name / version / tables（记录 zod schema） */
  export function defineDomain(spec: any): any
  /** 声明一张 KV 表（key 类型 / value 类型 / zod 记录 schema） */
  export function domainTable(key?: any, valueSchema?: any): any
  /** 已打开领域的句柄（open 返回） */
  export interface Domain {
    table(name: string): {
      put(key: string, value: unknown): void
      get(key: string): unknown
      delete(key: string): void
      size: number
    }
    global: unknown
    close(): void
  }
  export type DomainSpec = any
}

// ===== zod（storage-domain 记录 schema 依赖） =====
// 仅作类型契约；运行时由 DSH 宿主框架的 node_modules 提供真实 zod。
declare module 'zod' {
  export const z: any
  export type ZodType = any
  export type ZodTypeAny = any
  export type infer<T> = any
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
    // LLM 运行时服务（拦截真实 LLM 调用所需的瀑布事件 llm/stream 绑定于此）
    llm: unknown
    // 存储枢纽（宿主根插件可直接 inject；storageDomain 形式在嵌套 ctx 上 provide，
    // 宿主根插件无法 inject，故调试落盘直接走 storage.backend 的 json KV 单元）
    storage: {
      backend: {
        get(name: string): {
          kv: {
            open(descriptor: any): Promise<{
              putRecord(table: string, key: string, value: unknown): Promise<void>
              deleteRecord(table: string, key: string): Promise<void>
              loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
              close(): Promise<void>
            }>
          }
        }
      }
    }
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
