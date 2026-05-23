import { randomUUID } from 'node:crypto'

export const DEFAULT_CMDS: Record<string, { cmd: string; args: string[]; resumeArgs?: string[] }> = {
  'claude-code': { cmd: 'claude', args: [] },
  'codex': { cmd: 'codex', args: [] },
  'gemini-cli': { cmd: 'gemini', args: [] },
  'copilot': { cmd: 'copilot', args: [] },
}

export function getAgentDefaults(type: string): { cmd: string; args: string[]; resumeArgs?: string[] } {
  return DEFAULT_CMDS[type] ?? { cmd: type, args: [] }
}

/** ツールごとのセッション管理方法を返す */
export function resolveSessionArgs(
  type: string,
  baseArgs: string[],
  savedSessionId: string | undefined,
  hasSavedState: boolean,
): { args: string[]; newSessionId?: string } {
  switch (type) {
    case 'claude-code':
    case 'gemini-cli': {
      if (savedSessionId) {
        return { args: [...baseArgs, '--resume', savedSessionId] }
      }
      const id = randomUUID()
      return { args: [...baseArgs, '--session-id', id], newSessionId: id }
    }
    case 'copilot': {
      const id = savedSessionId ?? randomUUID()
      return { args: [...baseArgs, '--session-id', id], newSessionId: savedSessionId ? undefined : id }
    }
    case 'codex': {
      if (hasSavedState) {
        return { args: ['resume', '--last'] }
      }
      return { args: baseArgs }
    }
    default:
      return { args: baseArgs }
  }
}
