import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadConfigMock, managerAddSessionMock, loadStateMock, restoreLogBuffersMock, appStartMock } = vi.hoisted(() => {
  return {
    loadConfigMock: vi.fn(),
    managerAddSessionMock: vi.fn(),
    loadStateMock: vi.fn(),
    restoreLogBuffersMock: vi.fn(),
    appStartMock: vi.fn(),
  }
})

vi.mock('../src/config.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../src/state.js', () => ({
  loadState: loadStateMock,
  saveState: vi.fn(),
}))

vi.mock('../src/session-manager.js', () => ({
  SessionManager: class {
    sessions: unknown[] = []
    addSession(...args: unknown[]) {
      const result = managerAddSessionMock(...args)
      this.sessions.push(result ?? {})
      return result
    }
    restoreLogBuffers(...args: unknown[]) {
      return restoreLogBuffersMock(...args)
    }
  },
}))

vi.mock('../src/ui/app.js', () => ({
  App: class {
    start() {
      return appStartMock()
    }
  },
}))

import { start } from '../src/index.js'

describe('start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadStateMock.mockReturnValue(null)
    managerAddSessionMock.mockReturnValue({ id: 'claude-code#1', logBuffer: [], status: 'idle' })
    // 各テストで登録されたシグナルハンドラを除去してリーク警告を防ぐ
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGHUP')
  })

  it('agentType 未指定で起動対象がない場合は undefined を含まないエラーを出す', () => {
    loadConfigMock.mockReturnValue({ agents: [] })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`exit:${code ?? ''}`)
      }) as never)

    expect(() => start()).toThrow('exit:1')
    expect(errorSpy).toHaveBeenCalledWith('No agents found in config')
    expect(managerAddSessionMock).not.toHaveBeenCalled()
    expect(appStartMock).not.toHaveBeenCalled()

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  describe('claude-code セッション管理', () => {
    it('初回起動（state なし）は --session-id <uuid> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
      })
      loadStateMock.mockReturnValue(null)

      start()

      const calledWith = managerAddSessionMock.mock.calls[0]?.[0] as { args: string[] }
      expect(calledWith.args[0]).toBe('--session-id')
      expect(calledWith.args[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    })

    it('初回起動後、生成したUUIDをセッションに設定する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
      })
      const mockSession = { id: 'claude-code#1', logBuffer: [], status: 'idle' as const, sessionId: undefined as string | undefined }
      managerAddSessionMock.mockReturnValue(mockSession)
      loadStateMock.mockReturnValue(null)

      start()

      expect(mockSession.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    })

    it('再起動時に savedClaudeSessionId があれば --resume <id> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'claude-code#1': { logBuffer: [], status: 'idle', sessionId: 'prev-uuid-123' } },
      })

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--resume', 'prev-uuid-123'] })
      )
    })

    it('stateはあるがsessionIdがない場合も --session-id <uuid> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'claude-code#1': { logBuffer: [], status: 'idle' } },
      })

      start()

      const calledWith = managerAddSessionMock.mock.calls[0]?.[0] as { args: string[] }
      expect(calledWith.args[0]).toBe('--session-id')
    })

    it('config.args を保持したまま --resume フラグを追加する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'claude-code', cmd: 'claude', args: ['--some-flag'] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'claude-code#1': { logBuffer: [], status: 'idle', sessionId: 'prev-uuid' } },
      })

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--some-flag', '--resume', 'prev-uuid'] })
      )
    })
  })

  describe('gemini-cli セッション管理', () => {
    beforeEach(() => {
      managerAddSessionMock.mockReturnValue({ id: 'gemini-cli#1', logBuffer: [], status: 'idle' })
    })

    it('初回起動は --session-id <uuid> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'gemini-cli', cmd: 'gemini', args: [] }],
      })
      loadStateMock.mockReturnValue(null)

      start()

      const calledWith = managerAddSessionMock.mock.calls[0]?.[0] as { args: string[] }
      expect(calledWith.args[0]).toBe('--session-id')
      expect(calledWith.args[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    })

    it('再起動時に savedSessionId があれば --resume <id> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'gemini-cli', cmd: 'gemini', args: [] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'gemini-cli#1': { logBuffer: [], status: 'idle', sessionId: 'gemini-prev-uuid' } },
      })

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--resume', 'gemini-prev-uuid'] })
      )
    })
  })

  describe('copilot セッション管理', () => {
    beforeEach(() => {
      managerAddSessionMock.mockReturnValue({ id: 'copilot#1', logBuffer: [], status: 'idle' })
    })

    it('初回起動は --session-id <uuid> で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'copilot', cmd: 'copilot', args: [] }],
      })
      loadStateMock.mockReturnValue(null)

      start()

      const calledWith = managerAddSessionMock.mock.calls[0]?.[0] as { args: string[] }
      expect(calledWith.args[0]).toBe('--session-id')
      expect(calledWith.args[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    })

    it('再起動時は --session-id <same-uuid> で起動する（copilotは同IDで自動resume）', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'copilot', cmd: 'copilot', args: [] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'copilot#1': { logBuffer: [], status: 'idle', sessionId: 'copilot-prev-uuid' } },
      })

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--session-id', 'copilot-prev-uuid'] })
      )
    })
  })

  describe('codex セッション管理', () => {
    beforeEach(() => {
      managerAddSessionMock.mockReturnValue({ id: 'codex#1', logBuffer: [], status: 'idle' })
    })

    it('初回起動は通常のargsで起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'codex', cmd: 'codex', args: [] }],
      })
      loadStateMock.mockReturnValue(null)

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: [] })
      )
    })

    it('stateがある場合は resume --last で起動する', () => {
      loadConfigMock.mockReturnValue({
        agents: [{ type: 'codex', cmd: 'codex', args: [] }],
      })
      loadStateMock.mockReturnValue({
        sessions: { 'codex#1': { logBuffer: [], status: 'idle' } },
      })

      start()

      expect(managerAddSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['resume', '--last'] })
      )
    })
  })

  it('保存済みstateがある場合、restoreLogBuffersを呼ぶ', () => {
    loadConfigMock.mockReturnValue({
      agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
    })
    const state = { sessions: { 'claude-code#1': { logBuffer: ['a'], status: 'idle', sessionId: 'uuid' } } }
    loadStateMock.mockReturnValue(state)

    start()

    expect(restoreLogBuffersMock).toHaveBeenCalledWith(state)
  })
})
