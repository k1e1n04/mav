import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailUI } from '../src/ui/detail.js'

class MockInput extends EventEmitter {}

describe('DetailUI', () => {
  let input: MockInput
  let outputWrite: ReturnType<typeof vi.fn>
  let onExitDetail: ReturnType<typeof vi.fn>
  let session: EventEmitter & {
    logBuffer: string[]
    write: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
  }
  let ui: DetailUI

  beforeEach(() => {
    input = new MockInput()
    outputWrite = vi.fn()
    onExitDetail = vi.fn()
    session = Object.assign(new EventEmitter(), {
      logBuffer: [],
      write: vi.fn(),
      resize: vi.fn(),
    })

    ui = new DetailUI({
      program: {
        input,
        output: { write: outputWrite },
      },
    } as never, onExitDetail)
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
})
