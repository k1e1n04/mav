import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

const TMP = join(tmpdir(), 'mav-test-config')

beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('設定ファイルがない場合はデフォルト設定を返す', () => {
    const config = loadConfig(join(TMP, 'nonexistent.yaml'))
    expect(config.agents).toHaveLength(1)
    expect(config.agents[0].type).toBe('claude-code')
    expect(config.agents[0].cmd).toBe('claude')
    expect(config.agents[0].args).toEqual([])
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

  it('copilotのデフォルトcmdはgh', () => {
    const yaml = `agents:\n  - type: copilot\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gh')
    expect(config.agents[0].args).toEqual(['copilot', 'suggest'])
  })
})
