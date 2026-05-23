import { describe, expect, it } from 'vitest'

describe('runtime dependencies', () => {
  it('loads term.js required by neo-blessed terminal widget', async () => {
    await expect(import('term.js')).resolves.toBeDefined()
  })
})
