import { readFileSync, existsSync } from 'node:fs'
import { load as yamlLoad } from 'js-yaml'
import { getAgentDefaults } from './agent-launch.js'

export interface AgentConfig {
  type: string
  cmd: string
  args: string[]
  cwd?: string
  resumeArgs?: string[]
}

export interface MavConfig {
  agents: AgentConfig[]
}

const DEFAULT_CONFIG: MavConfig = {
  agents: [],
}

export function loadConfig(configPath: string): MavConfig {
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  const raw = readFileSync(configPath, 'utf-8')
  const parsed = yamlLoad(raw) as { agents?: Array<{ type: string; cmd?: string; args?: string[] }> }

  if (!parsed?.agents || !Array.isArray(parsed.agents)) {
    return DEFAULT_CONFIG
  }

  const agents: AgentConfig[] = parsed.agents
    .filter((a): a is { type: string; cmd?: string; args?: string[]; cwd?: string; resumeArgs?: string[] } =>
      typeof a?.type === 'string' && a.type.length > 0
    )
    .map((a) => {
      const defaults = getAgentDefaults(a.type)
      const cmd = typeof a.cmd === 'string' && a.cmd.trim().length > 0
        ? a.cmd
        : defaults.cmd
      const cwd = typeof a.cwd === 'string' && a.cwd.trim().length > 0
        ? a.cwd.replace(/^~/, process.env.HOME ?? '~')
        : undefined
      return {
        type: a.type,
        cmd,
        args: Array.isArray(a.args) ? a.args : defaults.args,
        cwd,
        resumeArgs: Array.isArray(a.resumeArgs) ? a.resumeArgs : defaults.resumeArgs,
      }
    })

  return { agents }
}
