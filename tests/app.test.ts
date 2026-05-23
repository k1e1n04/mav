import { beforeEach, describe, expect, it, vi } from 'vitest'

type KeyHandler = () => void

const {
  screenKeyHandlers,
  screenOnHandlers,
  screenRenderMock,
  screenDestroyMock,
  overviewShowMock,
  overviewHideMock,
  detailShowMock,
  detailHideMock,
  detailAttachMock,
  detailDetachMock,
  killAllMock,
  triggerExitDetail,
  setExitDetailHandler,
} = vi.hoisted(() => {
  let onExitDetailHandler: (() => void) | null = null
  return {
    screenKeyHandlers: new Map<string, KeyHandler>(),
    screenOnHandlers: new Map<string, () => void>(),
    screenRenderMock: vi.fn(),
    screenDestroyMock: vi.fn(),
    overviewShowMock: vi.fn(),
    overviewHideMock: vi.fn(),
    detailShowMock: vi.fn(),
    detailHideMock: vi.fn(),
    detailAttachMock: vi.fn(),
    detailDetachMock: vi.fn(),
    killAllMock: vi.fn(),
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
    screen: vi.fn(() => ({
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
        alternateBuffer: vi.fn(),
      },
      realloc: vi.fn(),
    })),
  },
}))

vi.mock('../src/ui/overview.js', () => ({
  OverviewUI: class {
    show() {
      overviewShowMock()
    }
    hide() {
      overviewHideMock()
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
  },
}))

import { App } from '../src/ui/app.js'

describe('App', () => {
  beforeEach(() => {
    screenKeyHandlers.clear()
    screenOnHandlers.clear()
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
    expect(overviewShowMock).toHaveBeenCalledTimes(1)
  })
})
