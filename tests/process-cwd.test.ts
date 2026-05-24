import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('getClaudeChildPid', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('invalid pid では null を返す', async () => {
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(0, 'darwin')).toBeNull()
    expect(getClaudeChildPid(-1, 'linux')).toBeNull()
  })

  it('darwin: node+claude な直接の子プロセスの PID を返す', async () => {
    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'pgrep') return '9999\n2000\n'
      const pidArg = args[args.indexOf('-p') + 1]
      if (pidArg === '9999') return '   9999 node /usr/local/bin/claude\n'
      if (pidArg === '2000') return '   2000 bash\n'
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'darwin')).toBe(9999)
    expect(execFileSync).toHaveBeenCalledWith('pgrep', ['-P', '1234'], { encoding: 'utf8' })
  })

  it('darwin: claude でないプロセスのみのとき null を返す', async () => {
    const execFileSync = vi.fn((cmd: string) => {
      if (cmd === 'pgrep') return '2000\n'
      return '   2000 bash\n'
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'darwin')).toBeNull()
  })

  it('darwin: 直接の子がない（pgrep 失敗）とき null を返す', async () => {
    const execFileSync = vi.fn(() => { throw Object.assign(new Error('Command failed'), { code: 1 }) })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'darwin')).toBeNull()
  })

  it('linux: node+claude な直接の子プロセスの PID を返す', async () => {
    const readFileSync = vi.fn((path: string) => {
      if (path === '/proc/1234/task/1234/children') return '9999 2000 '
      if (path === '/proc/9999/cmdline') return 'node\0/usr/local/bin/claude\0'
      if (path === '/proc/2000/cmdline') return 'bash\0'
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'linux')).toBe(9999)
    expect(readFileSync).toHaveBeenCalledWith('/proc/1234/task/1234/children', 'utf8')
  })

  it('linux: claude でないプロセスのみのとき null を返す', async () => {
    const readFileSync = vi.fn((path: string) => {
      if (path === '/proc/1234/task/1234/children') return '2000 '
      if (path === '/proc/2000/cmdline') return 'bash\0'
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'linux')).toBeNull()
  })

  it('linux: children ファイルが存在しないとき null を返す', async () => {
    const readFileSync = vi.fn(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'linux')).toBeNull()
  })
})

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
