import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-pty', () => {
  const mockPty = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    pid: 1234,
  }
  return {
    spawn: vi.fn(() => mockPty),
    __mockPty: mockPty,
  }
})

import * as nodePty from 'node-pty'
import { AgentSession } from '../src/agent.js'

const getMockPty = () => (nodePty as unknown as { __mockPty: typeof nodePty & { onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> } }).__mockPty

describe('AgentSession', () => {
  let session: AgentSession
  let onDataCb: ((data: string) => void) | undefined
  let onExitCb: ((e: { exitCode: number }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getMockPty().onData.mockImplementation((cb: (data: string) => void) => { onDataCb = cb })
    getMockPty().onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => { onExitCb = cb })
    session = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
  })

  it('起動時にstatus=runningになる', () => {
    expect(session.status).toBe('running')
  })

  it('PTYにデータが届くとlogBufferに追記される', () => {
    onDataCb?.('Hello World\r\n')
    expect(session.logBuffer).toContain('Hello World\r\n')
  })

  it('logBufferは最大500エントリを保持する', () => {
    for (let i = 0; i < 600; i++) {
      onDataCb?.(`line ${i}\r\n`)
    }
    expect(session.logBuffer.length).toBeLessThanOrEqual(500)
  })

  it('PTY exitでstatus=doneになる', () => {
    onExitCb?.({ exitCode: 0 })
    expect(session.status).toBe('done')
  })

  it('PTY exit code非0でstatus=errorになる', () => {
    onExitCb?.({ exitCode: 1 })
    expect(session.status).toBe('error')
  })

  it('write()がPTYにデータを送る', () => {
    session.write('hello\n')
    expect(getMockPty().write).toHaveBeenCalledWith('hello\n')
  })

  it('kill()でPTYが終了される', () => {
    session.kill()
    expect(getMockPty().kill).toHaveBeenCalled()
  })

  it('resize()でPTYがリサイズされる', () => {
    session.resize(100, 30)
    expect(getMockPty().resize).toHaveBeenCalledWith(100, 30)
  })

  it('exit後のresize()はPTYをリサイズしない', () => {
    onExitCb?.({ exitCode: 1 })

    session.resize(100, 30)

    expect(getMockPty().resize).not.toHaveBeenCalled()
  })

  it('データ受信時にonDataイベントが発火される', () => {
    const handler = vi.fn()
    session.on('data', handler)
    onDataCb?.('chunk')
    expect(handler).toHaveBeenCalledWith('chunk')
  })

  it('一定時間出力が止まるとstatus=idleになる', () => {
    onDataCb?.('chunk')

    vi.advanceTimersByTime(1500)

    expect(session.status).toBe('idle')
  })

  it('idle後に再度出力が来るとstatus=runningへ戻る', () => {
    onDataCb?.('chunk')
    vi.advanceTimersByTime(1500)

    onDataCb?.('next chunk')

    expect(session.status).toBe('running')
  })

  it('status変化時にstatusイベントが発火される', () => {
    const handler = vi.fn()
    session.on('status', handler)

    onDataCb?.('chunk')
    vi.advanceTimersByTime(1500)

    expect(handler).toHaveBeenCalledWith('idle')
  })

  it('exit時にonExitイベントが発火される', () => {
    const handler = vi.fn()
    session.on('exit', handler)
    onExitCb?.({ exitCode: 0 })
    expect(handler).toHaveBeenCalledWith(0)
  })
})

describe('AgentSession — ID', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    getMockPty().onData.mockImplementation(vi.fn())
    getMockPty().onExit.mockImplementation(vi.fn())
  })

  it('idはtype#N形式', () => {
    const s = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    expect(s.id).toMatch(/^claude-code#\d+$/)
  })

  it('同typeで複数起動すると連番になる', () => {
    const s1 = new AgentSession({ type: 'codex', cmd: 'codex', args: [] }, 80, 24)
    const s2 = new AgentSession({ type: 'codex', cmd: 'codex', args: [] }, 80, 24)
    const n1 = parseInt(s1.id.split('#')[1]!)
    const n2 = parseInt(s2.id.split('#')[1]!)
    expect(n2).toBe(n1 + 1)
  })
})
