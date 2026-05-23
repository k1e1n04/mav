import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { SessionManager } from './session-manager.js'
import { App } from './ui/app.js'

export interface StartOptions {
  configPath?: string
  agentType?: string
}

export function start(options: StartOptions = {}): void {
  const configPath =
    options.configPath ?? join(homedir(), '.config', 'mav', 'config.yaml')
  const config = loadConfig(configPath)

  const agentsToStart = options.agentType
    ? config.agents.filter((a) => a.type === options.agentType)
    : config.agents

  if (agentsToStart.length === 0) {
    console.error(`No agents found for type: ${options.agentType}`)
    process.exit(1)
  }

  const manager = new SessionManager()
  const app = new App(manager)

  for (const agentConfig of agentsToStart) {
    manager.addSession(agentConfig)
  }

  app.start()
}
