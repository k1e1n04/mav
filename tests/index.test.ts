import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadConfigMock, managerAddSessionMock, appStartMock } = vi.hoisted(() => {
  return {
    loadConfigMock: vi.fn(),
    managerAddSessionMock: vi.fn(),
    appStartMock: vi.fn(),
  }
})

vi.mock('../src/config.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../src/session-manager.js', () => ({
  SessionManager: class {
    addSession(...args: unknown[]) {
      return managerAddSessionMock(...args)
    }
  },
}))

vi.mock('../src/ui/app.js', () => ({
  App: class {
    start() {
      return appStartMock()
    }
  },
}))

import { start } from '../src/index.js'

describe('start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agentType 未指定で起動対象がない場合は undefined を含まないエラーを出す', () => {
    loadConfigMock.mockReturnValue({ agents: [] })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`exit:${code ?? ''}`)
      }) as never)

    expect(() => start()).toThrow('exit:1')
    expect(errorSpy).toHaveBeenCalledWith('No agents found in config')
    expect(managerAddSessionMock).not.toHaveBeenCalled()
    expect(appStartMock).not.toHaveBeenCalled()

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
