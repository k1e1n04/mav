import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = () => void

class MockWidget extends EventEmitter {
  handlers = new Map<string, Handler>()
  selected = 0
  items: string[] = []
  value = ''
  hidden = false
  content = ''

  key(keys: string | string[], handler: Handler): void {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.handlers.set(key, handler)
    }
  }

  focus(): void {}
  destroy(): void {}
  write(data: string): void {
    this.content += data
  }
  setLabel(_label: string): void {}
  show(): void {
    this.hidden = false
  }
  hide(): void {
    this.hidden = true
  }
  select(index: number): void {
    this.selected = index
  }
  setItems(items: string[]): void {
    this.items = items
  }
  setContent(content: string): void {
    this.content = content
  }
  setScrollPerc(): void {}
  getValue(): string {
    return this.value
  }
  clearValue(): void {
    this.value = ''
  }
  cancel(): void {
    this.emit('cancel')
  }
}

const widgets = vi.hoisted(() => {
  return {
    createdLists: [] as MockWidget[],
    createdBoxes: [] as MockWidget[],
    createdTextboxes: [] as MockWidget[],
    createdTerminals: [] as MockWidget[],
  }
})

vi.mock('neo-blessed', () => ({
  default: {
    list: vi.fn(() => {
      const widget = new MockWidget()
      widgets.createdLists.push(widget)
      return widget
    }),
    box: vi.fn(() => {
      const widget = new MockWidget()
      widgets.createdBoxes.push(widget)
      return widget
    }),
    textbox: vi.fn(() => {
      const widget = new MockWidget()
      widgets.createdTextboxes.push(widget)
      return widget
    }),
    terminal: vi.fn(() => {
      const widget = new MockWidget()
      widgets.createdTerminals.push(widget)
      return widget
    }),
  },
}))

import { OverviewUI } from '../src/ui/overview.js'

describe('OverviewUI', () => {
  beforeEach(() => {
    widgets.createdLists.length = 0
    widgets.createdBoxes.length = 0
    widgets.createdTextboxes.length = 0
    widgets.createdTerminals.length = 0
  })

  it('n で追加したセッションを選択状態にする', () => {
    const initialSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('n')?.()
    const prompt = widgets.createdLists[1]
    expect(prompt).toBeDefined()

    prompt!.selected = 1
    prompt!.handlers.get('enter')?.()

    expect(manager.selectedIndex).toBe(1)
    expect(manager.selectedSession).toBe(addedSession)
    expect(listBox.selected).toBe(1)
  })

  it('一覧カーソルが selectedSession とずれていても n で追加した新規セッションを選択する', () => {
    const firstSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const secondSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'gemini-cli#1', status: 'running', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 0,
      selectedSession: firstSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.selected = 1
    listBox.handlers.get('n')?.()
    const prompt = widgets.createdLists[1]
    expect(prompt).toBeDefined()

    prompt!.selected = 2
    prompt!.handlers.get('enter')?.()

    expect(manager.selectedIndex).toBe(2)
    expect(manager.selectedSession).toBe(addedSession)
    expect(listBox.selected).toBe(2)
  })

  it('n でモデル選択後に新規セッションへの遷移コールバックを呼ぶ', () => {
    const initialSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const onSessionCreated = vi.fn()
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never, onSessionCreated)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('n')?.()
    const prompt = widgets.createdLists[1]!

    prompt.selected = 1
    prompt.handlers.get('enter')?.()

    expect(onSessionCreated).toHaveBeenCalledWith(addedSession)
  })

  it('copilot選択時は copilot コマンドでセッションを起動する', () => {
    const initialSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const addedSession = { id: 'copilot#1', status: 'running', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [initialSession],
      selectedIndex: 0,
      selectedSession: initialSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(() => {
        manager.sessions.push(addedSession)
        return addedSession
      }),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('n')?.()
    const prompt = widgets.createdLists[1]!

    prompt.selected = 3
    prompt.handlers.get('enter')?.()

    expect(manager.addSession).toHaveBeenCalledWith({
      type: 'copilot',
      cmd: 'copilot',
      args: [],
    })
  })

  it('右ペインには選択中セッションの詳細だけを表示する', () => {
    const firstSession = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: ['first line\r\n'],
      write: vi.fn(),
    }
    const secondSession = {
      id: 'codex#1',
      status: 'done',
      logBuffer: ['second line\r\n'],
      write: vi.fn(),
    }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 0,
      selectedSession: firstSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    const detailTerminal = widgets.createdTerminals.at(-1)!
    expect(detailTerminal.content).toContain('first line')
    expect(detailTerminal.content).not.toContain('second line')

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('down')?.()

    const switchedTerminal = widgets.createdTerminals.at(-1)!
    expect(switchedTerminal.content).toContain('second line')
    expect(switchedTerminal.content).not.toContain('first line')
  })

  it('overview表示時に選択中セッションを右ペイン寸法へresizeする', () => {
    const session = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: ['first line\r\n'],
      write: vi.fn(),
      resize: vi.fn(),
    }
    const screen = { render: vi.fn(), width: 120, height: 40 }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    expect(session.resize).toHaveBeenCalledWith(88, 35)
  })

  it('overviewで選択セッションを切り替えた時に右ペイン寸法へresizeする', () => {
    const firstSession = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: ['first line\r\n'],
      write: vi.fn(),
      resize: vi.fn(),
    }
    const secondSession = {
      id: 'codex#1',
      status: 'running',
      logBuffer: ['second line\r\n'],
      write: vi.fn(),
      resize: vi.fn(),
    }
    const screen = { render: vi.fn(), width: 120, height: 40 }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 0,
      selectedSession: firstSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('down')?.()

    expect(secondSession.resize).toHaveBeenCalledWith(88, 35)
  })

  it('右ペインにはANSIを剥がさず生のPTY出力を流す', () => {
    const session = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: ['\u001b[2mfoo\u001b[0m bar\r\n'],
      write: vi.fn(),
    }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    const detailTerminal = widgets.createdTerminals.at(-1)!
    expect(detailTerminal.content).toContain('\u001b[2mfoo\u001b[0m bar\r\n')
  })

  it('overviewの右ペインでは全画面UI向け制御シーケンスを履歴から除去する', () => {
    const session = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: [
        '\x1b[?1049h',
        '\x1b[H\x1b[2J',
        '\x1b[2mfoo\x1b[0m',
        '\x1b[2K',
        '\x1b]0;title\x07',
        '\x1b[1;1Hbar\r\n',
      ],
      write: vi.fn(),
    }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    const detailTerminal = widgets.createdTerminals.at(-1)!
    expect(detailTerminal.content).toBe('\x1b[2mfoo\x1b[0mbar\r\n')
  })

  it('overviewの右ペインでは全画面UI向け制御シーケンスをライブ出力から除去する', () => {
    const session = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: [],
      write: vi.fn(),
    }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [session],
      selectedIndex: 0,
      selectedSession: session,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    const ui = new OverviewUI(screen as never, manager as never)
    ui.show()

    const detailTerminal = widgets.createdTerminals.at(-1)!
    manager.emit('data', session.id, '\x1b[H\x1b[2J\x1b[2mfoo\x1b[0m\x1b[1;1Hbar')

    expect(detailTerminal.content).toContain('\x1b[2mfoo\x1b[0mbar')
    expect(detailTerminal.content).not.toContain('\x1b[H')
    expect(detailTerminal.content).not.toContain('\x1b[2J')
    expect(detailTerminal.content).not.toContain('\x1b[1;1H')
  })
})
