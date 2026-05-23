#!/usr/bin/env node
// Rebuild node-pty's native binary if it wasn't built during install.
// pnpm v9+ blocks transitive dependency install scripts by default, so
// we trigger the build here from the package's own postinstall.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function isPtyBuilt() {
  try {
    require('node-pty')
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Only attempt rebuild when the native binary is missing.
    return !msg.includes('pty.node')
  }
}

if (!isPtyBuilt()) {
  let ptyDir = null
  try {
    ptyDir = dirname(require.resolve('node-pty/package.json'))
  } catch {
    // node-pty not resolvable — nothing to do
  }

  if (ptyDir && existsSync(ptyDir)) {
    process.stdout.write('[mav] Building node-pty native module...\n')
    try {
      execSync('node-gyp rebuild', { cwd: ptyDir, stdio: 'inherit' })
      process.stdout.write('[mav] node-pty built successfully.\n')
    } catch {
      process.stderr.write('[mav] Warning: Could not build node-pty automatically.\n')
      process.stderr.write('[mav] To fix manually: pnpm rebuild node-pty --global\n')
      process.stderr.write('[mav] Requires build tools: https://github.com/nodejs/node-gyp#installation\n')
    }
  }
}
