/**
 * workspace.session.tag 路由单元测试
 *
 * 覆盖：
 * - 路由注册和基础校验
 * - 正常查询：调用 session.history → foldStats → 返回整理数据
 * - 缺少 sessionId 时返回 400
 * - 非 POST 方法返回 405
 * - session.history 调用失败时返回 500
 * - 自定义 maxMessages 参数透传
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

// ===== Mock utils 模块 =====
const mockFetchAllSessionEvents = vi.fn()
const mockFoldStats = vi.fn()
const mockExtractUserMessages = vi.fn()
const mockExtractAssistantMessages = vi.fn()
const mockExtractAssistantThinking = vi.fn()
const mockExtractFileOperations = vi.fn()
const mockExtractSessionTitle = vi.fn()
const mockSplitTurns = vi.fn()
const mockClassifyRoundEndReason = vi.fn()

vi.mock('../src/utils/file-storage.js', () => ({
  readWorkspaceTags: vi.fn(async () => []),
  writeWorkspaceTags: vi.fn(async () => {}),
  deleteWorkspaceFile: vi.fn(async () => true),
  listWorkspaceIds: vi.fn(async () => []),
  workspaceFileExists: vi.fn(() => false),
}))

vi.mock('../src/utils/storage-domain.js', () => ({
  StorageDomainManager: vi.fn(),
}))

vi.mock('../src/utils/rpc-client.js', () => ({
  dshRpcCall: vi.fn(),
  fetchWorkspaceList: vi.fn(),
}))

vi.mock('../src/utils/session-history.js', () => ({
  EventType: { USER_MESSAGE: 'user/message', ASSISTANT_MESSAGE: 'assistant/message', TOOL_CALL: 'tool/call', TURN_START: 'turn/start', SESSION_TITLE: 'session/title' },
  fetchAllSessionEvents: (...args: any[]) => mockFetchAllSessionEvents(...args),
  foldStats: (...args: any[]) => mockFoldStats(...args),
  extractUserMessages: (...args: any[]) => mockExtractUserMessages(...args),
  extractAssistantMessages: (...args: any[]) => mockExtractAssistantMessages(...args),
  extractAssistantThinking: (...args: any[]) => mockExtractAssistantThinking(...args),
  extractFileOperations: (...args: any[]) => mockExtractFileOperations(...args),
  extractSessionTitle: (...args: any[]) => mockExtractSessionTitle(...args),
  splitTurns: (...args: any[]) => mockSplitTurns(...args),
  classifyRoundEndReason: (...args: any[]) => mockClassifyRoundEndReason(...args),
  fetchSessionHistory: vi.fn(),
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

// ===== 默认 mock 返回值 =====
const defaultEvents = [
  { event: { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } } },
  { event: { type: 'user/message', seq: 1, time: 1001, data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user' }, role: 'user', id: 'm1' } } },
  { event: { type: 'assistant/message', seq: 2, time: 1002, data: { content: [{ type: 'text', text: '你好！' }], role: 'assistant', id: 'm2' } } },
  { event: { type: 'tool/call', seq: 3, time: 1003, data: { name: 'read_files', input: {}, callId: 'c1' } } },
  { event: { type: 'session/title', seq: 4, time: 1004, data: { title: '你好', source: { kind: 'fallback' } } } },
]

const defaultStats = {
  turns: 1,
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: [{ name: 'read_files', count: 1 }],
  startedAt: 1000,
  updatedAt: 1004,
  totalEvents: 5,
  title: '你好',
}

describe('workspace.session.tag 路由', () => {
  let apply: typeof import('../src/index.ts').apply

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetchAllSessionEvents.mockResolvedValue({ events: defaultEvents, hasMore: false })
    mockSplitTurns.mockReturnValue([defaultEvents])
    mockClassifyRoundEndReason.mockReturnValue('completed')
    mockFoldStats.mockReturnValue(defaultStats)
    mockExtractUserMessages.mockReturnValue(['你好'])
    mockExtractAssistantMessages.mockReturnValue(['你好，已为你创建文件'])
    mockExtractAssistantThinking.mockReturnValue(['用户在打招呼', '调用工具 read_files（{}）'])
    mockExtractFileOperations.mockReturnValue([])
    mockExtractSessionTitle.mockReturnValue('你好')

    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  // ===== 基础测试 =====

  it('apply 应注册 4 个路由（含新增的 workspace.session.tag）', () => {
    apply(mockCtx)
    expect(mockRegister).toHaveBeenCalledTimes(4)
  })

  it('第四个路由应为 workspace.session.tag', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    expect(route).toMatchObject({
      kind: 'exact',
      path: '/dsh-session-tag-manage/workspace.session.tag',
    })
    expect(typeof route.handler).toBe('function')
  })

  // ===== 参数校验 =====

  it('应拒绝非 POST 方法', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('GET'), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(405, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'method-not-allowed' })
  })

  it('缺少 sessionId 时应返回 400', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', {}), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toEqual({ ok: false, error: 'session-id-required' })
  })

  // ===== 正常查询 =====

  it('应调用 fetchAllSessionEvents 并返回整理后的数据', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { sessionId: 'session-abc' }), mockRes)

    // 验证调用了 fetchAllSessionEvents
    expect(mockFetchAllSessionEvents).toHaveBeenCalledTimes(1)
    const [baseUrl, sessionId, options] = mockFetchAllSessionEvents.mock.calls[0]
    expect(sessionId).toBe('session-abc')
    expect(options.maxMessages).toBe(200) // 默认值

    // 验证调用了 foldStats 和提取函数
    expect(mockFoldStats).toHaveBeenCalledWith(defaultEvents)
    expect(mockExtractUserMessages).toHaveBeenCalledWith(defaultEvents)
    expect(mockExtractAssistantThinking).toHaveBeenCalledWith(defaultEvents)
    expect(mockExtractFileOperations).toHaveBeenCalledWith(defaultEvents)
    expect(mockExtractSessionTitle).toHaveBeenCalledWith(defaultEvents)

    // 验证响应
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(true)
    expect(body.value.hasMore).toBe(false)
    expect(body.value.items).toHaveLength(1)
    expect(mockExtractAssistantMessages).toHaveBeenCalledWith(defaultEvents)
    expect(body.value.items[0]).toMatchObject({
      sessionId: 'session-abc',
      title: '你好',
      round: 1,
      endReason: 'completed',
      turns: 1,
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: [{ name: 'read_files', count: 1 }],
      userMessageTexts: ['你好'],
      assistantMessageTexts: ['你好，已为你创建文件'],
      assistantThinkTexts: ['用户在打招呼', '调用工具 read_files（{}）'],
      fileOperations: [],
      startedAt: 1000,
      updatedAt: 1004,
      totalEvents: 5,
    })
  })

  it('自定义 maxMessages 应透传到 fetchAllSessionEvents', async () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { sessionId: 'session-xyz', maxMessages: 50 }), mockRes)

    const [, , options] = mockFetchAllSessionEvents.mock.calls[0]
    expect(options.maxMessages).toBe(50)
  })

  // ===== 错误处理 =====

  it('session.history 调用失败时应返回 500', async () => {
    mockFetchAllSessionEvents.mockResolvedValue({ events: [], hasMore: false, error: 'corrupt session log' })

    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { sessionId: 'session-bad' }), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(500, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(false)
    expect(body.error).toContain('history-fetch-failed')
  })

  it('工具函数抛异常时应返回 500', async () => {
    mockFoldStats.mockImplementation(() => { throw new Error('fold failed') })

    apply(mockCtx)
    const route = mockRegister.mock.calls[3][0]
    const mockRes = createMockRes()

    await route.handler(createMockReq('POST', { sessionId: 'session-err' }), mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(500, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body.ok).toBe(false)
    expect(body.error).toBe('session-tag-query-failed')
  })
})
