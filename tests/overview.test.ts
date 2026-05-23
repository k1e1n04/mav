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
  }
})

vi.mock('neo-blessed', () => ({
  default: {
    list: vi.fn(() => {
      const widget = new MockWidget()
      widgets.createdLists.push(widget)
      return widget
    }),
  },
}))

import { OverviewUI } from '../src/ui/overview.js'

describe('OverviewUI', () => {
  beforeEach(() => {
    widgets.createdLists.length = 0
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
    expect(listBox.selected).toBe(2)
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
    expect(listBox.selected).toBe(3)
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

  it('一覧には各セッションの状態ラベルを同じ行で表示し、状態ごとに並べる', () => {
    const firstSession = {
      id: 'claude-code#2',
      status: 'done',
      logBuffer: ['thinking...\r\n'],
      write: vi.fn(),
    }
    const secondSession = {
      id: 'codex#1',
      status: 'running',
      logBuffer: ['completed successfully\r\n'],
      write: vi.fn(),
    }
    const thirdSession = {
      id: 'gemini-cli#1',
      status: 'idle',
      logBuffer: ['waiting\r\n'],
      write: vi.fn(),
    }
    const fourthSession = {
      id: 'copilot#1',
      status: 'error',
      logBuffer: ['failed\r\n'],
      write: vi.fn(),
    }
    const screen = { render: vi.fn(), width: 80 }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession, thirdSession, fourthSession],
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
    expect(listBox.items).toHaveLength(8)
    expect(listBox.items[0]).toContain('Working')
    expect(listBox.items[1]).toContain('codex#1')
    expect(listBox.items[1]).toContain('working')
    expect(listBox.items[2]).toContain('Waiting')
    expect(listBox.items[3]).toContain('gemini-cli#1')
    expect(listBox.items[3]).toContain('waiting')
    expect(listBox.items[4]).toContain('Complete')
    expect(listBox.items[5]).toContain('claude-code#2')
    expect(listBox.items[5]).toContain('complete')
    expect(listBox.items[6]).toContain('Failed')
    expect(listBox.items[7]).toContain('failed')
    expect(listBox.selected).toBe(5)
  })

  it('一覧の状態ラベルはログ内容に引きずられない', () => {
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

    const listBox = widgets.createdLists[0]!
    expect(listBox.items[1]).toContain('working')
    expect(listBox.items[1]).not.toContain('foo bar')
  })

  it('一覧の状態ラベルは全画面UI向け制御シーケンスの影響を受けない', () => {
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

    const listBox = widgets.createdLists[0]!
    expect(listBox.items[1]).toContain('working')
    expect(listBox.items[1]).not.toContain('foobar')
  })

  it('一覧の状態ラベルはライブ出力ではなく状態変化で更新する', () => {
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

    session.logBuffer.push('\x1b[H\x1b[2J\x1b[2mfoo\x1b[0m\x1b[1;1Hbar')
    manager.emit('data', session.id, '\x1b[H\x1b[2J\x1b[2mfoo\x1b[0m\x1b[1;1Hbar')

    const listBox = widgets.createdLists[0]!
    expect(listBox.items[1]).toContain('working')
    expect(listBox.items[1]).not.toContain('foobar')
  })

  it('一覧の状態ラベルはstatusイベントでwaitingへ更新する', () => {
    const session = {
      id: 'claude-code#1',
      status: 'running',
      logBuffer: [],
      write: vi.fn(),
    }
    const screen = { render: vi.fn(), width: 80 }
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

    session.status = 'idle'
    manager.emit('status', session.id, 'idle')

    const listBox = widgets.createdLists[0]!
    expect(listBox.items[0]).toContain('Waiting')
    expect(listBox.items[1]).toContain('waiting')
  })

  it('下キーで見出しをまたいで次のセッションへ移動できる', () => {
    const firstSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const secondSession = { id: 'codex#1', status: 'idle', logBuffer: [], write: vi.fn() }
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

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('down')?.()

    expect(manager.selectedSession).toBe(secondSession)
    expect(listBox.selected).toBe(3)
  })

  it('上キーで見出しをまたいで前のセッションへ移動できる', () => {
    const firstSession = { id: 'claude-code#1', status: 'running', logBuffer: [], write: vi.fn() }
    const secondSession = { id: 'codex#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [firstSession, secondSession],
      selectedIndex: 1,
      selectedSession: secondSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('up')?.()

    expect(manager.selectedSession).toBe(firstSession)
    expect(listBox.selected).toBe(1)
  })

  it('表示順と内部順が違っても下キーで表示上の次へ移動する', () => {
    const completeSession = { id: 'claude-code#1', status: 'done', logBuffer: [], write: vi.fn() }
    const workingSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const waitingSession = { id: 'gemini-cli#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [completeSession, workingSession, waitingSession],
      selectedIndex: 1,
      selectedSession: workingSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('down')?.()

    expect(manager.selectedSession).toBe(waitingSession)
    expect(listBox.selected).toBe(3)
  })

  it('表示順と内部順が違っても上キーで表示上の前へ移動する', () => {
    const completeSession = { id: 'claude-code#1', status: 'done', logBuffer: [], write: vi.fn() }
    const workingSession = { id: 'codex#1', status: 'running', logBuffer: [], write: vi.fn() }
    const waitingSession = { id: 'gemini-cli#1', status: 'idle', logBuffer: [], write: vi.fn() }
    const screen = { render: vi.fn() }
    const manager = Object.assign(new EventEmitter(), {
      sessions: [completeSession, workingSession, waitingSession],
      selectedIndex: 0,
      selectedSession: completeSession,
      selectSession(index: number) {
        this.selectedIndex = index
        this.selectedSession = this.sessions[index] ?? null
      },
      addSession: vi.fn(),
      removeSession: vi.fn(),
    })

    new OverviewUI(screen as never, manager as never)

    const listBox = widgets.createdLists[0]!
    listBox.handlers.get('up')?.()

    expect(manager.selectedSession).toBe(waitingSession)
    expect(listBox.selected).toBe(3)
  })
})
