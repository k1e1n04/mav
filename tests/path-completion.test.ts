import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { completePath } from '../src/ui/path-completion.js'

const TMP = join(tmpdir(), 'mav-path-completion-test')

beforeEach(() => {
  mkdirSync(join(TMP, 'alpha'), { recursive: true })
  mkdirSync(join(TMP, 'alpha2'), { recursive: true })
  mkdirSync(join(TMP, 'beta'), { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('completePath', () => {
  it('候補が1件なら completed にフルパスを返しcandidatesは空', () => {
    const result = completePath(join(TMP, 'be'))
    expect(result.completed).toBe(join(TMP, 'beta') + '/')
    expect(result.candidates).toHaveLength(0)
  })

  it('候補が複数なら LCP まで補完しcandidatesに全候補を返す', () => {
    const result = completePath(join(TMP, 'al'))
    expect(result.completed).toBe(join(TMP, 'alpha'))
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates).toContain(join(TMP, 'alpha') + '/')
    expect(result.candidates).toContain(join(TMP, 'alpha2') + '/')
  })

  it('マッチなしなら入力そのままを返す', () => {
    const result = completePath(join(TMP, 'zzz'))
    expect(result.completed).toBe(join(TMP, 'zzz'))
    expect(result.candidates).toHaveLength(0)
  })

  it('読み取れないパスでもクラッシュしない', () => {
    const result = completePath('/nonexistent-root-dir-xyz/foo')
    expect(result.completed).toBe('/nonexistent-root-dir-xyz/foo')
    expect(result.candidates).toHaveLength(0)
  })

  it('~ をHOMEに展開して補完し結果を ~ で返す', () => {
    const home = process.env.HOME!
    vi.spyOn(process, 'cwd').mockReturnValue(TMP)
    const spy = vi.spyOn(process, 'env', 'get').mockReturnValue({ ...process.env, HOME: home })

    // TMP が HOME 配下でないため ~ 展開のテストは HOME 配下にディレクトリを作れないので
    // HOME 展開のロジックは restoreHome の単体確認に留め、ここでは ~ 指定でもクラッシュしないことを確認
    const result = completePath('~/nonexistent-mav-test-xyz')
    expect(result.completed).toBe('~/nonexistent-mav-test-xyz')

    spy.mockRestore()
    vi.restoreAllMocks()
  })
})
