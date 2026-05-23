import { readFileSync, existsSync } from 'node:fs'
import { load as yamlLoad } from 'js-yaml'

export interface AgentConfig {
  type: string
  cmd: string
  args: string[]
}

export interface MavConfig {
  agents: AgentConfig[]
}

const DEFAULT_CMDS: Record<string, { cmd: string; args: string[] }> = {
  'claude-code': { cmd: 'claude', args: [] },
  'codex': { cmd: 'codex', args: [] },
  'gemini-cli': { cmd: 'gemini', args: [] },
  'copilot': { cmd: 'gh', args: ['copilot', 'suggest'] },
}

const DEFAULT_CONFIG: MavConfig = {
  agents: [{ type: 'claude-code', cmd: 'claude', args: [] }],
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

  const agents: AgentConfig[] = parsed.agents.map((a) => {
    const defaults = DEFAULT_CMDS[a.type] ?? { cmd: a.type, args: [] }
    return {
      type: a.type,
      cmd: a.cmd ?? defaults.cmd,
      args: a.args ?? defaults.args,
    }
  })

  return { agents }
}
