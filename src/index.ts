import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig } from './config.js'
import { loadState, saveState } from './state.js'
import { SessionManager } from './session-manager.js'
import { App } from './ui/app.js'
import type { AgentSession } from './agent.js'

export interface StartOptions {
  configPath?: string
  agentType?: string
}

/** ツールごとのセッション管理方法を返す */
function resolveSessionArgs(
  type: string,
  baseArgs: string[],
  savedSessionId: string | undefined,
  hasSavedState: boolean,
): { args: string[]; newSessionId?: string } {
  switch (type) {
    case 'claude-code':
    case 'gemini-cli': {
      // --session-id で作成、--resume <uuid> で再開
      if (savedSessionId) {
        return { args: [...baseArgs, '--resume', savedSessionId] }
      }
      const id = randomUUID()
      return { args: [...baseArgs, '--session-id', id], newSessionId: id }
    }
    case 'copilot': {
      // --session-id は作成・再開の両方に使える
      const id = savedSessionId ?? randomUUID()
      return { args: [...baseArgs, '--session-id', id], newSessionId: savedSessionId ? undefined : id }
    }
    case 'codex': {
      // resume はサブコマンド。--last で最新セッションを再開する
      if (hasSavedState) {
        return { args: ['resume', '--last'] }
      }
      return { args: baseArgs }
    }
    default:
      return { args: baseArgs }
  }
}

export function start(options: StartOptions = {}): void {
  const configPath =
    options.configPath ?? join(homedir(), '.config', 'mav', 'config.yaml')
  const statePath = join(dirname(configPath), 'state.json')
  const config = loadConfig(configPath)

  const agentsToStart = options.agentType
    ? config.agents.filter((a) => a.type === options.agentType)
    : config.agents

  if (agentsToStart.length === 0) {
    console.error(
      options.agentType
        ? `No agents found for type: ${options.agentType}`
        : 'No agents found in config'
    )
    process.exit(1)
  }

  const savedState = loadState(statePath)

  const manager = new SessionManager()
  const app = new App(manager, statePath)

  const typeCounters: Record<string, number> = {}
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

    const session = manager.addSession({ ...agentConfig, args }) as AgentSession & { sessionId?: string }

    if (newSessionId != null) {
      session.sessionId = newSessionId
    }
  }

  if (savedState) {
    manager.restoreLogBuffers(savedState)
  }

  // q/Ctrl+C 以外の終了（ウィンドウ閉じ等）でも state を保存する
  const saveOnExit = () => {
    try { saveState(statePath, manager) } catch { /* ignore */ }
  }
  process.once('SIGTERM', () => { saveOnExit(); process.exit(0) })
  process.once('SIGHUP', () => { saveOnExit(); process.exit(0) })

  app.start()
}
