import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'

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
