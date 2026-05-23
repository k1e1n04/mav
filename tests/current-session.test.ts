import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCurrentSessionState, saveCurrentSessionState } from '../src/current-session.js'

describe('current session state', () => {
  let root: string
  let statePath: string

  beforeEach(() => {
    root = join(tmpdir(), `mav-current-session-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    statePath = join(root, 'current-session.json')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('選択中セッションを JSON に保存する', async () => {
    saveCurrentSessionState(statePath, {
      id: 'codex#1',
      type: 'codex',
      displayName: 'fix auth redirect',
      cwd: '/tmp/project-a',
    })

    const raw = await readFile(statePath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      sessionId: string
      agentType: string
      displayName: string
      cwd: string
      updatedAt: string
    }

    expect(parsed.sessionId).toBe('codex#1')
    expect(parsed.agentType).toBe('codex')
    expect(parsed.displayName).toBe('fix auth redirect')
    expect(parsed.cwd).toBe('/tmp/project-a')
    expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('親ディレクトリがなくても保存できる', () => {
    const nested = join(root, 'a', 'b', 'current-session.json')
    saveCurrentSessionState(nested, {
      id: 'claude-code#1',
      type: 'claude-code',
      displayName: 'claude-code 1',
      cwd: '/tmp/project-b',
    })

    expect(existsSync(nested)).toBe(true)
  })

  it('clear で current-session.json を削除する', () => {
    saveCurrentSessionState(statePath, {
      id: 'gemini-cli#1',
      type: 'gemini-cli',
      displayName: 'gemini-cli 1',
      cwd: '/tmp/project-c',
    })

    clearCurrentSessionState(statePath)

    expect(existsSync(statePath)).toBe(false)
  })
})
