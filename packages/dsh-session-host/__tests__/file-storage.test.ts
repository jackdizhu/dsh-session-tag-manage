/**
 * file-storage 独立单元测试
 *
 * 覆盖：
 * - readWorkspaceTags：正常读取、文件不存在、JSON 解析失败
 * - writeWorkspaceTags：正常写入、自动创建目录
 * - deleteWorkspaceFile：删除、文件不存在
 * - listWorkspaceIds：列出工作区
 * - workspaceFileExists：存在性检查
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, unlink, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 使用临时目录避免污染真实 ~/.dsh/storages/
const TEST_DIR = join(tmpdir(), `dsh-test-${Date.now()}`)

// Mock homedir() 返回临时目录
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => TEST_DIR,
  }
})

// 在每个测试前清空临时目录，测试后清理
beforeEach(async () => {
  try { await mkdir(TEST_DIR, { recursive: true }) } catch {}
})

afterEach(async () => {
  try {
    const { rm } = await import('node:fs/promises')
    await rm(TEST_DIR, { recursive: true, force: true })
  } catch {}
})

// 扁平化存储路径工具
const STORAGE_PREFIX = 'dsh_session_tag__'
const storageDir = join(TEST_DIR, '.dsh', 'storages')
const flatFile = (wsId: string) => join(storageDir, `${STORAGE_PREFIX}${wsId}.json`)

describe('file-storage 工具', () => {
  // ===== readWorkspaceTags =====

  describe('readWorkspaceTags', () => {
    it('文件不存在时应返回空数组', async () => {
      const { readWorkspaceTags } = await import('../src/utils/file-storage.js')
      const result = await readWorkspaceTags('nonexistent-ws')
      expect(result).toEqual([])
    })

    it('正常读取 JSON 数组', async () => {
      await mkdir(storageDir, { recursive: true })

      const data = [
        { sessionId: 's1', title: '会话1', sessionCurrentTag: '进行中', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z' },
      ]
      await writeFile(flatFile('ws-123'), JSON.stringify(data), 'utf-8')

      const { readWorkspaceTags } = await import('../src/utils/file-storage.js')
      const result = await readWorkspaceTags('ws-123')
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('s1')
    })

    it('兼容 { sessions: [...] } 包装格式', async () => {
      await mkdir(storageDir, { recursive: true })

      const data = {
        sessions: [
          { sessionId: 's2', title: '会话2', sessionCurrentTag: '已完成', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z' },
        ],
      }
      await writeFile(flatFile('ws-456'), JSON.stringify(data), 'utf-8')

      const { readWorkspaceTags } = await import('../src/utils/file-storage.js')
      const result = await readWorkspaceTags('ws-456')
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('s2')
    })

    it('JSON 解析失败时应返回空数组', async () => {
      await mkdir(storageDir, { recursive: true })
      await writeFile(flatFile('ws-bad'), '{invalid json', 'utf-8')

      const { readWorkspaceTags } = await import('../src/utils/file-storage.js')
      const result = await readWorkspaceTags('ws-bad')
      expect(result).toEqual([])
    })
  })

  // ===== writeWorkspaceTags =====

  describe('writeWorkspaceTags', () => {
    it('应正常写入 JSON 文件', async () => {
      const { writeWorkspaceTags } = await import('../src/utils/file-storage.js')
      const sessions = [
        { sessionId: 's1', title: '会话1', sessionCurrentTag: '进行中', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z' },
      ]

      await writeWorkspaceTags('ws-write-1', sessions)

      const filePath = flatFile('ws-write-1')
      expect(existsSync(filePath)).toBe(true)

      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].sessionId).toBe('s1')
    })

    it('应自动创建目录', async () => {
      const { writeWorkspaceTags } = await import('../src/utils/file-storage.js')
      expect(existsSync(storageDir)).toBe(false)

      await writeWorkspaceTags('ws-new-dir', [])

      expect(existsSync(storageDir)).toBe(true)
    })
  })

  // ===== deleteWorkspaceFile =====

  describe('deleteWorkspaceFile', () => {
    it('文件存在时应删除成功', async () => {
      await mkdir(storageDir, { recursive: true })
      await writeFile(flatFile('ws-del'), '[]', 'utf-8')

      const { deleteWorkspaceFile } = await import('../src/utils/file-storage.js')
      const result = await deleteWorkspaceFile('ws-del')
      expect(result).toBe(true)
      expect(existsSync(flatFile('ws-del'))).toBe(false)
    })

    it('文件不存在时应返回 false', async () => {
      const { deleteWorkspaceFile } = await import('../src/utils/file-storage.js')
      const result = await deleteWorkspaceFile('ws-nonexistent')
      expect(result).toBe(false)
    })
  })

  // ===== listWorkspaceIds =====

  describe('listWorkspaceIds', () => {
    it('应列出所有工作区 ID', async () => {
      await mkdir(storageDir, { recursive: true })
      await writeFile(flatFile('ws-a'), '[]', 'utf-8')
      await writeFile(flatFile('ws-b'), '[]', 'utf-8')
      await writeFile(flatFile('ws-c'), '[]', 'utf-8')

      const { listWorkspaceIds } = await import('../src/utils/file-storage.js')
      const ids = await listWorkspaceIds()
      expect(ids).toContain('ws-a')
      expect(ids).toContain('ws-b')
      expect(ids).toContain('ws-c')
      expect(ids).toHaveLength(3)
    })

    it('目录不存在时应返回空数组', async () => {
      const { listWorkspaceIds } = await import('../src/utils/file-storage.js')
      // 确保目录不存在
      try {
        const { rm } = await import('node:fs/promises')
        await rm(storageDir, { recursive: true, force: true })
      } catch {}

      const ids = await listWorkspaceIds()
      expect(ids).toEqual([])
    })
  })

  // ===== workspaceFileExists =====

  describe('workspaceFileExists', () => {
    it('文件存在时应返回 true', async () => {
      await mkdir(storageDir, { recursive: true })
      await writeFile(flatFile('ws-exist'), '[]', 'utf-8')

      const { workspaceFileExists } = await import('../src/utils/file-storage.js')
      expect(workspaceFileExists('ws-exist')).toBe(true)
    })

    it('文件不存在时应返回 false', async () => {
      const { workspaceFileExists } = await import('../src/utils/file-storage.js')
      expect(workspaceFileExists('ws-no-exist')).toBe(false)
    })
  })
})
