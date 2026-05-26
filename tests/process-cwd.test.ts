import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('getClaudeChildPid', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('invalid pid では null を返す', async () => {
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(0, 'darwin')).resolves.toBeNull()
    await expect(getClaudeChildPid(-1, 'linux')).resolves.toBeNull()
  })

  it('darwin: node+claude な直接の子プロセスの PID を返す', async () => {
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        callback(null, '9999\n2000\n')
        return
      }
      const pidArg = args[args.indexOf('-p') + 1]
      if (pidArg === '9999') callback(null, '   9999 node /usr/local/bin/claude\n')
      else if (pidArg === '2000') callback(null, '   2000 bash\n')
      else callback(null, '')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBe(9999)
    expect(execFile).toHaveBeenCalledWith('pgrep', ['-P', '1234'], expect.anything(), expect.any(Function))
  })

  it('darwin: claude でないプロセスのみのとき null を返す', async () => {
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        callback(null, '2000\n')
        return
      }
      callback(null, '   2000 bash\n')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBeNull()
  })

  it('darwin: 直接の子がない（pgrep 失敗）とき null を返す', async () => {
    const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(Object.assign(new Error('Command failed'), { code: 1 }), '')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBeNull()
  })

  it('darwin: wrapper → claude の孫プロセスを BFS で見つける', async () => {
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        const parent = args[args.indexOf('-P') + 1]
        if (parent === '1234') {
          callback(null, '5678\n')
        } else if (parent === '5678') {
          callback(null, '9999\n')
        } else {
          callback(Object.assign(new Error('no children'), { code: 1 }), '')
        }
        return
      }
      // ps
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '5678') callback(null, '   5678 claude-launcher\n')
      else if (pid === '9999') callback(null, '   9999 node /usr/local/bin/claude\n')
      else callback(null, '')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBe(9999)
  })

  it('darwin: claude バイナリ直接の子プロセス（claude-launcher 経由）の PID を返す', async () => {
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        callback(null, '31099\n')
        return
      }
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '31099') callback(null, '   31099 claude --settings /path/to/settings.json\n')
      else callback(null, '')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(28727, 'darwin')).resolves.toBe(31099)
  })

  it('darwin: フルパス付き claude バイナリも認識する', async () => {
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        callback(null, '9999\n')
        return
      }
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '9999') callback(null, '   9999 /usr/local/bin/claude --settings /path/to/settings.json\n')
      else callback(null, '')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBe(9999)
  })

  it('darwin: 深さ上限（5）を超えたプロセスは探索しない', async () => {
    // 深さ6の chain: 1234 → 2 → 3 → 4 → 5 → 6 → 9999(claude)
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (cmd === 'pgrep') {
        const parent = args[args.indexOf('-P') + 1]
        const chain: Record<string, string> = {
          '1234': '2\n', '2': '3\n', '3': '4\n', '4': '5\n', '5': '6\n', '6': '9999\n',
        }
        const result = chain[parent]
        if (result) {
          callback(null, result)
        } else {
          callback(Object.assign(new Error('no children'), { code: 1 }), '')
        }
        return
      }
      // ps: 全部 bash として返す（9999 だけ claude）
      const pid = args[args.indexOf('-p') + 1]
      if (pid === '9999') callback(null, '   9999 node /usr/local/bin/claude\n')
      else callback(null, `   ${pid} bash\n`)
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    // 深さ6は上限を超えるので見つからない
    await expect(getClaudeChildPid(1234, 'darwin')).resolves.toBeNull()
  })

  it('linux: node+claude な直接の子プロセスの PID を返す', async () => {
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path === '/proc/1234/task/1234/children') return Promise.resolve('9999 2000 ')
      if (path === '/proc/9999/cmdline') return Promise.resolve('node\0/usr/local/bin/claude\0')
      if (path === '/proc/2000/cmdline') return Promise.resolve('bash\0')
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBe(9999)
    expect(readFile).toHaveBeenCalledWith('/proc/1234/task/1234/children', 'utf8')
  })

  it('linux: claude でないプロセスのみのとき null を返す', async () => {
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path === '/proc/1234/task/1234/children') return Promise.resolve('2000 ')
      if (path === '/proc/2000/cmdline') return Promise.resolve('bash\0')
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBeNull()
  })

  it('linux: children ファイルが存在しないとき null を返す', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBeNull()
  })

  it('linux: wrapper → claude の孫プロセスを BFS で見つける', async () => {
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path === '/proc/1234/task/1234/children') return Promise.resolve('5678 ')
      if (path === '/proc/5678/cmdline') return Promise.resolve('claude-launcher\0')
      if (path === '/proc/5678/task/5678/children') return Promise.resolve('9999 ')
      if (path === '/proc/9999/cmdline') return Promise.resolve('node\0/usr/local/bin/claude\0')
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBe(9999)
  })

  it('linux: claude バイナリ直接の子プロセス（claude-launcher 経由）の PID を返す', async () => {
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path === '/proc/28727/task/28727/children') return Promise.resolve('31099 ')
      if (path === '/proc/31099/cmdline') return Promise.resolve('claude\0--settings\0/path/to/settings.json\0')
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(28727, 'linux')).resolves.toBe(31099)
  })

  it('linux: フルパス付き claude バイナリも認識する', async () => {
    const readFile = vi.fn().mockImplementation((path: string) => {
      if (path === '/proc/1234/task/1234/children') return Promise.resolve('9999 ')
      if (path === '/proc/9999/cmdline') return Promise.resolve('/usr/local/bin/claude\0--settings\0/path/to/settings.json\0')
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBe(9999)
  })

  it('linux: 深さ上限（5）を超えたプロセスは探索しない', async () => {
    // chain: 1234 → 2 → 3 → 4 → 5 → 6 → 9999(claude)
    const readFile = vi.fn().mockImplementation((path: string) => {
      const childrenMatch = path.match(/^\/proc\/(\d+)\/task\/\1\/children$/)
      if (childrenMatch) {
        const chain: Record<string, string> = {
          '1234': '2 ', '2': '3 ', '3': '4 ', '4': '5 ', '5': '6 ', '6': '9999 ',
        }
        return Promise.resolve(chain[childrenMatch[1]] ?? '')
      }
      const cmdlineMatch = path.match(/^\/proc\/(\d+)\/cmdline$/)
      if (cmdlineMatch) {
        if (cmdlineMatch[1] === '9999') return Promise.resolve('node\0/usr/local/bin/claude\0')
        return Promise.resolve('bash\0')
      }
      return Promise.resolve('')
    })
    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile }))
    vi.doMock('node:child_process', () => ({ execFile: vi.fn() }))
    const { getClaudeChildPid } = await import('../src/process-cwd.js')
    // 深さ6は上限を超えるので見つからない
    await expect(getClaudeChildPid(1234, 'linux')).resolves.toBeNull()
  })
})

