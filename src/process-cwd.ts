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

export function getClaudeChildPid(
  shellPid: number,
  platform: NodeJS.Platform = process.platform,
): number | null {
  if (!Number.isInteger(shellPid) || shellPid <= 0) {
    return null
  }

  try {
    if (platform === 'darwin') {
      const childPids = execFileSync('pgrep', ['-P', String(shellPid)], { encoding: 'utf8' })
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)

      for (const pidStr of childPids) {
        const line = execFileSync('ps', ['-o', 'pid=,args=', '-p', pidStr], { encoding: 'utf8' }).trim()
        if (!line) continue
        const spaceIdx = line.search(/\s/)
        if (spaceIdx === -1) continue
        const args = line.slice(spaceIdx).trim()
        const binary = args.split(' ')[0] ?? ''
        if ((binary === 'node' || binary.endsWith('/node')) && args.includes('claude')) {
          return parseInt(pidStr, 10)
        }
      }
      return null
    }

    if (platform === 'linux') {
      const childPids = readFileSync(`/proc/${shellPid}/task/${shellPid}/children`, 'utf8')
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean)

      for (const pidStr of childPids) {
        const cmdline = readFileSync(`/proc/${pidStr}/cmdline`, 'utf8')
        const parts = cmdline.split('\0').filter(Boolean)
        const binary = parts[0] ?? ''
        if ((binary === 'node' || binary.endsWith('/node')) && cmdline.includes('claude')) {
          return parseInt(pidStr, 10)
        }
      }
      return null
    }
  } catch {
    return null
  }

  return null
}
