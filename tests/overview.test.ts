import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewUI } from '../src/ui/overview.js'

class FakeTerminal {
  rendered = ''
  cols = 80
  render = vi.fn((content: string) => {
    this.rendered = content
  })
}

function key(name: string, sequence = name) {
  return { name, sequence }
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('OverviewUI', () => {
  let terminal: FakeTerminal

  beforeEach(() => {
    terminal = new FakeTerminal()
  })

  it('n で追加したセッションを選択状態にする', () => {
    const initialSession = { id: 'claude-code#1', displayName: 'claude-code 1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'codex#1', displayName: 'codex 1', status: 'running', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('n', key('n'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('enter'))
    ui.handleKeypress('', key('enter'))

    expect(manager.selectedIndex).toBe(1)
    expect(manager.selectedSession).toBe(addedSession)
    expect(terminal.rendered).toContain('> ⣾ codex 1  working')
  })

  it('n でモデル選択後に新規セッションへの遷移コールバックを呼ぶ', () => {
    const initialSession = { id: 'claude-code#1', displayName: 'claude-code 1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'codex#1', displayName: 'codex 1', status: 'running', logBuffer: [], write: vi.fn() }
    const onSessionCreated = vi.fn()
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never, onSessionCreated)
    ui.show()
    ui.handleKeypress('n', key('n'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('enter'))
    ui.handleKeypress('', key('enter'))

    expect(onSessionCreated).toHaveBeenCalledWith(addedSession)
  })

  it('copilot選択時は copilot コマンドでセッションを起動する', () => {
    const initialSession = { id: 'claude-code#1', displayName: 'claude-code 1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'copilot#1', displayName: 'copilot 1', status: 'running', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('n', key('n'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('enter'))
    ui.handleKeypress('', key('enter'))

    expect(manager.addSession).toHaveBeenCalledWith({
      type: 'copilot',
      cmd: 'copilot',
      args: ['--session-id', expect.any(String)],
      cwd: process.cwd(),
    })
  })

  it('n で追加したセッションは process.cwd() を cwd として起動する', () => {
    const initialSession = { id: 'claude-code#1', displayName: 'claude-code 1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'codex#1', displayName: 'codex 1', status: 'running', logBuffer: [], write: vi.fn(), cwd: '/tmp/project-a' }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/project-a')

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('n', key('n'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('enter'))
    ui.handleKeypress('', key('enter'))

    expect(manager.addSession).toHaveBeenCalledWith({
      type: 'codex',
      cmd: 'codex',
      args: [],
      cwd: '/tmp/project-a',
    })
    cwdSpy.mockRestore()
  })

  it('n の cwd 入力は狭い幅でもパスを折り返して表示する', () => {
    terminal.cols = 24
    const manager = Object.assign(new EventEmitter(), {
      sessions: [],
      selectedIndex: -1,
      selectedSession: null,
      selectSession: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/projects/very/long/path')

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('n', key('n'))
    ui.handleKeypress('', key('down'))
    ui.handleKeypress('', key('enter'))

    const plainLines = stripAnsi(terminal.rendered).split('\n')

    expect(plainLines).toContain(' /tmp/projects/very')
    expect(plainLines).toContain(' /long/path')
    expect(Math.max(...plainLines.map((line) => line.length))).toBeLessThanOrEqual(24)

    cwdSpy.mockRestore()
  })

  it('一覧には各セッションの状態ラベルを同じ行で表示し、状態ごとに並べる', () => {
    const firstSession = { id: 'claude-code#2', type: 'codex', displayName: 'fix recording bug', status: 'done', logBuffer: ['thinking...\r\n'], write: vi.fn() }
    const secondSession = { id: 'codex#1', type: 'codex', displayName: 'codex 1', status: 'running', logBuffer: ['completed successfully\r\n'], write: vi.fn() }
    const thirdSession = { id: 'gemini-cli#1', type: 'gemini-cli', displayName: 'gemini-cli 1', status: 'idle', logBuffer: ['waiting\r\n'], write: vi.fn() }
    const fourthSession = { id: 'copilot#1', type: 'copilot', displayName: 'copilot 1', status: 'error', logBuffer: ['failed\r\n'], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession, thirdSession, fourthSession],
      selectedIndex: 0,
      selectedSession: firstSession,
      selectSession: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()

    expect(terminal.rendered).toContain('Working')
    expect(terminal.rendered).toContain('⣾ codex 1 (codex)  working')
    expect(terminal.rendered).toContain('Waiting')
    expect(terminal.rendered).toContain('○ gemini-cli 1 (gemini-cli)  waiting')
    expect(terminal.rendered).toContain('Complete')
    expect(terminal.rendered).toContain('> ✓ fix recording bug (codex)  complete')
    expect(terminal.rendered).toContain('Failed')
    expect(terminal.rendered).toContain('✗ copilot 1 (copilot)  failed')
  })

  it('一覧の状態ラベルはstatusイベントでwaitingへ更新する', () => {
    const session = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    session.status = 'idle'
    manager.emit('status', session.id, 'idle')

    expect(terminal.rendered).toContain('Waiting')
    expect(terminal.rendered).toContain('waiting')
  })

  it('狭い幅でも各行が端末幅を超えない', () => {
    terminal.cols = 40
    const session = {
      id: 'claude-code#1',
      type: 'claude-code',
      displayName: 'なんかいろんなタイミングでnのエージェント選…',
      status: 'running',
      cwd: '/Users/ishiiken/Develop/multi-agent-view',
      logBuffer: [],
      write: vi.fn(),
    }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()

    const widths = terminal.rendered
      .split('\n')
      .map((line) => stripAnsi(line).length)

    expect(Math.max(...widths)).toBeLessThanOrEqual(40)
  })

  it('狭い幅でも表示内容に左余白を残す', () => {
    terminal.cols = 40
    const session = {
      id: 'codex#1',
      type: 'codex',
      displayName: 'codex 1',
      status: 'idle',
      cwd: '/Users/ishiiken/Develop/multi-agent-view',
      logBuffer: [],
      write: vi.fn(),
    }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()

    const nonEmptyLines = terminal.rendered
      .split('\n')
      .filter((line) => stripAnsi(line).length > 0)

    expect(nonEmptyLines.every((line) => stripAnsi(line).startsWith(' '))).toBe(true)
  })

  it('下キーで見出しをまたいで次のセッションへ移動できる', () => {
    const firstSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const secondSession = { id: 'codex#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 0,
      selectedSession: firstSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('', key('down'))

    expect(manager.selectedSession).toBe(secondSession)
    expect(terminal.rendered).toContain('> ○ codex#1  waiting')
  })

  it('上キーで見出しをまたいで前のセッションへ移動できる', () => {
    const firstSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const secondSession = { id: 'codex#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 1,
      selectedSession: secondSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('', key('up'))

    expect(manager.selectedSession).toBe(firstSession)
    expect(terminal.rendered).toContain('> ⣾ claude-code#1  working')
  })

  it('表示順と内部順が違っても下キーで表示上の次へ移動する', () => {
    const completeSession = { id: 'claude-code#1', status: 'done', logBuffer: [], write: vi.fn() }
    const workingSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const waitingSession = { id: 'gemini-cli#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [completeSession, workingSession, waitingSession],
      selectedIndex: 1,
      selectedSession: workingSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('', key('down'))

    expect(manager.selectedSession).toBe(waitingSession)
    expect(terminal.rendered).toContain('> ○ gemini-cli#1  waiting')
  })

  it('表示順と内部順が違っても上キーで表示上の前へ移動する', () => {
    const completeSession = { id: 'claude-code#1', status: 'done', logBuffer: [], write: vi.fn() }
    const workingSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const waitingSession = { id: 'gemini-cli#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [completeSession, workingSession, waitingSession],
      selectedIndex: 0,
      selectedSession: completeSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
        this.emit('selection', this.selectedSession)
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(terminal as never, manager as never)
    ui.show()
    ui.handleKeypress('', key('up'))

    expect(manager.selectedSession).toBe(waitingSession)
    expect(terminal.rendered).toContain('> ○ gemini-cli#1  waiting')
  })
})
