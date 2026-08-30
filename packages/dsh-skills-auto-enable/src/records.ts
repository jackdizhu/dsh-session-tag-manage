/**
 * SKILL 增量记录（宿主端插件 dsh-skills-auto-enable）
 *
 * 维护两类数据：
 * - skills：当前会话上下文中存在的全部 SKILL 完整清单（name/keyword/overview）
 * - skillsLog：增量变更审计流水（op: add/remove）
 * - usage：执行过程中实际被调用的 SKILL（count / lastUsedAt）
 *
 * 落盘采用"先写临时文件再 fs.rename 原子替换"，避免多会话并发写损坏文件。
 *
 * @module dsh-skills-auto-enable/records
 */

import { writeFileSync, renameSync } from 'node:fs'
import type { AutoEnableConfig, SkillRecord, UsageRecord } from './config.js'

/**
 * 增量维护 skills 清单并追加 skillsLog 流水。
 * - op='add'：清单中无同名则追加
 * - op='remove'：清单中有同名则移除
 * 每次调用都追加一条 skillsLog（审计差异）。
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
}

/** 观测到技能被调用 → usage 累加（count+1，lastUsedAt 更新） */
export function recordUsage(cfg: AutoEnableConfig, name: string): void {
  const now = new Date().toISOString()
  const prev: UsageRecord = cfg.usage[name] ?? { count: 0, lastUsedAt: now }
  cfg.usage[name] = { count: prev.count + 1, lastUsedAt: now }
}

/**
 * 原子落盘：先写 `<file>.tmp` 再 rename 替换，落盘期间不出现半写文件。
 */
export function flush(file: string, cfg: AutoEnableConfig): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
  renameSync(tmp, file)
}
