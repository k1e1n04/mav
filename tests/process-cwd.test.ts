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

  it('darwin: wrapper → claude の孫プロセスを BFS で見つける', async () => {
    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'pgrep') {
        const parent = args[args.indexOf('-P') + 1]
        if (parent === '1234') return '5678\n'
        if (parent === '5678') return '9999\n'
        throw Object.assign(new Error('no children'), { code: 1 })
      }
      // ps
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '5678') return '   5678 claude-launcher\n'
      if (pid === '9999') return '   9999 node /usr/local/bin/claude\n'
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'darwin')).toBe(9999)
  })

  it('darwin: 深さ上限（5）を超えたプロセスは探索しない', async () => {
    // 深さ6の chain: 1234 → 2 → 3 → 4 → 5 → 6 → 9999(claude)
    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'pgrep') {
        const parent = args[args.indexOf('-P') + 1]
        const chain: Record<string, string> = {
          '1234': '2\n', '2': '3\n', '3': '4\n', '4': '5\n', '5': '6\n', '6': '9999\n',
        }
        const result = chain[parent]
        if (result) return result
        throw Object.assign(new Error('no children'), { code: 1 })
      }
      // ps: 全部 bash として返す（9999 だけ claude）
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '9999') return '   9999 node /usr/local/bin/claude\n'
      return `   ${pid} bash\n`
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFileSync }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    // 深さ6は上限を超えるので見つからない
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

  it('linux: wrapper → claude の孫プロセスを BFS で見つける', async () => {
    const readFileSync = vi.fn((path: string) => {
      if (path === '/proc/1234/task/1234/children') return '5678 '
      if (path === '/proc/5678/cmdline') return 'claude-launcher\0'
      if (path === '/proc/5678/task/5678/children') return '9999 '
      if (path === '/proc/9999/cmdline') return 'node\0/usr/local/bin/claude\0'
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    expect(getClaudeChildPid(1234, 'linux')).toBe(9999)
  })

  it('linux: 深さ上限（5）を超えたプロセスは探索しない', async () => {
    // chain: 1234 → 2 → 3 → 4 → 5 → 6 → 9999(claude)
    const readFileSync = vi.fn((path: string) => {
      const childrenMatch = path.match(/^\/proc\/(\d+)\/task\/\1\/children$/)
      if (childrenMatch) {
        const chain: Record<string, string> = {
          '1234': '2 ', '2': '3 ', '3': '4 ', '4': '5 ', '5': '6 ', '6': '9999 ',
        }
        return chain[childrenMatch[1]] ?? ''
      }
      const cmdlineMatch = path.match(/^\/proc\/(\d+)\/cmdline$/)
      if (cmdlineMatch) {
        if (cmdlineMatch[1] === '9999') return 'node\0/usr/local/bin/claude\0'
        return `bash\0`
      }
      return ''
    })
    vi.doMock('node:fs', () => ({ readlinkSync: vi.fn(), readFileSync }))
    vi.doMock('node:child_process', () => ({ execFileSync: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    // 深さ6は上限を超えるので見つからない
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
