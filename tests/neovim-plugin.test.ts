import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isNeovimAvailable } from './support/neovim.js'

const repoRoot = process.cwd()
const describeNeovim = isNeovimAvailable() ? describe : describe.skip

function runNvimScript(script: string): string {
  const root = join(tmpdir(), `mav-nvim-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  const scriptPath = join(root, 'test.vim')
  writeFileSync(scriptPath, script, 'utf8')

  try {
    const result = spawnSync(
      'nvim',
      ['--headless', '-u', 'NONE', '-i', 'NONE', '-S', scriptPath],
      { encoding: 'utf8' },
    )
    return `${result.stdout}${result.stderr}`
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describeNeovim('Neovim plugin', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('MavFollowNow updates the current window cwd from current-session.json', () => {
    const root = join(tmpdir(), `mav-plugin-state-${Date.now()}`)
    const projectDir = join(root, 'project-a')
    const statePath = join(root, 'current-session.json')
    tempRoots.push(root)

    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      statePath,
      JSON.stringify({
        sessionId: 'codex#1',
        agentType: 'codex',
        displayName: 'fix auth redirect',
        cwd: projectDir,
        updatedAt: '2026-05-23T12:34:56.000Z',
      }),
      'utf8',
    )

    const output = runNvimScript(`
set rtp+=${repoRoot}
runtime plugin/mav.lua
lua << EOF
require("mav").setup({
  state_file = ${JSON.stringify(statePath)},
  auto_follow = false,
  notify_on_switch = false,
})
vim.cmd("cd " .. vim.fn.fnameescape(${JSON.stringify(root)}))
vim.cmd("MavFollowNow")
print(vim.fn.getcwd())
EOF
qa!
`)

    expect(output.trim()).toContain(projectDir)
  })

  it('MavStatus prints the selected session details', () => {
    const root = join(tmpdir(), `mav-plugin-status-${Date.now()}`)
    const projectDir = join(root, 'project-b')
    const statePath = join(root, 'current-session.json')
    tempRoots.push(root)

    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      statePath,
      JSON.stringify({
        sessionId: 'claude-code#1',
        agentType: 'claude-code',
        displayName: 'fix bug',
        cwd: projectDir,
        updatedAt: '2026-05-23T12:35:56.000Z',
      }),
      'utf8',
    )

    const output = runNvimScript(`
set rtp+=${repoRoot}
runtime plugin/mav.lua
lua << EOF
require("mav").setup({
  state_file = ${JSON.stringify(statePath)},
  auto_follow = false,
  notify_on_switch = false,
})
vim.cmd("MavStatus")
EOF
qa!
`)

    expect(output).toContain('fix bug')
    expect(output).toContain('claude-code')
    expect(output).toContain(projectDir)
  })
})
