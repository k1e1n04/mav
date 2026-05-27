import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type KeyHandler = (str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => void

const {
  keypressHandlers,
  resizeHandlers,
  overviewShowMock,
  overviewHideMock,
  overviewResizeSelectedSessionMock,
  overviewHandleKeypressMock,
  isPromptOpenMock,
  detailShowMock,
  detailHideMock,
  detailAttachMock,
  detailDetachMock,
  detailResizeMock,
  killAllMock,
  triggerOverviewSessionCreated,
  saveStateMock,
} = vi.hoisted(() => {
  let onSessionCreated: ((session: unknown) => void) | null = null
  return {
    keypressHandlers: [] as KeyHandler[],
    resizeHandlers: [] as (() => void)[],
    overviewShowMock: vi.fn(),
    overviewHideMock: vi.fn(),
    overviewResizeSelectedSessionMock: vi.fn(),
    overviewHandleKeypressMock: vi.fn(),
    isPromptOpenMock: vi.fn().mockReturnValue(false),
    detailShowMock: vi.fn(),
    detailHideMock: vi.fn(),
    detailAttachMock: vi.fn(),
    detailDetachMock: vi.fn(),
    detailResizeMock: vi.fn(),
    killAllMock: vi.fn(),
    saveStateMock: vi.fn(),
    triggerOverviewSessionCreated: (session: unknown) => {
      onSessionCreated?.(session)
    },
    setOverviewSessionCreated: (handler: (session: unknown) => void) => {
      onSessionCreated = handler
    },
  }
})

vi.mock('../src/ui/overview.js', () => ({
  OverviewUI: class {
    constructor(_terminal: unknown, _manager: unknown, onSessionCreated: (session: unknown) => void) {
      ;(globalThis as unknown as { __setOverviewSessionCreated?: (handler: (session: unknown) => void) => void })
        .__setOverviewSessionCreated?.(onSessionCreated)
    }
    isPromptOpen() {
      return isPromptOpenMock()
    }
    handleKeypress(str: string, key: unknown) {
      overviewHandleKeypressMock(str, key)
    }
    show() {
      overviewShowMock()
    }
    hide() {
      overviewHideMock()
    }
    resizeSelectedSession() {
      overviewResizeSelectedSessionMock()
    }
  },
}))

vi.mock('../src/ui/detail.js', () => ({
  DetailUI: class {
    constructor() {}
    attach(session: unknown) {
      detailAttachMock(session)
    }
    detach() {
      detailDetachMock()
    }
    show() {
      detailShowMock()
    }
    hide() {
      detailHideMock()
    }
    resize(cols: number, rows: number) {
      detailResizeMock(cols, rows)
    }
  },
}))

vi.mock('../src/state.js', () => ({
  saveState: saveStateMock,
}))

import { App } from '../src/ui/app.js'

function makeTerminal() {
  return {
    cols: 120,
    rows: 40,
    onKeypress(handler: KeyHandler) {
      keypressHandlers.push(handler)
      return () => {}
    },
    onResize(handler: () => void) {
      resizeHandlers.push(handler)
      return () => {}
    },
    enterAlternateScreen: vi.fn(),
    exitAlternateScreen: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('App', () => {
  beforeEach(() => {
    keypressHandlers.length = 0
    resizeHandlers.length = 0
    vi.clearAllMocks()
    isPromptOpenMock.mockReturnValue(false)
    ;(globalThis as unknown as { __setOverviewSessionCreated?: (handler: (session: unknown) => void) => void })
      .__setOverviewSessionCreated = (handler) => {
        ;(triggerOverviewSessionCreated as unknown as { handler?: (session: unknown) => void }).handler = handler
      }
  })

  function makeManager(overrides: { sessions?: unknown[]; selectedSession?: unknown } = {}) {
    return Object.assign(new EventEmitter(), {
      sessions: overrides.sessions ?? [],
      selectedSession: overrides.selectedSession ?? null,
      killAll: killAllMock,
    })
  }

  function emitKey(str: string, key: { name?: string; ctrl?: boolean; sequence?: string } = {}) {
    for (const handler of keypressHandlers) {
      handler(str, { sequence: str, ...key })
    }
  }

  it('overviewでEnterすると詳細モードに入る', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [selectedSession], selectedSession })
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)

    emitKey('', { name: 'enter' })

    expect(overviewHideMock).toHaveBeenCalledTimes(1)
    expect(detailAttachMock).toHaveBeenCalledWith(selectedSession)
    expect(detailShowMock).toHaveBeenCalledTimes(1)
    expect(terminal.exitAlternateScreen).toHaveBeenCalledTimes(1)
  })

  it('detailからoverviewへ戻るとalternate screenへ入る', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [selectedSession], selectedSession })
    const terminal = makeTerminal()
    const app = new App(manager as never, '/tmp/state.json', terminal as never)

    emitKey('', { name: 'enter' })
    ;(app as never).switchToOverview()

    expect(detailDetachMock).toHaveBeenCalledTimes(1)
    expect(detailHideMock).toHaveBeenCalledTimes(1)
    expect(terminal.enterAlternateScreen).toHaveBeenCalled()
    expect(overviewShowMock).toHaveBeenCalled()
  })

  it('overview中のresizeではoverviewを再描画する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [selectedSession], selectedSession })
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    resizeHandlers[0]?.()

    expect(overviewResizeSelectedSessionMock).toHaveBeenCalledTimes(1)
    expect(detailResizeMock).not.toHaveBeenCalled()
  })

  it('detail中のresizeではフルスクリーン寸法へ再調整する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [selectedSession], selectedSession })
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    emitKey('', { name: 'enter' })
    resizeHandlers[0]?.()

    expect(detailResizeMock).toHaveBeenCalledWith(120, 40)
  })

  it('overviewで新規セッション作成コールバックを受けるとそのセッション詳細へ移動する', () => {
    const initialSession = { id: 'claude-code#1', resize: vi.fn() }
    const addedSession = { id: 'codex#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [initialSession, addedSession], selectedSession: initialSession })
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    ;(triggerOverviewSessionCreated as unknown as { handler?: (session: unknown) => void }).handler?.(addedSession)

    expect(detailAttachMock).toHaveBeenCalledWith(addedSession)
    expect(detailShowMock).toHaveBeenCalledTimes(1)
  })

  it('overviewの未処理キーはOverviewUIへ委譲する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = makeManager({ sessions: [selectedSession], selectedSession })
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    emitKey('j', { name: 'j' })

    expect(overviewHandleKeypressMock).toHaveBeenCalledWith('j', expect.objectContaining({ name: 'j' }))
  })

  it('overviewでq押下時にsaveStateが失敗しても終了処理を続行する', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const manager = makeManager()
    const terminal = makeTerminal()
    saveStateMock.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    new App(manager as never, '/tmp/state.json', terminal as never)
    emitKey('q', { name: 'q' })

    expect(killAllMock).toHaveBeenCalledTimes(1)
    expect(terminal.destroy).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
  })

  it('manager.nameイベント発火時にsaveStateを即座に呼ぶ', () => {
    const manager = makeManager()
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    saveStateMock.mockClear()

    manager.emit('name', 'claude-code#1', 'My Agent')

    expect(saveStateMock).toHaveBeenCalledTimes(1)
    expect(saveStateMock).toHaveBeenCalledWith('/tmp/state.json', manager)
  })

  it('renameプロンプトが開いている状態でqを押しても終了しない', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    isPromptOpenMock.mockReturnValue(true)
    const manager = makeManager()
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    emitKey('q', { name: 'q' })

    expect(killAllMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('overviewでCtrl+C押下時に終了処理を続行する', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const manager = makeManager()
    const terminal = makeTerminal()

    new App(manager as never, '/tmp/state.json', terminal as never)
    emitKey('\x03', { name: 'c', ctrl: true })

    expect(killAllMock).toHaveBeenCalledTimes(1)
    expect(terminal.destroy).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
  })
})
