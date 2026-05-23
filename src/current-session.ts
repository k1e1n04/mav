import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CurrentSessionSnapshot {
  id: string
  type: string
  displayName: string
  cwd: string
}

export interface CurrentSessionState {
  sessionId: string
  agentType: string
  displayName: string
  cwd: string
  updatedAt: string
}

export function saveCurrentSessionState(path: string, session: CurrentSessionSnapshot): void {
  const state: CurrentSessionState = {
    sessionId: session.id,
    agentType: session.type,
    displayName: session.displayName,
    cwd: session.cwd,
    updatedAt: new Date().toISOString(),
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state), 'utf-8')
}

export function clearCurrentSessionState(path: string): void {
  rmSync(path, { force: true })
}
