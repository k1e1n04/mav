import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('runtime dependencies', () => {
  it('does not depend on neo-blessed or term.js', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['neo-blessed']).toBeUndefined()
    expect(pkg.dependencies?.['term.js']).toBeUndefined()
  })
})
