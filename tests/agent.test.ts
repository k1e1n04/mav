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

const { getProcessCwdMock } = vi.hoisted(() => ({
  getProcessCwdMock: vi.fn(),
}))

vi.mock('../src/process-cwd.js', () => ({
  getProcessCwd: getProcessCwdMock,
}))

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
    getProcessCwdMock.mockReturnValue(null)
    getMockPty().onData.mockImplementation((cb: (data: string) => void) => { onDataCb = cb })
    getMockPty().onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => { onExitCb = cb })
    session = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
  })

  it('起動時にstatus=runningになる', () => {
    expect(session.status).toBe('running')
  })

  it('config.cwd を保持する', () => {
    const cwdSession = new AgentSession(
      { type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/project-a' },
      80,
      24,
    )

    expect(cwdSession.cwd).toBe('/tmp/project-a')
  })

  it('node-pty spawn に cwd を渡す', () => {
    new AgentSession(
      { type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/project-b' },
      80,
      24,
    )

    expect(nodePty.spawn).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ cwd: '/tmp/project-b' }),
    )
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

  it('初期表示名は agent type と連番になる', () => {
    expect(session.displayName).toMatch(/^claude-code \d+$/)
  })

  it('最初の入力行から表示名を自動設定する', () => {
    session.write('fix session naming in overview\n')

    expect(session.displayName).toBe('fix session naming in...')
  })

  it('最初の入力が短すぎる場合は仮名を維持する', () => {
    const originalName = session.displayName

    session.write('y\n')

    expect(session.displayName).toBe(originalName)
  })

  it('短すぎる最初の入力のあとでも次の有効な入力で表示名を更新できる', () => {
    const originalName = session.displayName

    session.write('y\n')
    session.write('valid prompt title\n')

    expect(session.displayName).not.toBe(originalName)
    expect(session.displayName).toBe('valid prompt title')
  })

  it('表示名は最初の確定後に再更新しない', () => {
    session.write('first meaningful prompt\n')
    const lockedName = session.displayName

    session.write('second prompt\n')

    expect(session.displayName).toBe(lockedName)
  })

  it('setDisplayName() で表示名を手動更新できる', () => {
    const handler = vi.fn()
    session.on('name', handler)

    session.setDisplayName('rename session later')

    expect(session.displayName).toBe('rename session later')
    expect(handler).toHaveBeenCalledWith('rename session later')
  })

  it('APCシーケンス（\\x1b_...\\x1b\\\\）に埋め込まれたCRLFで表示名が汚染されない', () => {
    const originalName = session.displayName

    // Warpターミナルがstdinに送るようなAPCシーケンス（改行を含む）
    session.write('\x1b_Warp;tab-name=My Warp Tab\r\n\x1b\\')

    expect(session.displayName).toBe(originalName)
  })

  it('APCシーケンスを受信後にユーザー入力で正しい表示名を設定する', () => {
    // Warpのシーケンスが先に来ても、その後のユーザー入力がタイトルになる
    session.write('\x1b_Warp;tab-name=My Warp Tab\r\n\x1b\\')
    session.write('こんにちは\r')

    expect(session.displayName).toBe('こんにちは')
  })

  it('DCSシーケンス（\\x1bP...\\x1b\\\\）に埋め込まれたCRLFで表示名が汚染されない', () => {
    const originalName = session.displayName

    session.write('\x1bPsome device control string\r\n\x1b\\')

    expect(session.displayName).toBe(originalName)
  })

  it('kill()でPTYが終了される', () => {
    session.kill()
    expect(getMockPty().kill).toHaveBeenCalled()
  })

  it('resize()でPTYがリサイズされる', () => {
    session.resize(100, 30)
    expect(getMockPty().resize).toHaveBeenCalledWith(100, 30)
  })

  it('spawn失敗後のwrite()は表示名更新もPTY書き込みもしない', async () => {
    vi.mocked(nodePty.spawn).mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })

    const failedSession = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    const originalName = failedSession.displayName

    failedSession.write('valid prompt title\n')
    await vi.runAllTicks()

    expect(failedSession.status).toBe('error')
    expect(failedSession.displayName).toBe(originalName)
    expect(getMockPty().write).not.toHaveBeenCalled()
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

  it('OSC 7 の current directory シーケンスを受信すると cwd を更新する', () => {
    const handler = vi.fn()
    session.on('cwd', handler)

    onDataCb?.('\x1b]7;file:///tmp/worktrees/feature-a\x07')

    expect(session.cwd).toBe('/tmp/worktrees/feature-a')
    expect(handler).toHaveBeenCalledWith('/tmp/worktrees/feature-a')
  })

  it('OSC 7 で percent-encoded path を受信すると decode して cwd を更新する', () => {
    onDataCb?.('\x1b]7;file:///tmp/worktrees/feature%20a\x07')

    expect(session.cwd).toBe('/tmp/worktrees/feature a')
  })

  it('OSC 7 が不正な URL の場合は cwd を更新しない', () => {
    const originalCwd = session.cwd
    const handler = vi.fn()
    session.on('cwd', handler)

    onDataCb?.('\x1b]7;not-a-file-url\x07')

    expect(session.cwd).toBe(originalCwd)
    expect(handler).not.toHaveBeenCalled()
  })

  it('child process の live cwd を poll して更新する', () => {
    const handler = vi.fn()
    session.on('cwd', handler)
    getProcessCwdMock.mockReturnValue('/tmp/worktrees/live-a')

    vi.advanceTimersByTime(1000)

    expect(session.cwd).toBe('/tmp/worktrees/live-a')
    expect(handler).toHaveBeenCalledWith('/tmp/worktrees/live-a')
  })

  it('poll した cwd が変わらなければ cwd イベントを発火しない', () => {
    const handler = vi.fn()
    session.on('cwd', handler)
    getProcessCwdMock.mockReturnValue(session.cwd)

    vi.advanceTimersByTime(1000)

    expect(handler).not.toHaveBeenCalled()
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

describe('AgentSession — restoreDisplayName', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getMockPty().onData.mockImplementation((cb: (data: string) => void) => { void cb })
    getMockPty().onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => { void cb })
  })

  it('displayNameを上書きしてnameイベントを発火する', () => {
    const s = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    const handler = vi.fn()
    s.on('name', handler)
    s.restoreDisplayName('my restored name')
    expect(s.displayName).toBe('my restored name')
    expect(handler).toHaveBeenCalledWith('my restored name')
  })

  it('restoreDisplayName後は新しい入力で上書きされない', () => {
    const s = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    s.restoreDisplayName('locked name')
    s.write('new input that would change name\n')
    expect(s.displayName).toBe('locked name')
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

describe('AgentSession — IPC env injection', () => {
  let onDataCb: ((data: string) => void) | undefined
  let onExitCb: ((e: { exitCode: number }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getProcessCwdMock.mockReturnValue(null)
    getMockPty().onData.mockImplementation((cb: (data: string) => void) => { onDataCb = cb })
    getMockPty().onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => { onExitCb = cb })
  })

  it('MAV_SOCKET と MAV_SESSION_ID を env に注入する', () => {
    const spawnMock = vi.mocked((nodePty as unknown as { spawn: ReturnType<typeof vi.fn> }).spawn)
    spawnMock.mockClear()

    new AgentSession(
      { type: 'claude-code', cmd: 'claude', args: [] },
      80, 24,
      { socketPath: '/tmp/mav-test.sock', hookFiles: [] },
    )

    const spawnCall = spawnMock.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string>
    expect(env.MAV_SOCKET).toBe('/tmp/mav-test.sock')
    expect(env.MAV_SESSION_ID).toMatch(/^claude-code#\d+$/)
  })

  it('IpcContext なしの場合は MAV_SOCKET を注入しない', () => {
    const spawnMock = vi.mocked((nodePty as unknown as { spawn: ReturnType<typeof vi.fn> }).spawn)
    spawnMock.mockClear()

    new AgentSession(
      { type: 'claude-code', cmd: 'claude', args: [] },
      80, 24,
    )

    const spawnCall = spawnMock.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string>
    expect(env.MAV_SOCKET).toBeUndefined()
  })

  it('notifyCwd() で cwd を更新して cwd イベントを発火する', () => {
    const s = new AgentSession(
      { type: 'claude-code', cmd: 'claude', args: [] },
      80, 24,
      { socketPath: '/tmp/mav-test.sock', hookFiles: [] },
    )
    const handler = vi.fn()
    s.on('cwd', handler)

    s.notifyCwd('/new/path')

    expect(s.cwd).toBe('/new/path')
    expect(handler).toHaveBeenCalledWith('/new/path')
  })
})
