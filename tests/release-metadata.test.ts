import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('release metadata', () => {
  it('publishes the package under the scoped npm name while keeping the mav binary', () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      name: string
      bin?: Record<string, string>
      publishConfig?: {
        access?: string
      }
    }

    expect(packageJson.name).toBe('@k1e1n04/mav')
    expect(packageJson.bin?.mav).toBe('./dist/bin/mav.js')
    expect(packageJson.publishConfig?.access).toBe('public')
  })

  it('documents explicit install commands for npm and Homebrew', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')

    expect(readme).toContain('brew tap k1e1n04/mav https://github.com/k1e1n04/mav.git')
    expect(readme).toContain('brew install mav')
    expect(readme).toContain('npm install -g @k1e1n04/mav')
  })

  it('checks out main before committing formula updates from the release workflow', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github/workflows/release.yml'),
      'utf8',
    )

    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('ref: main')
    expect(workflow).toContain('branch: main')
  })
})
