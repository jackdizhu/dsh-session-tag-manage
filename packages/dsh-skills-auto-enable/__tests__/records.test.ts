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
})
