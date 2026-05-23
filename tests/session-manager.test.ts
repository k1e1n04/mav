import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const { MockAgentSession } = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events')
  let counter = 0

  class MockAgentSession extends EventEmitter {
    id: string
    type: string
    status = 'running'
    logBuffer: string[] = []
    lastPrompt = ''
    displayName: string
    baseArgs: string[] = []
    write = vi.fn()
    kill = vi.fn()
    resize = vi.fn()
    restoreDisplayName = vi.fn((name: string) => {
      this.displayName = name
      this.emit('name', name)
    })

    constructor(config: { type: string; cmd: string; args: string[] }) {
      super()
      counter++
      this.type = config.type
      this.id = `${config.type}#${counter}`
      this.displayName = `${config.type} ${counter}`
    }
  }
  return { MockAgentSession }
})

vi.mock('../src/agent.js', () => {
  return { AgentSession: MockAgentSession }
})

import { SessionManager } from '../src/session-manager.js'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
  })

  it('初期状態でsessions空、selectedIndex=-1', () => {
    expect(manager.sessions).toHaveLength(0)
    expect(manager.selectedIndex).toBe(-1)
  })

  it('addSession でセッションが追加される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.sessions).toHaveLength(1)
  })

  it('最初のaddSessionで selectedIndex=0 になる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.selectedIndex).toBe(0)
  })

  it('複数セッション追加でも selectedIndex は変わらない', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    expect(manager.selectedIndex).toBe(0)
  })

  it('selectSession でindexが変わる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    manager.selectSession(1)
    expect(manager.selectedIndex).toBe(1)
  })

  it('selectSession で selection イベントが発火される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/b' })

    const handler = vi.fn()
    manager.on('selection', handler)

    manager.selectSession(1)

    expect(handler).toHaveBeenCalledWith(manager.sessions[1])
  })

  it('最初の addSession で selection イベントが発火される', () => {
    const handler = vi.fn()
    manager.on('selection', handler)

    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })

    expect(handler).toHaveBeenCalledWith(manager.sessions[0])
  })

  it('範囲外のselectSessionは無視される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.selectSession(5)
    expect(manager.selectedIndex).toBe(0)
  })

  it('removeSession でセッションが削除される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const id = manager.sessions[0]!.id
    manager.removeSession(id)
    expect(manager.sessions).toHaveLength(0)
  })

  it('削除後 selectedIndex は有効範囲にクランプされる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    manager.selectSession(1)
    manager.removeSession(manager.sessions[1]!.id)
    expect(manager.selectedIndex).toBe(0)
  })

  it('選択中セッション削除で次の selection イベントが発火される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/b' })
    manager.selectSession(1)

    const handler = vi.fn()
    manager.on('selection', handler)

    manager.removeSession(manager.sessions[1]!.id)

    expect(handler).toHaveBeenCalledWith(manager.sessions[0])
  })

  it('選択中より前のセッション削除で同じセッションを指し続ける', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    manager.addSession({ type: 'gemini-cli', cmd: 'gemini', args: [] })
    manager.addSession({ type: 'copilot', cmd: 'gh', args: ['copilot', 'suggest'] })
    manager.selectSession(2)

    const selectedBefore = manager.selectedSession

    manager.removeSession(manager.sessions[0]!.id)

    expect(manager.selectedIndex).toBe(1)
    expect(manager.selectedSession).toBe(selectedBefore)
  })

  it('全削除後 selectedIndex は -1 になる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.removeSession(manager.sessions[0]!.id)
    expect(manager.selectedIndex).toBe(-1)
  })

  it('selectedSession は selectedIndex のセッションを返す', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.selectedSession).toBe(manager.sessions[0])
  })

  it('selectedSession は空の場合 null を返す', () => {
    expect(manager.selectedSession).toBeNull()
  })

  it('addSession でdataイベントが発火される', () => {
    const handler = vi.fn()
    manager.on('data', handler)
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const session = manager.sessions[0]!
    session.emit('data', 'hello')
    expect(handler).toHaveBeenCalledWith(session.id, 'hello')
  })

  it('status変化時にstatusイベントが発火される', () => {
    const handler = vi.fn()
    manager.on('status', handler)
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const session = manager.sessions[0]!
    session.emit('status', 'idle')
    expect(handler).toHaveBeenCalledWith(session.id, 'idle')
  })

  it('cwd変化時にcwdイベントが発火される', () => {
    const handler = vi.fn()
    manager.on('cwd', handler)
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const session = manager.sessions[0]!
    session.emit('cwd', '/tmp/worktrees/feature-a')
    expect(handler).toHaveBeenCalledWith(session.id, '/tmp/worktrees/feature-a')
  })

  describe('restoreLogBuffers', () => {
    it('保存済みlogBufferをセッションに適用する', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      const session = manager.sessions[0]!
      manager.restoreLogBuffers({
        sessions: { [session.id]: { logBuffer: ['restored\r\n'], status: 'idle' } },
      })
      expect(session.logBuffer).toEqual(['restored\r\n'])
    })

    it('stateに存在しないセッションはlogBufferが空のまま', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      const session = manager.sessions[0]!
      manager.restoreLogBuffers({ sessions: {} })
      expect(session.logBuffer).toEqual([])
    })

    it('sessionIdも復元する', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      const session = manager.sessions[0]!
      manager.restoreLogBuffers({
        sessions: { [session.id]: { logBuffer: [], status: 'idle', sessionId: 'saved-uuid' } },
      })
      expect((session as { sessionId?: string }).sessionId).toBe('saved-uuid')
    })

    it('複数セッションそれぞれのlogBufferを復元する', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
      const [s1, s2] = manager.sessions as [typeof manager.sessions[0], typeof manager.sessions[0]]
      manager.restoreLogBuffers({
        sessions: {
          [s1.id]: { logBuffer: ['a'], status: 'idle' },
          [s2.id]: { logBuffer: ['b', 'c'], status: 'done' },
        },
      })
      expect(s1.logBuffer).toEqual(['a'])
      expect(s2.logBuffer).toEqual(['b', 'c'])
    })

    it('displayNameが保存されている場合はrestoreDisplayNameを呼ぶ', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      const session = manager.sessions[0]!
      manager.restoreLogBuffers({
        sessions: {
          [session.id]: { logBuffer: [], status: 'idle', displayName: 'my saved name' },
        },
      })
      const mock = session as unknown as { restoreDisplayName: ReturnType<typeof vi.fn> }
      expect(mock.restoreDisplayName).toHaveBeenCalledWith('my saved name')
    })

    it('displayNameがない場合はrestoreDisplayNameを呼ばない', () => {
      manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
      const session = manager.sessions[0]!
      manager.restoreLogBuffers({
        sessions: { [session.id]: { logBuffer: [], status: 'idle' } },
      })
      const mock = session as unknown as { restoreDisplayName: ReturnType<typeof vi.fn> }
      expect(mock.restoreDisplayName).not.toHaveBeenCalled()
    })
  })
})
