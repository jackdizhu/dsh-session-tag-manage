/**
 * 扁平化文件存储工具
 *
 * 存储结构：
 *   ~/.dsh/storages/dsh_session_tag__{workspaceId}.json
 *
 * 每个工作区对应一个独立 JSON 文件，内容为 SessionTagEntry[] 数组。
 * 文件直接平铺在 storages 目录下，无子目录嵌套。
 * 读写操作均通过 Node.js fs 模块完成。
 *
 * @module utils/file-storage
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 扁平化文件前缀 */
const FILE_PREFIX = 'dsh_session_tag__'

/** 基础路径：~/.dsh/storages/ */
function getBaseDir(): string {
  return join(homedir(), '.dsh', 'storages')
}

/** 工作区文件路径：~/.dsh/storages/dsh_session_tag__{workspaceId}.json */
function getWorkspaceFilePath(workspaceId: string): string {
  return join(getBaseDir(), `${FILE_PREFIX}${workspaceId}.json`)
}

/**
 * 读取指定工作区的会话标签数据
 *
 * @param workspaceId - 工作区 ID
 * @returns 会话标签条目数组，文件不存在时返回空数组
 */
export async function readWorkspaceTags(
  workspaceId: string,
): Promise<Array<{
  sessionId: string
  title: string
  sessionCurrentTag: string
  createdAt: string
  updatedAt: string
}>> {
  const filePath = getWorkspaceFilePath(workspaceId)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    // 兼容两种格式：直接数组 或 { sessions: [...] } 包装
    if (Array.isArray(parsed)) {
      return parsed
    }
    if (parsed && Array.isArray(parsed.sessions)) {
      return parsed.sessions
    }
    return []
  } catch (err) {
    console.error(`[FileStorage] 读取工作区 ${workspaceId} 失败:`, err)
    return []
  }
}

/**
 * 写入指定工作区的会话标签数据
 *
 * 自动创建目录（如不存在），写入 JSON 文件。
 *
 * @param workspaceId - 工作区 ID
 * @param entries - 会话标签条目数组
 */
export async function writeWorkspaceTags(
  workspaceId: string,
  entries: Array<{
    sessionId: string
    title: string
    sessionCurrentTag: string
    createdAt: string
    updatedAt: string
  }>,
): Promise<void> {
  const baseDir = getBaseDir()
  const filePath = getWorkspaceFilePath(workspaceId)

  // 确保目录存在
  if (!existsSync(baseDir)) {
    await mkdir(baseDir, { recursive: true })
  }

  const data = JSON.stringify(entries, null, 2)
  await writeFile(filePath, data, 'utf-8')
  console.log(`[FileStorage] 写入工作区 ${workspaceId}: ${entries.length} 条记录 → ${filePath}`)
}

/**
 * 删除指定工作区的存储文件
 *
 * 当工作区无会话时调用，清理空文件。
 *
 * @param workspaceId - 工作区 ID
 * @returns true 表示文件已删除，false 表示文件不存在或删除失败
 */
export async function deleteWorkspaceFile(
  workspaceId: string,
): Promise<boolean> {
  const filePath = getWorkspaceFilePath(workspaceId)

  if (!existsSync(filePath)) {
    return false
  }

  try {
    await unlink(filePath)
    console.log(`[FileStorage] 已删除工作区文件: ${filePath}`)
    return true
  } catch (err) {
    console.error(`[FileStorage] 删除工作区 ${workspaceId} 文件失败:`, err)
    return false
  }
}

/**
 * 列出所有已存储的工作区 ID
 *
 * @returns 工作区 ID 数组（从文件名提取）
 */
export async function listWorkspaceIds(): Promise<string[]> {
  const baseDir = getBaseDir()

  if (!existsSync(baseDir)) {
    return []
  }

  try {
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(baseDir)
    return files
      .filter(f => f.startsWith(FILE_PREFIX) && f.endsWith('.json'))
      .map(f => f.slice(FILE_PREFIX.length).replace(/\.json$/, ''))
  } catch (err) {
    console.error(`[FileStorage] 列出工作区失败:`, err)
    return []
  }
}

/**
 * 检查工作区文件是否存在
 *
 * @param workspaceId - 工作区 ID
 * @returns true 表示文件已存在
 */
export function workspaceFileExists(workspaceId: string): boolean {
  return existsSync(getWorkspaceFilePath(workspaceId))
}