describe('getProcessCwd', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('linux では /proc/<pid>/cwd を読む', async () => {
    const readlink = vi.fn().mockResolvedValue('/tmp/worktrees/linux-a')
    const execFile = vi.fn()

    vi.doMock('node:fs/promises', () => ({ readlink, readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    await expect(getProcessCwd(123, 'linux')).resolves.toBe('/tmp/worktrees/linux-a')
    expect(readlink).toHaveBeenCalledWith('/proc/123/cwd')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('darwin では lsof から cwd を読む', async () => {
    const readlink = vi.fn()
    const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'p123\nfcwd\nn/tmp/worktrees/mac-a\n')
    })

    vi.doMock('node:fs/promises', () => ({ readlink, readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    await expect(getProcessCwd(123, 'darwin')).resolves.toBe('/tmp/worktrees/mac-a')
    expect(execFile).toHaveBeenCalledWith(
      'lsof',
      ['-a', '-d', 'cwd', '-p', '123', '-Fn'],
      expect.anything(),
      expect.any(Function),
    )
    expect(readlink).not.toHaveBeenCalled()
  })

  it('darwin で lsof 出力に cwd がなければ null を返す', async () => {
    const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'p123\n')
    })

    vi.doMock('node:fs/promises', () => ({ readlink: vi.fn(), readFile: vi.fn() }))
    vi.doMock('node:child_process', () => ({ execFile }))

    const { getProcessCwd } = await import('../src/process-cwd.js')

    await expect(getProcessCwd(123, 'darwin')).resolves.toBeNull()
  })
})
