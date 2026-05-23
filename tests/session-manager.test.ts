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
    write = vi.fn()
    kill = vi.fn()
    resize = vi.fn()

    constructor(config: { type: string; cmd: string; args: string[] }) {
      super()
      counter++
      this.type = config.type
      this.id = `${config.type}#${counter}`
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
})
