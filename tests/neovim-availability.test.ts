import { describe, expect, it } from 'vitest'

import { isNeovimAvailable } from './support/neovim.js'

describe('isNeovimAvailable', () => {
  it('returns false when nvim is not installed', () => {
    const available = isNeovimAvailable(() => ({
      error: Object.assign(new Error('spawnSync nvim ENOENT'), { code: 'ENOENT' }),
      status: null,
    }))

    expect(available).toBe(false)
  })

  it('throws unexpected spawn errors', () => {
    const boom = Object.assign(new Error('permission denied'), { code: 'EACCES' })

    expect(() =>
      isNeovimAvailable(() => ({
        error: boom,
        status: null,
      })),
    ).toThrow(boom)
  })
})
