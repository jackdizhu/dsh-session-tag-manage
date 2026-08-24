// dsh-type-meta 本地类型 stub（仅供独立 typecheck 使用）
// 官方包为类型级元数据工具，宿主运行时提供；此处仅满足 dsh-session 的 `TypeRTLookup` 引用面。

/**
 * 类型级运行时查找的占位类型。
 * 真实实现为运行时类型元数据注册表；本 stub 仅保证类型解析通过。
 */
export type TypeRTLookup<T = unknown, Id = string> = {
  readonly __nominal: T
  readonly __id: Id
}

/**
 * 各模块注册的类型元数据查找表（合并扩展）。
 */
export interface TypeRTLookupMap {}

// 空运行时实现：本包无运行时代码，import 时不会真正执行
export {}
