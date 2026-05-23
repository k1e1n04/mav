import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

type SpawnLike = (command: string, args: string[], options: { encoding: 'utf8' }) => Pick<
  SpawnSyncReturns<string>,
  'error' | 'status'
>

export function isNeovimAvailable(run: SpawnLike = spawnSync): boolean {
  const result = run('nvim', ['--version'], { encoding: 'utf8' })
  if (!result.error) {
    return result.status === 0
  }

  const error = result.error as NodeJS.ErrnoException
  if (error.code === 'ENOENT') {
    return false
  }

  throw result.error
}
