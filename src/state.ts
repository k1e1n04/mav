import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionManager } from './session-manager.js'
import type { SessionStatus } from './agent.js'

export interface SessionState {
  logBuffer: string[]
  status: SessionStatus
  sessionId?: string
  displayName?: string
  cwd?: string
  /** configに定義されていない動的セッションを再起動時に復元するための情報 */
  agentBase?: {
    type: string
    cmd: string
    args: string[]
  }
}

export interface MavState {
  sessions: Record<string, SessionState>
}

export function saveState(path: string, manager: SessionManager): void {
  const state: MavState = { sessions: {} }
  for (const session of manager.sessions) {
    state.sessions[session.id] = {
      logBuffer: [...session.logBuffer],
      status: session.status,
      ...(session.sessionId != null && { sessionId: session.sessionId }),
      displayName: session.displayName,
      cwd: session.cwd,
      agentBase: {
        type: session.type,
        cmd: session.cmd,
        args: [...session.baseArgs],
      },
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state), 'utf-8')
}

export function loadState(path: string): MavState | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as MavState
  } catch {
    return null
  }
}
