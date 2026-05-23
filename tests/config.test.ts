import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

const TMP = join(tmpdir(), 'mav-test-config')

beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('設定ファイルがない場合はデフォルト設定は空のagents配列を返す', () => {
    const config = loadConfig(join(TMP, 'nonexistent.yaml'))
    expect(config.agents).toHaveLength(0)
  })

  it('typeのみ指定でデフォルトcmdが補完される', () => {
    const yaml = `agents:\n  - type: codex\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('codex')
    expect(config.agents[0].args).toEqual([])
  })

  it('cmdをオーバーライドできる', () => {
    const yaml = `agents:\n  - type: claude-code\n    cmd: claude-launcher\n    args: []\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('claude-launcher')
  })

  it('argsを複数指定できる', () => {
    const yaml = `agents:\n  - type: copilot\n    cmd: gh\n    args:\n      - copilot\n      - suggest\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gh')
    expect(config.agents[0].args).toEqual(['copilot', 'suggest'])
  })

  it('gemini-cliのデフォルトcmdはgemini', () => {
    const yaml = `agents:\n  - type: gemini-cli\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gemini')
  })

  it('copilotのデフォルトcmdはcopilot', () => {
    const yaml = `agents:\n  - type: copilot\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('copilot')
    expect(config.agents[0].args).toEqual([])
  })

  it('args が配列でない場合はデフォルトargsにフォールバックする', () => {
    const yaml = `agents:\n  - type: codex\n    args: nope\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].args).toEqual([])
  })

  it('resumeArgsをYAMLから読み込める', () => {
    const yaml = `agents:\n  - type: claude-code\n    resumeArgs:\n      - --resume\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].resumeArgs).toEqual(['--resume'])
  })

  it('claude-codeのデフォルトresumeArgsはundefined（自動管理するため不要）', () => {
    const yaml = `agents:\n  - type: claude-code\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0]?.resumeArgs).toBeUndefined()
  })

  it('resumeArgsが配列でない場合はundefinedになる', () => {
    const yaml = `agents:\n  - type: claude-code\n    resumeArgs: invalid\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].resumeArgs).toBeUndefined()
  })
})
