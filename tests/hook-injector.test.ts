import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const { buildHookArgs, cleanupHookFiles } = await import('../src/hook-injector.js')

describe('hook-injector: claude-code', () => {
  it('claude-code は args を変更せず hookFiles が空の no-op を返す', () => {
    const { args, hookFiles } = buildHookArgs('claude-code', ['--model', 'opus'], 'mav report cwd "$(pwd)"')
    expect(args).toEqual(['--model', 'opus'])
    expect(hookFiles).toHaveLength(0)
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


describe('cleanupHookFiles', () => {
  it('hookFilesを削除する', () => {
    const { hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(existsSync(hookFiles[0]!)).toBe(true)
    cleanupHookFiles(hookFiles)
    expect(existsSync(hookFiles[0]!)).toBe(false)
  })
})
