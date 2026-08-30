/**
 * 宿主端插件测试用例
 *
 * 测试：
 * - /dsh-session-host-test 无参/有参
 * - /dsh-session-tag-manage/workspace.list.tag 查询
 * - /dsh-session-tag-manage/workspace.tag.set 写入
 * - 无会话时自动清理文件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

// ===== Mock file-storage 模块 =====
const mockReadWorkspaceTags = vi.fn(async () => [
  {
    sessionId: 'session-957f9e9c',
    title: '测试会话',
    sessionCurrentTag: '任务进行中',
    createdAt: '2026-08-16T07:51:06.460Z',
    updatedAt: '2026-08-29T01:51:07.535Z',
  },
])
const mockWriteWorkspaceTags = vi.fn(async () => {})
const mockDeleteWorkspaceFile = vi.fn(async () => true)

vi.mock('../src/utils/file-storage.js', () => ({
  readWorkspaceTags: (...args: any[]) => mockReadWorkspaceTags(...args),
  writeWorkspaceTags: (...args: any[]) => mockWriteWorkspaceTags(...args),
  deleteWorkspaceFile: (...args: any[]) => mockDeleteWorkspaceFile(...args),
  listWorkspaceIds: vi.fn(async () => []),
  workspaceFileExists: vi.fn(() => false),
}))

// ===== Mock ctx =====
const mockRegister = vi.fn()
const mockCtx = {
  webServer: { register: mockRegister },
} as unknown as Context

// ===== 辅助函数 =====
function createMockReq(method: string, body?: object) {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : []
  return {
    method,
    url: '/test',
    headers: {},
    [Symbol.asyncIterator]: function* () {
      for (const c of chunks) yield c
    },
  } as any
}

function createMockRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any
}

describe('dsh-session-tag-manage-host 插件', () => {
  let apply: typeof import('../src/index.ts').apply

  beforeEach(async () => {
    vi.clearAllMocks()
    mockReadWorkspaceTags.mockResolvedValue([
      {
        sessionId: 'session-957f9e9c',
        title: '测试会话',
        sessionCurrentTag: '任务进行中',
        createdAt: '2026-08-16T07:51:06.460Z',
        updatedAt: '2026-08-29T01:51:07.535Z',
      },
    ])
    mockWriteWorkspaceTags.mockResolvedValue(undefined)
    mockDeleteWorkspaceFile.mockResolvedValue(true)

    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  // ===== 基础测试 =====

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-tag-manage-host')
  })

  it('应导出 inject 数组包含 webServer', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('webServer')
  })

  it('apply 函数应注册三个路由', () => {
    apply(mockCtx)
    expect(mockRegister).toHaveBeenCalledTimes(3)
  })

  // ===== /dsh-session-host-test 路由测试 =====

  it('第一个路由应为 /dsh-session-host-test', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    expect(route).toMatchObject({
      kind: 'exact',
      path: '/dsh-session-host-test',
    })
    expect(typeof route.handler).toBe('function')
  })

  it('路由处理器应返回包含 serverTime 的 JSON', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    const mockRes = createMockRes()

    route.handler(createMockReq('GET'), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toHaveProperty('serverTime')
    expect(typeof body.serverTime).toBe('number')
    expect(body.serverTime).toBeGreaterThan(0)
  })

  it('路由处理器应解析 folderActive 和 sessionCurrent 参数', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    const mockRes = createMockRes()

    route.handler({
      method: 'GET',
      url: '/dsh-session-host-test?folderActive=ws-123&sessionCurrent=sess-456',
      headers: {},
    } as any, mockRes)

    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toHaveProperty('folderActive', 'ws-123')
    expect(body).toHaveProperty('sessionCurrent', 'sess-456')
  })

  it('无参数时应返回默认值', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    const mockRes = createMockRes()

    route.handler(createMockReq('GET'), mockRes)

    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toHaveProperty('folderActive', null)
    expect(body).toHaveProperty('sessionCurrent', null)
  })

  // ===== workspace.list.tag 路由测试 =====

  it('第二个路由应为 workspace.list.tag', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[1][0]
    expect(route).toMatchObject({
      kind: 'exact',
      path: '/dsh-session-tag-manage/workspace.list.tag',
    })
  })

  it('workspace.list.tag 应拒绝非 POST 方法', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[1][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('GET'), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(405, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'method-not-allowed' })
  })

  it('workspace.list.tag 应在缺少 workspaceId 时返回 400', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[1][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', {}), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'workspace-id-required' })
  })

  it('workspace.list.tag 应返回指定工作区的会话标签数据', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[1][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { workspaceId: 'ws-test-123' }), mockRes)

    expect(mockReadWorkspaceTags).toHaveBeenCalledWith('ws-test-123')
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.items).toHaveLength(1)
    expect(body.value.items[0]).toMatchObject({
      sessionId: 'session-957f9e9c',
      title: '测试会话',
      sessionCurrentTag: '任务进行中',
    })
  })

  it('workspace.list.tag 应在工作区不存在时返回空数组', async () => {
    mockReadWorkspaceTags.mockResolvedValue([])
    apply(mockCtx)
    const route = mockRegister.mock.calls[1][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { workspaceId: 'ws-not-exist' }), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.items).toEqual([])
  })

  // ===== workspace.tag.set 路由测试 =====

  it('第三个路由应为 workspace.tag.set', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    expect(route).toMatchObject({
      kind: 'exact',
      path: '/dsh-session-tag-manage/workspace.tag.set',
    })
  })

  it('workspace.tag.set 应拒绝非 POST 方法', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('GET'), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(405, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'method-not-allowed' })
  })

  it('workspace.tag.set 应在缺少 workspaceId 时返回 400', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { sessions: [] }), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'workspace-id-required' })
  })

  it('workspace.tag.set 应在缺少 sessions 时返回 400', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { workspaceId: 'ws-123' }), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'sessions-array-required' })
  })

  it('workspace.tag.set 应成功写入会话标签数据', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()
    const sessions = [
      {
        sessionId: 'session-abc',
        title: '新会话',
        sessionCurrentTag: '已完成',
        createdAt: '2026-08-29T00:00:00.000Z',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
    ]

    await route.handler(createMockReq('POST', { workspaceId: 'ws-123', sessions }), mockRes)

    expect(mockWriteWorkspaceTags).toHaveBeenCalledWith('ws-123', sessions)
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.count).toBe(1)
  })

  it('workspace.tag.set deleteWorkspace=true 且 sessions 为空时应删除文件', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { workspaceId: 'ws-123', sessions: [], deleteWorkspace: true }), mockRes)

    expect(mockDeleteWorkspaceFile).toHaveBeenCalledWith('ws-123')
    expect(mockWriteWorkspaceTags).not.toHaveBeenCalled()
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.count).toBe(0)
  })

  it('workspace.tag.set sessions 为空但未设置 deleteWorkspace 时应保留文件', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { workspaceId: 'ws-123', sessions: [] }), mockRes)

    expect(mockWriteWorkspaceTags).toHaveBeenCalledWith('ws-123', [])
    expect(mockDeleteWorkspaceFile).not.toHaveBeenCalled()
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.count).toBe(0)
  })

  it('workspace.tag.set 写入非空 sessions 时不应删除文件', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[2][0]
    const mockRes = createMockRes()
    const sessions = [
      {
        sessionId: 'session-abc',
        title: '会话',
        sessionCurrentTag: '进行中',
        createdAt: '2026-08-29T00:00:00.000Z',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
    ]

    await route.handler(createMockReq('POST', { workspaceId: 'ws-123', sessions }), mockRes)

    expect(mockWriteWorkspaceTags).toHaveBeenCalledWith('ws-123', sessions)
    expect(mockDeleteWorkspaceFile).not.toHaveBeenCalled()
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.count).toBe(1)
  })
})
