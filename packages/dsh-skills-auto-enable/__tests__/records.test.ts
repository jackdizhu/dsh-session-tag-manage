import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config.js'
import { upsertSkill, recordUsage, flush } from '../src/records.js'

describe('records', () => {
  it('upsertSkill 增量 add 且去重', () => {
    const c = defaultConfig()
    upsertSkill(c, { name: 'x', keyword: '', overview: 'o' }, 'add')
    expect(c.skills).toHaveLength(1)
    expect(c.skills[0]).toMatchObject({ name: 'x', keyword: '', overview: 'o' })
    expect(c.skillsLog.at(-1)!.op).toBe('add')
    // 重复 add 不重复写入清单
    upsertSkill(c, { name: 'x', keyword: '', overview: 'o' }, 'add')
    expect(c.skills).toHaveLength(1)
  })

  it('upsertSkill remove 移除并记流水', () => {
    const c = defaultConfig()
    upsertSkill(c, { name: 'x', keyword: '', overview: 'o' }, 'add')
    upsertSkill(c, { name: 'x', keyword: '', overview: 'o' }, 'remove')
    expect(c.skills).toHaveLength(0)
    expect(c.skillsLog.at(-1)!.op).toBe('remove')
  })

  it('recordUsage 累加 count 与 lastUsedAt', () => {
    const c = defaultConfig()
    recordUsage(c, 'x')
    recordUsage(c, 'x')
    expect(c.usage.x.count).toBe(2)
    expect(typeof c.usage.x.lastUsedAt).toBe('string')
  })

  it('flush 原子落盘且不残留 .tmp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-rec-'))
    const file = join(dir, 'cfg.json')
    const c = defaultConfig()
    upsertSkill(c, { name: 'a', keyword: 'feishu', overview: 'ov' }, 'add')
    flush(file, c)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    const back = JSON.parse(readFileSync(file, 'utf-8'))
    expect(back.version).toBe(1)
    expect(back.skills).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('flush 全部路径失败时返回 false 且不抛出（Windows EPERM 回归）', () => {
    // 目标为目录 → write(tmp) 成功但 rename/copy/write 全部失败（跨类型冲突）
    const dir = mkdtempSync(join(tmpdir(), 'skill-rec-'))
    const c = defaultConfig()
    let ok: boolean | undefined
    // 关键：不得抛异常，否则会击穿 dsh 启动（曾出现 fatal load failure）
    expect(() => {
      ok = flush(dir, c)
    }).not.toThrow()
    expect(ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('skillsLog 超过上限时裁剪最早条目', () => {
    const c = defaultConfig()
    for (let i = 0; i < 520; i++) {
      upsertSkill(c, { name: `s${i}`, keyword: '', overview: 'o' }, 'add')
    }
    // 清单本身不受影响，仅审计流水被裁剪
    expect(c.skills).toHaveLength(520)
    expect(c.skillsLog.length).toBeLessThanOrEqual(500)
    expect(c.skillsLog.at(-1)!.name).toBe('s519')
  })
})
