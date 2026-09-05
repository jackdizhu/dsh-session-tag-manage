/**
 * SKILL 增量记录（宿主端插件 dsh-debugger）
 *
 * 维护两类数据：
 * - skills：当前会话上下文中存在的全部 SKILL 完整清单（name/keyword/overview）
 * - skillsLog：增量变更审计流水（op: add/remove）
 * - usage：执行过程中实际被调用的 SKILL（count / lastUsedAt）
 *
 * 落盘采用"先写临时文件再 fs.rename 原子替换"，避免多会话并发写损坏文件。
 *
 * @module dsh-debugger/records
 */

import { writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs'
import type { AutoEnableConfig, SkillRecord, UsageRecord } from './config.js'

/** skillsLog 上限：超出后裁剪最早的审计条目，避免流水无界增长导致配置文件膨胀 */
const MAX_LOG = 500

/**
 * 增量维护 skills 清单并追加 skillsLog 流水。
 * - op='add'：清单中无同名则追���
 * - op='remove'：清单中有同名则移除
 * 每次调用都追加一条 skillsLog（审计差异）；流水超过 MAX_LOG 时裁剪最早条目。
 */
export function upsertSkill(cfg: AutoEnableConfig, rec: SkillRecord, op: 'add' | 'remove'): void {
  const idx = cfg.skills.findIndex((s) => s.name === rec.name)
  if (op === 'add' && idx < 0) cfg.skills.push({ ...rec })
  if (op === 'remove' && idx >= 0) cfg.skills.splice(idx, 1)
  cfg.skillsLog.push({
    at: new Date().toISOString(),
    op,
    name: rec.name,
    keyword: rec.keyword,
    overview: rec.overview,
  })
  if (cfg.skillsLog.length > MAX_LOG) {
    cfg.skillsLog.splice(0, cfg.skillsLog.length - MAX_LOG)
  }
}

/** 观测到技能被调用 → usage 累加（count+1，lastUsedAt 更新） */
export function recordUsage(cfg: AutoEnableConfig, name: string): void {
  const now = new Date().toISOString()
  const prev: UsageRecord = cfg.usage[name] ?? { count: 0, lastUsedAt: now }
  cfg.usage[name] = { count: prev.count + 1, lastUsedAt: now }
}

/**
 * 落盘：优先原子写（先写 `<file>.tmp` 再 rename 替换，落盘期间不出现半写文件）。
 *
 * Windows 上 rename 覆写已存在文件常因目标被其他进程/观察器/杀毒软件占用而抛 EPERM
 * （多 profile 共享同一配置文件时尤甚，曾导致 `dsh: fatal load failure`）。故采用
 * 逐级降级：rename → copyFileSync（原地覆盖内容，保留文件条目与既有 watcher，
 * 规避句柄占用）→ 直写目标文件。
 *
 * **本函数保证不抛异常**：配置落盘失败只影响审计记录，不应阻断会话或插件加载。
 *
 * @returns 是否成功写入（至少一种路径成功）
 */
export function flush(file: string, cfg: AutoEnableConfig): boolean {
  let data: string
  try {
    data = JSON.stringify(cfg, null, 2)
  } catch {
    // 序列化失败（如循环引用）：无内容可写
    return false
  }

  const tmp = `${file}.tmp`
  const cleanupTmp = (): void => {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 忽略清理失败 */
    }
  }

  // 0) 写临时文件；若连临时文件都写不了，直接尝试写目标文件
  try {
    writeFileSync(tmp, data, 'utf-8')
  } catch {
    try {
      writeFileSync(file, data, 'utf-8')
      return true
    } catch {
      return false
    }
  }

  // 1) 原子替换（POSIX 首选）
  try {
    renameSync(tmp, file)
    return true
  } catch {
    // Windows EPERM：目标被占用，继续降级
  }

  // 2) 原地拷贝内容：不替换文件条目，规避句柄/观察器占用导致的 EPERM
  try {
    copyFileSync(tmp, file)
    cleanupTmp()
    return true
  } catch {
    // 继续降级
  }

  // 3) 最后手段：直写目标文件
  try {
    writeFileSync(file, data, 'utf-8')
    cleanupTmp()
    return true
  } catch {
    cleanupTmp()
    return false
  }
}
