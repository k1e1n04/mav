import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { loadConfig } from './config.js'
import { clearCurrentSessionState, saveCurrentSessionState } from './current-session.js'
import { loadState, saveState } from './state.js'
import { SessionManager } from './session-manager.js'
import { App } from './ui/app.js'
import type { AgentSession } from './agent.js'
import { resolveSessionArgs } from './agent-launch.js'

export interface StartOptions {
  configPath?: string
  agentType?: string
}

export function start(options: StartOptions = {}): SessionManager {
  const configPath =
    options.configPath ?? join(homedir(), '.config', 'mav', 'config.yaml')
  const statePath = join(dirname(configPath), 'state.json')
  const currentSessionPath = join(homedir(), '.local', 'state', 'mav', 'current-session.json')
  const config = loadConfig(configPath)

  const agentsToStart = options.agentType
    ? config.agents.filter((a) => a.type === options.agentType)
    : config.agents

  if (agentsToStart.length === 0 && options.agentType) {
    console.error(`No agents found for type: ${options.agentType}`)
    process.exit(1)
  }

  const savedState = loadState(statePath)

  const manager = new SessionManager()
  const app = new App(manager, statePath, undefined, config.agents)
  const publishSelectedSession = () => {
    const session = manager.selectedSession
    if (!session) {
      clearCurrentSessionState(currentSessionPath)
      return
    }

    saveCurrentSessionState(currentSessionPath, {
      id: session.id,
      type: session.type,
      displayName: session.displayName,
      cwd: session.cwd,
    })
  }

  const typeCounters: Record<string, number> = {}
  const configSessionIds = new Set<string>()

  for (const agentConfig of agentsToStart) {
    typeCounters[agentConfig.type] = (typeCounters[agentConfig.type] ?? 0) + 1
    const predictedId = `${agentConfig.type}#${typeCounters[agentConfig.type]}`
    const savedSession = savedState?.sessions[predictedId]

    const { args, newSessionId } = resolveSessionArgs(
      agentConfig.type,
      agentConfig.args,
      savedSession?.sessionId,
      savedSession != null,
    )

    const restoredCwd = savedSession?.cwd
    const session = manager.addSession({
      ...agentConfig,
      args,
      ...(restoredCwd != null && { cwd: restoredCwd }),
    }) as AgentSession & { sessionId?: string }
    session.baseArgs = agentConfig.args
    configSessionIds.add(session.id)

    if (newSessionId != null) {
      session.sessionId = newSessionId
    }
  }

  // configに定義されていないが保存済みセッション（動的追加分）を再作成する
  if (savedState) {
    for (const [stateId, savedSession] of Object.entries(savedState.sessions)) {
      if (configSessionIds.has(stateId) || !savedSession.agentBase) continue

      const rc = savedSession.agentBase
      const { args, newSessionId } = resolveSessionArgs(
        rc.type,
        rc.args,
        savedSession.sessionId,
        true,
      )
      const session = manager.addSession({
        type: rc.type,
        cmd: rc.cmd,
        args,
        ...(savedSession.cwd != null && { cwd: savedSession.cwd }),
      }) as AgentSession & { sessionId?: string }
      session.baseArgs = rc.args
      if (newSessionId != null) {
        session.sessionId = newSessionId
      }
    }
  }

  if (savedState) {
    manager.restoreLogBuffers(savedState)
  }

  manager.on('exit', (sessionId: string, code: number) => {
    if (code === 0) return
    const session = manager.sessions.find((s) => s.id === sessionId)
    if (!session) return
    if (session.logBuffer.some((chunk) => chunk.includes('No conversation found with session ID'))) {
      manager.removeSession(sessionId)
    }
  })

  manager.on('selection', () => {
    publishSelectedSession()
  })

  manager.on('cwd', (sessionId: string) => {
    if (manager.selectedSession?.id !== sessionId) {
      return
    }
    publishSelectedSession()
  })

  manager.on('name', (sessionId: string) => {
    if (manager.selectedSession?.id !== sessionId) {
      return
    }
    publishSelectedSession()
  })

  publishSelectedSession()

  // q/Ctrl+C 以外の終了（ウィンドウ閉じ等）でも state を保存する
  const saveOnExit = () => {
    try { saveState(statePath, manager) } catch { /* ignore */ }
  }
  process.once('SIGTERM', () => { saveOnExit(); process.exit(0) })
  process.once('SIGHUP', () => { saveOnExit(); process.exit(0) })

  app.start()
  return manager
}
