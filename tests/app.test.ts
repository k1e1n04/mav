import { beforeEach, describe, expect, it, vi } from 'vitest'

type KeyHandler = () => void

const {
  screenKeyHandlers,
  screenOnHandlers,
  screenRenderMock,
  screenDestroyMock,
  overviewShowMock,
  overviewHideMock,
  overviewResizeSelectedSessionMock,
  detailShowMock,
  detailHideMock,
  detailAttachMock,
  detailDetachMock,
  detailResizeMock,
  killAllMock,
  screenState,
  triggerExitDetail,
  setExitDetailHandler,
  overviewCtorArgs,
} = vi.hoisted(() => {
  let onExitDetailHandler: (() => void) | null = null
  return {
    screenKeyHandlers: new Map<string, KeyHandler>(),
    screenOnHandlers: new Map<string, () => void>(),
    screenRenderMock: vi.fn(),
    screenDestroyMock: vi.fn(),
    overviewShowMock: vi.fn(),
    overviewHideMock: vi.fn(),
    overviewResizeSelectedSessionMock: vi.fn(),
    detailShowMock: vi.fn(),
    detailHideMock: vi.fn(),
    detailAttachMock: vi.fn(),
    detailDetachMock: vi.fn(),
    detailResizeMock: vi.fn(),
    killAllMock: vi.fn(),
    screenState: {
      current: null as {
        program: {
          disableMouse: ReturnType<typeof vi.fn>
          enableMouse: ReturnType<typeof vi.fn>
          normalBuffer: ReturnType<typeof vi.fn>
          alternateBuffer: ReturnType<typeof vi.fn>
        }
        realloc: ReturnType<typeof vi.fn>
      } | null,
    },
    overviewCtorArgs: [] as unknown[][],
    setExitDetailHandler: (handler: () => void) => {
      onExitDetailHandler = handler
    },
    triggerExitDetail: () => {
      onExitDetailHandler?.()
    },
  }
})

vi.mock('neo-blessed', () => ({
  default: {
    screen: vi.fn(() => {
      screenState.current = {
        width: 120,
        height: 40,
        key(keys: string | string[], handler: KeyHandler) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            screenKeyHandlers.set(key, handler)
          }
        },
        on(event: string, handler: () => void) {
          screenOnHandlers.set(event, handler)
        },
        render: screenRenderMock,
        destroy: screenDestroyMock,
        program: {
          disableMouse: vi.fn(),
          enableMouse: vi.fn(),
          normalBuffer: vi.fn(),
          alternateBuffer: vi.fn(),
        },
        realloc: vi.fn(),
      } as never
      return screenState.current
    }),
  },
}))

vi.mock('../src/ui/overview.js', () => ({
  OverviewUI: class {
    constructor(...args: unknown[]) {
      overviewCtorArgs.push(args)
    }
    isPromptOpen() {
      return false
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
    constructor(_screen: unknown, onExitDetail: () => void) {
      setExitDetailHandler(onExitDetail)
    }
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

import { App } from '../src/ui/app.js'

describe('App', () => {
  beforeEach(() => {
    screenKeyHandlers.clear()
    screenOnHandlers.clear()
    overviewCtorArgs.length = 0
    screenState.current = null
    vi.clearAllMocks()
  })

  it('overviewでEnterすると詳細モードに入る', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()

    expect(overviewHideMock).toHaveBeenCalledTimes(1)
    expect(detailAttachMock).toHaveBeenCalledWith(selectedSession)
    expect(detailShowMock).toHaveBeenCalledTimes(1)
  })

  it('overviewからdetailへ入る時は端末のnormal bufferへ戻す', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()

    expect(screenState.current?.program.normalBuffer).toHaveBeenCalledTimes(1)
  })

  it('overviewからdetailへ入る時はmouse trackingを無効化する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()

    expect(screenState.current?.program.disableMouse).toHaveBeenCalledTimes(1)
  })

  it('overviewからdetailへ入る時は選択セッションをフルスクリーン寸法へresizeする', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()

    expect(detailResizeMock).toHaveBeenCalledWith(120, 40)
  })

  it('detailでCtrl+]相当の終了コールバックが走るとoverviewに戻る', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()
    triggerExitDetail()

    expect(detailDetachMock).toHaveBeenCalledTimes(1)
    expect(detailHideMock).toHaveBeenCalledTimes(1)
    expect(screenState.current?.program.enableMouse).toHaveBeenCalledTimes(1)
    expect(overviewShowMock).toHaveBeenCalledTimes(1)
  })

  it('overviewで新規セッション作成コールバックを受けるとそのセッション詳細へ移動する', () => {
    const initialSession = { id: 'claude-code#1', resize: vi.fn() }
    const addedSession = { id: 'codex#1', resize: vi.fn() }
    const manager = {
      sessions: [initialSession, addedSession],
      selectedSession: initialSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    const onSessionCreated = overviewCtorArgs[0]?.[2] as ((session: unknown) => void) | undefined
    expect(onSessionCreated).toBeTypeOf('function')

    onSessionCreated?.(addedSession)

    expect(overviewHideMock).toHaveBeenCalledTimes(1)
    expect(detailAttachMock).toHaveBeenCalledWith(addedSession)
    expect(detailShowMock).toHaveBeenCalledTimes(1)
  })

  it('overview中のscreen resizeではpreviewを再描画する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenOnHandlers.get('resize')?.()

    expect(overviewResizeSelectedSessionMock).toHaveBeenCalledTimes(1)
    expect(detailResizeMock).not.toHaveBeenCalled()
  })

  it('detail中のscreen resizeではフルスクリーン寸法へ再調整する', () => {
    const selectedSession = { id: 'claude-code#1', resize: vi.fn() }
    const manager = {
      sessions: [selectedSession],
      selectedSession,
      killAll: killAllMock,
    }

    new App(manager as never)

    screenKeyHandlers.get('enter')?.()
    screenOnHandlers.get('resize')?.()

    expect(detailResizeMock).toHaveBeenCalledWith(120, 40)
  })
})
