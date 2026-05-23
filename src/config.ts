import { readFileSync, existsSync } from 'node:fs'
import { load as yamlLoad } from 'js-yaml'

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

const DEFAULT_CMDS: Record<string, { cmd: string; args: string[]; resumeArgs?: string[] }> = {
  'claude-code': { cmd: 'claude', args: [] },
  'codex': { cmd: 'codex', args: [] },
  'gemini-cli': { cmd: 'gemini', args: [] },
  'copilot': { cmd: 'copilot', args: [] },
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

  const agents: AgentConfig[] = parsed.agents
    .filter((a): a is { type: string; cmd?: string; args?: string[]; resumeArgs?: string[] } =>
      typeof a?.type === 'string' && a.type.length > 0
    )
    .map((a) => {
      const defaults = DEFAULT_CMDS[a.type] ?? { cmd: a.type, args: [] }
      return {
        type: a.type,
        cmd: a.cmd ?? defaults.cmd,
        args: Array.isArray(a.args) ? a.args : defaults.args,
        resumeArgs: Array.isArray(a.resumeArgs) ? a.resumeArgs : defaults.resumeArgs,
      }
    })

  return { agents }
}
