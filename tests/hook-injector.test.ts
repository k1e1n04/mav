import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const { buildHookArgs, cleanupHookFiles } = await import('../src/hook-injector.js')

describe('hook-injector: claude-code', () => {
  let tempHome: string
  let origHome: string | undefined

  beforeEach(() => {
    tempHome = join(tmpdir(), `mav-test-${randomUUID()}`)
    mkdirSync(join(tempHome, '.claude'), { recursive: true })
    origHome = process.env.HOME
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('settings.json がない場合は PostToolUse のみ追加する', () => {
    const { args } = buildHookArgs('claude-code', [], 'mav report cwd "$(pwd)"')
    const settingsIdx = args.indexOf('--settings')
    expect(settingsIdx).toBeGreaterThan(-1)
    const json = JSON.parse(args[settingsIdx + 1]!)
    expect(json.hooks.PostToolUse).toHaveLength(1)
    expect(json.hooks.PostToolUse[0].hooks[0].command).toBe('mav report cwd "$(pwd)"')
  })

  it('既存の settings.json の設定を保持しつつ PostToolUse を追加する', () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({
      model: 'sonnet',
      language: 'ja',
      permissions: { allow: ['bash'] },
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo done' }] }],
      },
    }))

    const { args } = buildHookArgs('claude-code', [], 'mav report cwd "$(pwd)"')
    const settingsIdx = args.indexOf('--settings')
    const json = JSON.parse(args[settingsIdx + 1]!)

    expect(json.model).toBe('sonnet')
    expect(json.language).toBe('ja')
    expect(json.permissions.allow).toContain('bash')
    expect(json.hooks.Stop).toHaveLength(1)
    const mavHook = (json.hooks.PostToolUse as Array<{ hooks: Array<{ command: string }> }>)
      .find(h => h.hooks[0]?.command === 'mav report cwd "$(pwd)"')
    expect(mavHook).toBeDefined()
  })

  it('既存の PostToolUse フックを保持しつつ mav フックを末尾に追加する', () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }],
      },
    }))

    const { args } = buildHookArgs('claude-code', [], 'mav report cwd "$(pwd)"')
    const json = JSON.parse(args[args.indexOf('--settings') + 1]!)

    expect(json.hooks.PostToolUse).toHaveLength(2)
    expect(json.hooks.PostToolUse[0].hooks[0].command).toBe('echo existing')
    expect(json.hooks.PostToolUse[1].hooks[0].command).toBe('mav report cwd "$(pwd)"')
  })

  it('壊れた settings.json は無視して PostToolUse のみ追加する', () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    writeFileSync(settingsPath, 'not valid json {{{')

    const { args } = buildHookArgs('claude-code', [], 'mav report cwd "$(pwd)"')
    const json = JSON.parse(args[args.indexOf('--settings') + 1]!)
    expect(json.hooks.PostToolUse).toHaveLength(1)
    expect(json.hooks.PostToolUse[0].hooks[0].command).toBe('mav report cwd "$(pwd)"')
  })

  it('既存のargsを保持する', () => {
    const { args } = buildHookArgs('claude-code', ['--model', 'opus'], 'mav report cwd "$(pwd)"')
    expect(args).toContain('--model')
    expect(args).toContain('opus')
  })

  it('cmd が claude 以外の wrapper の場合は --settings を注入しない', () => {
    const { args, hookFiles } = buildHookArgs(
      'claude-code',
      ['--resume', 'some-uuid'],
      'mav report cwd "$(pwd)"',
      { cmd: 'claude-launcher' },
    )
    expect(args).not.toContain('--settings')
    expect(args).toEqual(['--resume', 'some-uuid'])
    expect(hookFiles).toHaveLength(0)
  })

  it('cmd が claude のときは --settings を注入する', () => {
    const { args } = buildHookArgs(
      'claude-code',
      [],
      'mav report cwd "$(pwd)"',
      { cmd: 'claude' },
    )
    expect(args).toContain('--settings')
  })
})

describe('hook-injector: gemini-cli', () => {
  it('settings.local.json を書く候補パスを返す', () => {
    const cwd = '/tmp/test-project'
    const settingsPath = join(cwd, '.gemini', 'settings.local.json')
    // Ensure no leftover file from a previous run
    if (existsSync(settingsPath)) rmSync(settingsPath)

    const { hookFiles } = buildHookArgs('gemini-cli', [], 'mav report cwd "$(pwd)"', { cwd })
    expect(hookFiles).toHaveLength(1)
    expect(hookFiles[0]).toBe(settingsPath)

    // Cleanup
    cleanupHookFiles(hookFiles)
  })

  it('_mavGenerated マーカーがある古いファイルは上書きして再注入する', () => {
    const cwd = '/tmp/test-project'
    const settingsPath = join(cwd, '.gemini', 'settings.local.json')

    // Simulate a stale file written by mav
    mkdirSync(join(cwd, '.gemini'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ _mavGenerated: true, hooks: {} }))

    const { hookFiles } = buildHookArgs('gemini-cli', [], 'mav report cwd "$(pwd)"', { cwd })
    expect(hookFiles).toHaveLength(1)  // Was reinjected

    // Cleanup
    cleanupHookFiles(hookFiles)
  })

  it('ユーザーが所有する settings.local.json は上書きしない', () => {
    const cwd = '/tmp/test-project'
    const settingsPath = join(cwd, '.gemini', 'settings.local.json')

    // Simulate user-owned file (no marker)
    mkdirSync(join(cwd, '.gemini'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ hooks: { myHook: [] } }))

    const { hookFiles } = buildHookArgs('gemini-cli', [], 'mav report cwd "$(pwd)"', { cwd })
    expect(hookFiles).toHaveLength(0)  // Skipped

    // Verify user file content is unchanged
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(content._mavGenerated).toBeUndefined()
    expect(content.hooks.myHook).toBeDefined()

    // Cleanup
    rmSync(settingsPath)
  })
})

