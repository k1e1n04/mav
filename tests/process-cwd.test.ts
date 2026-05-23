import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('getProcessCwd', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('linux では /proc/<pid>/cwd を読む', async () => {
    const readlinkSync = vi.fn(() => '/tmp/worktrees/linux-a')
    const execFileSync = vi.fn()

    vi.doMock('node:fs', () => ({ readlinkSync }))
    vi.doMock('node:child_process', () => ({ execFileSync }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    expect(getProcessCwd(123, 'linux')).toBe('/tmp/worktrees/linux-a')
    expect(readlinkSync).toHaveBeenCalledWith('/proc/123/cwd')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('darwin では lsof から cwd を読む', async () => {
    const readlinkSync = vi.fn()
    const execFileSync = vi.fn(() => 'p123\nfcwd\nn/tmp/worktrees/mac-a\n')

    vi.doMock('node:fs', () => ({ readlinkSync }))
    vi.doMock('node:child_process', () => ({ execFileSync }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    expect(getProcessCwd(123, 'darwin')).toBe('/tmp/worktrees/mac-a')
    expect(execFileSync).toHaveBeenCalledWith(
      'lsof',
      ['-a', '-d', 'cwd', '-p', '123', '-Fn'],
      { encoding: 'utf8' },
    )
    expect(readlinkSync).not.toHaveBeenCalled()
  })

  it('darwin で lsof 出力に cwd がなければ null を返す', async () => {
    const execFileSync = vi.fn(() => 'p123\n')

    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    expect(getProcessCwd(123, 'darwin')).toBeNull()
  })
})
