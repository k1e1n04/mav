import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailUI } from '../src/ui/detail.js'

class MockInput extends EventEmitter {}

describe('DetailUI', () => {
  let input: MockInput
  let outputWrite: ReturnType<typeof vi.fn>
  let onExitDetail: ReturnType<typeof vi.fn>
  let debugKeyLogPath: string
  let session: EventEmitter & {
    logBuffer: string[]
    write: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
  }
  let ui: DetailUI

  beforeEach(() => {
    vi.useFakeTimers()
    input = new MockInput()
    outputWrite = vi.fn()
    onExitDetail = vi.fn()
    debugKeyLogPath = join(tmpdir(), `mav-detail-${process.pid}-${Date.now()}.log`)
    process.env.MAV_DEBUG_KEYS_PATH = debugKeyLogPath
    session = Object.assign(new EventEmitter(), {
      logBuffer: [],
      write: vi.fn(),
      resize: vi.fn(),
    })

    ui = new DetailUI({
      onData(handler: (chunk: string | Buffer) => void) {
        input.on('data', handler)
        return () => input.off('data', handler)
      },
      write: outputWrite,
      clearScreen: vi.fn(),
    } as never, onExitDetail)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.MAV_DEBUG_KEYS_PATH
  })

  it('詳細モードでは左矢印をそのままPTYへ送る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[D')

    expect(session.write).toHaveBeenCalledWith('\x1b[D')
  })

  it('詳細モードではCtrl+BをそのままPTYへ送る', () => {
    ui.attach(session as never)

    input.emit('data', '\x02')

    expect(session.write).toHaveBeenCalledWith('\x02')
  })

  it('詳細モードではCtrl+]でoverviewへ戻りPTYには送らない', () => {
    ui.attach(session as never)

    input.emit('data', '\x1d')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1d')
  })

  it('詳細モードではkitty keyboardのCtrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[93;5u')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[93;5u')
  })

  it('詳細モードではmodifyOtherKeys形式のCtrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[27;5;93~')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[27;5;93~')
  })

  it('詳細モードではCodexのCSI u拡張Ctrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[93::92;5u')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[93::92;5u')
  })

  it('詳細モードではCodexのCSI u拡張Ctrl+Shift+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[93::92;5:3u')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[93::92;5:3u')
  })

  it('詳細モードではCodexの別形式Ctrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[99;5u')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[99;5u')
  })

  it('詳細モードでは分割されたkitty keyboardのCtrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[93;')
    input.emit('data', '5u')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[93;')
    expect(session.write).not.toHaveBeenCalledWith('5u')
  })

  it('詳細モードでは分割されたmodifyOtherKeys形式のCtrl+]でもoverviewへ戻る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[27;5;')
    input.emit('data', '93~')

    expect(onExitDetail).toHaveBeenCalledTimes(1)
    expect(session.write).not.toHaveBeenCalledWith('\x1b[27;5;')
    expect(session.write).not.toHaveBeenCalledWith('93~')
  })

  it('単独のESCは短い待機後にPTYへ送る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b')
    expect(session.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)

    expect(session.write).toHaveBeenCalledWith('\x1b')
    expect(onExitDetail).not.toHaveBeenCalled()
  })

  it('入力デバッグが有効なら受け取ったバイト列をログに残す', () => {
    ui.attach(session as never)

    input.emit('data', '\x1d')

    const log = readFileSync(debugKeyLogPath, 'utf8')
    expect(log).toContain('hex=1d')
  })

  it('terminalのkeyboard enhancement flagsを検出したらdetach時に解除する', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[?7u')
    ui.detach()

    expect(outputWrite).toHaveBeenCalledWith('\x1b[=0u')
  })

  it('terminalのkeyboard enhancement flags応答はPTYへ送らない', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b[?7u')

    expect(session.write).not.toHaveBeenCalled()
  })

  it('WarpのAPC応答はPTYへ送らない', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b_Warp;tab-name=My Warp Tab\r\n\x1b\\')

    expect(session.write).not.toHaveBeenCalled()
  })

  it('分割されたWarpのAPC応答を捨てたあとにユーザー入力だけをPTYへ送る', () => {
    ui.attach(session as never)

    input.emit('data', '\x1b_Warp;tab-name=')
    input.emit('data', 'My Warp Tab\r\n')
    input.emit('data', '\x1b\\')
    input.emit('data', 'hello')

    expect(session.write).toHaveBeenCalledTimes(1)
    expect(session.write).toHaveBeenCalledWith('hello')
  })

  it('前回検出したkeyboard enhancement flagsをreattach時に復元する', () => {
    ui.attach(session as never)
    input.emit('data', '\x1b[?7u')
    ui.detach()

    const nextSession = Object.assign(new EventEmitter(), {
      logBuffer: [],
      write: vi.fn(),
      resize: vi.fn(),
    })

    ui.attach(nextSession as never)

    expect(outputWrite).toHaveBeenCalledWith('\x1b[=7u')
  })

  it('attach時に端末のソフトリセット(DECSTR)を送信してセッション間の状態汚染を防ぐ', () => {
    ui.attach(session as never)
    expect(outputWrite).toHaveBeenCalledWith('\x1b[!p')
  })

  it('別セッションのデータは端末に書き込まれない', () => {
    const otherSession = Object.assign(new EventEmitter(), {
      logBuffer: [],
      write: vi.fn(),
      resize: vi.fn(),
    })

    ui.attach(session as never)
    outputWrite.mockClear()

    otherSession.emit('data', 'contamination data from other session')

    const writtenTexts = outputWrite.mock.calls.map((call) => call[0])
    expect(writtenTexts).not.toContain('contamination data from other session')
  })

  it('detach後にセッションからデータが来ても端末に書き込まない', () => {
    ui.attach(session as never)
    ui.detach()
    outputWrite.mockClear()

    session.emit('data', 'late data after detach')

    const writtenTexts = outputWrite.mock.calls.map((call) => call[0])
    expect(writtenTexts).not.toContain('late data after detach')
  })
})