describe('hook-injector: codex', () => {
  it('--profile-v2 引数を追加する', () => {
    const { args, hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(args).toContain('--profile-v2')
    cleanupHookFiles(hookFiles)
  })

  it('hookFiles にTOMLファイルパスが含まれる', () => {
    const { hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(hookFiles[0]).toMatch(/\.config\.toml$/)
    expect(existsSync(hookFiles[0]!)).toBe(true)
    const content = readFileSync(hookFiles[0]!, 'utf-8')
    expect(content).toContain('post_tool_use')
    expect(content).toContain('mav report cwd')
    cleanupHookFiles(hookFiles)
  })
})

describe('hook-injector: copilot', () => {
  it('argsを変更せず repo-level hook file を生成する', () => {
    const cwd = '/tmp/copilot-project'
    const original = ['--allow-all']
    const { args, hookFiles } = buildHookArgs('copilot', original, 'mav report cwd "$(pwd)"', { cwd })

    expect(args).toEqual(original)
    expect(hookFiles).toHaveLength(1)
    expect(hookFiles[0]).toMatch(/\/\.github\/hooks\/mav-.*\.json$/)
    expect(existsSync(hookFiles[0]!)).toBe(true)

    const content = JSON.parse(readFileSync(hookFiles[0]!, 'utf-8'))
    expect(content.version).toBe(1)
    expect(content.hooks.postToolUse[0].command).toBe('mav report cwd "$(pwd)"')

    cleanupHookFiles(hookFiles)
  })
})

describe('hook-injector: claude-code + settingsFile (wrapper)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `mav-settings-test-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('settingsFile の内容 + hook をマージした一時ファイルを --settings で渡す', () => {
    const settingsFile = join(tempDir, 'overlay.json')
    writeFileSync(settingsFile, JSON.stringify({ apiKeyHelper: 'litellm-auth', model: 'gpt-4o' }))

    const { args, hookFiles } = buildHookArgs(
      'claude-code',
      ['--resume', 'uuid'],
      'mav report cwd "$(pwd)"',
      { cmd: 'claude-launcher', settingsFile },
    )

    // --settings <tempfile> が追加されている
    const settingsIdx = args.indexOf('--settings')
    expect(settingsIdx).toBeGreaterThan(-1)
    const tempPath = args[settingsIdx + 1]!
    expect(tempPath).toMatch(/mav-settings-[0-9a-f]+\.json$/)

    // 一時ファイルに apiKeyHelper + hook がマージされている
    const content = JSON.parse(readFileSync(tempPath, 'utf-8'))
    expect(content.apiKeyHelper).toBe('litellm-auth')
    expect(content.model).toBe('gpt-4o')
    expect(content.hooks.PostToolUse[0].hooks[0].command).toBe('mav report cwd "$(pwd)"')

    // settingsFile 本体は変更されていない
    const original = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    expect(original.hooks).toBeUndefined()

    // hookFiles に一時ファイルが登録されている（終了時に削除される）
    expect(hookFiles).toContain(tempPath)
    cleanupHookFiles(hookFiles)
    expect(existsSync(tempPath)).toBe(false)
  })

  it('settingsFile が存在しない場合は hook だけの一時ファイルを作る', () => {
    const settingsFile = join(tempDir, 'nonexistent.json')
    const { args } = buildHookArgs(
      'claude-code', [], 'mav report cwd "$(pwd)"',
      { cmd: 'claude-launcher', settingsFile },
    )
    const tempPath = args[args.indexOf('--settings') + 1]!
    const content = JSON.parse(readFileSync(tempPath, 'utf-8'))
    expect(content.hooks.PostToolUse).toHaveLength(1)
    cleanupHookFiles([tempPath])
  })

  it('同じ settingsFile パスは常に同じ一時ファイル名になる（クラッシュ後の蓄積を防ぐ）', () => {
    const settingsFile = join(tempDir, 'overlay.json')
    writeFileSync(settingsFile, '{}')

    const { args: args1 } = buildHookArgs('claude-code', [], 'hook', { cmd: 'claude-launcher', settingsFile })
    const { args: args2 } = buildHookArgs('claude-code', [], 'hook', { cmd: 'claude-launcher', settingsFile })

    const path1 = args1[args1.indexOf('--settings') + 1]
    const path2 = args2[args2.indexOf('--settings') + 1]
    expect(path1).toBe(path2)
    cleanupHookFiles([path1!])
  })

  it('settingsFile なしで wrapper の場合は --settings を渡さない', () => {
    const { args, hookFiles } = buildHookArgs(
      'claude-code', [], 'mav report cwd "$(pwd)"',
      { cmd: 'claude-launcher' },
    )
    expect(args).not.toContain('--settings')
    expect(hookFiles).toHaveLength(0)
  })
})

describe('cleanupHookFiles', () => {
  it('hookFilesを削除する', () => {
    const { hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(existsSync(hookFiles[0]!)).toBe(true)
    cleanupHookFiles(hookFiles)
    expect(existsSync(hookFiles[0]!)).toBe(false)
  })
})
