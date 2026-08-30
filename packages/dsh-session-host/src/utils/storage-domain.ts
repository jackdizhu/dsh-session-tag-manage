/**
 * 存储域通用工具
 *
 * 提供通用的存储域查找与自动创建能力：
 * - getOrCreateDomain：获取存储域实例，不存在时自动创建
 * - 内部维护已打开域的缓存，避免重复打开
 *
 * @module utils/storage-domain
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainSpec as DshDomainSpec } from '@deepseek-ai/dsh-storage-domain'

/**
 * 存储域实例类型（与 DSH 运行时 Domain 一致）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DomainInstance {
  global: {
    get(): unknown
    set(value: unknown): Promise<void>
  }
  close(): Promise<void>
}

/** 域定义 spec 类型（透传 DSH 真实类型） */
export type DomainSpec = DshDomainSpec

/**
 * 存储域管理器
 *
 * 维护一个 Map<域名, DomainInstance> 缓存，
 * 首次访问时自动调用 ctx.storageDomain.open() 创建。
 *
 * 使用方式：
 * ```typescript
 * const manager = new StorageDomainManager(ctx)
 * const domain = await manager.getOrCreate(tagDomainSpec)
 * const data = domain.global.get()
 * ```
 */
export class StorageDomainManager {
  /** 已打开的存储域缓存 */
  private domains = new Map<string, DomainInstance>()

  constructor(private readonly ctx: Context) {}

  /**
   * 获取或创建存储域
   *
   * 优先从缓存中查找；缓存未命中时调用 ctx.storageDomain.open() 创建，
   * 创建成功后写入缓存供后续复用。
   *
   * @param spec - 域定义（由 defineDomain 生成）
   * @returns 已打开的存储域实例
   */
  async getOrCreate(spec: DomainSpec): Promise<DomainInstance> {
    const cached = this.domains.get(spec.name)
    if (cached) return cached

    const domain = await this.ctx.storageDomain.open(spec) as DomainInstance

    // 首次打开时，调用 set(initial) 触发持久化到磁盘
    // DSH storageDomain 的 initial 值只在内存中返回，
    // 直到第一次 set() 调用才会写入磁盘文件
    if (spec.global?.initial !== undefined) {
      const current = domain.global.get()
      // 仅在从未写入过时触发（current 与 initial 相同说明未持久化）
      if (JSON.stringify(current) === JSON.stringify(spec.global.initial)) {
        await domain.global.set(current)
      }
    }

    this.domains.set(spec.name, domain)
    return domain
  }

  /**
   * 检查存储域是否已持久化（已调用过 set）
   *
   * @param spec - 域定义
   * @returns true 表示数据已写入磁盘，false 表示仍为 initial 值
   */
  isPersisted(spec: DomainSpec): boolean {
    const domain = this.domains.get(spec.name)
    if (!domain || spec.global?.initial === undefined) return false
    const current = domain.global.get()
    return JSON.stringify(current) !== JSON.stringify(spec.global.initial)
  }

  /**
   * 获取已打开的存储域（不触发自动创建）
   *
   * @param domainName - 域名
   * @returns 已打开的域实例，不存在返回 undefined
   */
  get(domainName: string): DomainInstance | undefined {
    return this.domains.get(domainName)
  }

  /**
   * 关闭指定存储域并从缓存中移除
   *
   * @param domainName - 域名
   */
  async close(domainName: string): Promise<void> {
    const domain = this.domains.get(domainName)
    if (domain) {
      await domain.close()
      this.domains.delete(domainName)
    }
  }

  /**
   * 关闭所有已打开的存储域
   */
  async closeAll(): Promise<void> {
    for (const [name, domain] of this.domains) {
      try {
        await domain.close()
      } catch (err) {
        console.error(`[StorageDomainManager] 关闭存储域 ${name} 失败:`, err)
      }
    }
    this.domains.clear()
  }

  /**
   * 获取当前缓存中已打开的域数量
   */
  get size(): number {
    return this.domains.size
  }
}
