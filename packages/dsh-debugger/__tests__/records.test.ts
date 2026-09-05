import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config.js'
import { flush } from '../src/records.js'

describe('records.flush（配置原子落盘）', () => {
  it('flush 原子落盘且不残留 .tmp，内容可回读', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbg-rec-'))
    const file = join(dir, 'cfg.json')
    const c = defaultConfig()
    c.debug.enabled = false
    flush(file, c)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    const back = JSON.parse(readFileSync(file, 'utf-8'))
    expect(back.version).toBe(1)
    expect(back.debug.enabled).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('flush 全部路径失败时返回 false 且不抛出（Windows EPERM 回归）', () => {
    // 目标为目录 → write(tmp) 成功但 rename/copy/write 全部失败（跨类型冲突）
    const dir = mkdtempSync(join(tmpdir(), 'dbg-rec-'))
    const c = defaultConfig()
    let ok: boolean | undefined
    // 关键：不得抛异常，否则会击穿 dsh 启动（曾出现 fatal load failure）
    expect(() => {
      ok = flush(dir, c)
    }).not.toThrow()
    expect(ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
