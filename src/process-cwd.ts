import { execFileSync } from 'node:child_process'
import { readlinkSync, readFileSync } from 'node:fs'

export function getProcessCwd(pid: number, platform: NodeJS.Platform = process.platform): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }

  try {
    if (platform === 'linux') {
      return readlinkSync(`/proc/${pid}/cwd`)
    }

    if (platform === 'darwin') {
      const output = execFileSync(
        'lsof',
        ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'],
        { encoding: 'utf8' },
      )
      const cwdLine = output
        .split('\n')
        .find((line) => line.startsWith('n/') || line === 'n/')

      return cwdLine ? cwdLine.slice(1) : null
    }
  } catch {
    return null
  }

  return null
}

const CLAUDE_CHILD_MAX_DEPTH = 5

export function getClaudeChildPid(
  shellPid: number,
  platform: NodeJS.Platform = process.platform,
): number | null {
  if (!Number.isInteger(shellPid) || shellPid <= 0) {
    return null
  }

  if (platform === 'darwin') {
    return findClaudeChildDarwin(shellPid)
  }

  if (platform === 'linux') {
    return findClaudeChildLinux(shellPid)
  }

  return null
}

function findClaudeChildDarwin(shellPid: number): number | null {
  let initialChildren: string[]
  try {
    initialChildren = execFileSync('pgrep', ['-P', String(shellPid)], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return null
  }

  const queue: Array<{ pidStr: string; depth: number }> = initialChildren.map((p) => ({ pidStr: p, depth: 0 }))

  while (queue.length > 0) {
    const item = queue.shift()!
    if (item.depth >= CLAUDE_CHILD_MAX_DEPTH) continue

    try {
      const line = execFileSync('ps', ['-o', 'pid=,args=', '-p', item.pidStr], { encoding: 'utf8' }).trim()
      if (line) {
        const spaceIdx = line.search(/\s/)
        if (spaceIdx !== -1) {
          const args = line.slice(spaceIdx).trim()
          const binary = args.split(' ')[0] ?? ''
          if ((binary === 'node' || binary.endsWith('/node')) && args.includes('claude')) {
            return parseInt(item.pidStr, 10)
          }
        }
      }
    } catch {
      continue
    }

    // Not claude — enqueue children for next level
    try {
      const children = execFileSync('pgrep', ['-P', item.pidStr], { encoding: 'utf8' })
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const child of children) {
        queue.push({ pidStr: child, depth: item.depth + 1 })
      }
    } catch {
      // No children — continue
    }
  }

  return null
}

function findClaudeChildLinux(shellPid: number): number | null {
  let initialChildren: string[]
  try {
    initialChildren = readFileSync(`/proc/${shellPid}/task/${shellPid}/children`, 'utf8')
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return null
  }

  const queue: Array<{ pidStr: string; depth: number }> = initialChildren.map((p) => ({ pidStr: p, depth: 0 }))

  while (queue.length > 0) {
    const item = queue.shift()!
    if (item.depth >= CLAUDE_CHILD_MAX_DEPTH) continue

    try {
      const cmdline = readFileSync(`/proc/${item.pidStr}/cmdline`, 'utf8')
      const parts = cmdline.split('\0').filter(Boolean)
      const binary = parts[0] ?? ''
      if ((binary === 'node' || binary.endsWith('/node')) && cmdline.includes('claude')) {
        return parseInt(item.pidStr, 10)
      }
    } catch {
      continue
    }

    // Not claude — enqueue children for next level
    try {
      const children = readFileSync(`/proc/${item.pidStr}/task/${item.pidStr}/children`, 'utf8')
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const child of children) {
        queue.push({ pidStr: child, depth: item.depth + 1 })
      }
    } catch {
      // No children — continue
    }
  }

  return null
}
