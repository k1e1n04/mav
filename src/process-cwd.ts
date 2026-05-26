import { execFile } from 'node:child_process'
import { readlink, readFile } from 'node:fs/promises'

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout as string)
    })
  })
}

export async function getProcessCwd(pid: number, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }

  try {
    if (platform === 'linux') {
      return await readlink(`/proc/${pid}/cwd`)
    }

    if (platform === 'darwin') {
      const output = await runCommand('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'])
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

export async function getClaudeChildPid(
  shellPid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<number | null> {
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

async function findClaudeChildDarwin(shellPid: number): Promise<number | null> {
  let initialChildren: string[]
  try {
    const output = await runCommand('pgrep', ['-P', String(shellPid)])
    initialChildren = output
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
      const line = await runCommand('ps', ['-o', 'pid=,args=', '-p', item.pidStr])
      const trimmed = line.trim()
      if (trimmed) {
        const spaceIdx = trimmed.search(/\s/)
        if (spaceIdx !== -1) {
          const args = trimmed.slice(spaceIdx).trim()
          const binary = args.split(' ')[0] ?? ''
          if (
            ((binary === 'node' || binary.endsWith('/node')) && args.includes('claude')) ||
            binary === 'claude' || binary.endsWith('/claude')
          ) {
            return parseInt(item.pidStr, 10)
          }
        }
      }
    } catch {
      continue
    }

    // Not claude — enqueue children for next level
    try {
      const childOutput = await runCommand('pgrep', ['-P', item.pidStr])
      const children = childOutput
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

async function findClaudeChildLinux(shellPid: number): Promise<number | null> {
  let initialChildren: string[]
  try {
    const content = await readFile(`/proc/${shellPid}/task/${shellPid}/children`, 'utf8')
    initialChildren = content
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
      const cmdline = await readFile(`/proc/${item.pidStr}/cmdline`, 'utf8')
      const parts = cmdline.split('\0').filter(Boolean)
      const binary = parts[0] ?? ''
      if (
        ((binary === 'node' || binary.endsWith('/node')) && cmdline.includes('claude')) ||
        binary === 'claude' || binary.endsWith('/claude')
      ) {
        return parseInt(item.pidStr, 10)
      }
    } catch {
      continue
    }

    // Not claude — enqueue children for next level
    try {
      const content = await readFile(`/proc/${item.pidStr}/task/${item.pidStr}/children`, 'utf8')
      const children = content
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
