import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveState, loadState } from '../src/state.js'
import type { SessionManager } from '../src/session-manager.js'

function makeManager(sessions: Array<{ id: string; logBuffer: string[]; status: string; sessionId?: string }>) {
  return { sessions } as unknown as SessionManager
}

describe('loadState', () => {
  let tmpDir: string
  let statePath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mav-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    statePath = join(tmpDir, 'state.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('存在しないファイルから読んだときnullを返す', () => {
    expect(loadState(join(tmpDir, 'nonexistent.json'))).toBeNull()
  })

  it('不正なJSONのときnullを返す', () => {
    writeFileSync(statePath, 'not json', 'utf-8')
    expect(loadState(statePath)).toBeNull()
  })
})

describe('saveState / loadState', () => {
  let tmpDir: string
  let statePath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mav-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    statePath = join(tmpDir, 'state.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('セッションのlogBufferをファイルに保存して復元できる', () => {
    const manager = makeManager([
      { id: 'claude-code#1', logBuffer: ['hello\r\n', 'world\r\n'], status: 'idle' },
    ])
    saveState(statePath, manager)
    const state = loadState(statePath)
    expect(state?.sessions['claude-code#1']?.logBuffer).toEqual(['hello\r\n', 'world\r\n'])
  })

  it('ディレクトリが存在しなくても保存できる', () => {
    const nestedPath = join(tmpDir, 'sub', 'dir', 'state.json')
    saveState(nestedPath, makeManager([]))
    expect(loadState(nestedPath)).not.toBeNull()
  })

  it('sessionIdがある場合はstateに含めて復元できる', () => {
    const manager = makeManager([
      { id: 'claude-code#1', logBuffer: [], status: 'idle', sessionId: 'abc-uuid-123' },
    ])
    saveState(statePath, manager)
    const state = loadState(statePath)
    expect(state?.sessions['claude-code#1']?.sessionId).toBe('abc-uuid-123')
  })

  it('sessionIdがない場合はstateに含まれない', () => {
    const manager = makeManager([
      { id: 'claude-code#1', logBuffer: [], status: 'idle' },
    ])
    saveState(statePath, manager)
    const state = loadState(statePath)
    expect(state?.sessions['claude-code#1']?.sessionId).toBeUndefined()
  })

  it('複数セッションのlogBufferをすべて保存して復元できる', () => {
    const manager = makeManager([
      { id: 'claude-code#1', logBuffer: ['a'], status: 'idle' },
      { id: 'gemini-cli#1', logBuffer: ['b', 'c'], status: 'done' },
    ])
    saveState(statePath, manager)
    const state = loadState(statePath)
    expect(state?.sessions['claude-code#1']?.logBuffer).toEqual(['a'])
    expect(state?.sessions['gemini-cli#1']?.logBuffer).toEqual(['b', 'c'])
  })
})
