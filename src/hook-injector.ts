import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

export interface HookInjectionResult {
  /** Injected startup args */
  args: string[]
  /** Temp file paths to delete on agent exit */
  hookFiles: string[]
}

interface BuildHookArgsOptions {
  /** Agent working directory (for gemini-cli) */
  cwd?: string
  /** Actual command being invoked (e.g. 'claude-launcher' vs 'claude') */
  cmd?: string
  /**
   * Path to the wrapper's settings overlay file.
   * When specified for a wrapper cmd, mav reads this file before the wrapper runs,
   * merges the PostToolUse hook into it, and passes the result as --settings <tempfile>.
   * The wrapper sees --settings and skips its own overlay injection, but the temp file
   * already contains the overlay content (apiKeyHelper etc.), so auth still works.
   */
  settingsFile?: string
}

/**
 * Injects a hook into the startup args for the given agent type and returns the result.
 * Generated temp files are listed in hookFiles.
 * Call cleanupHookFiles() after the agent exits.
 */
export function buildHookArgs(
  agentType: string,
  baseArgs: string[],
  hookCommand: string,
  options: BuildHookArgsOptions = {},
): HookInjectionResult {
  switch (agentType) {
    case 'claude-code':
      return buildClaudeCodeHook(baseArgs, hookCommand, options.cmd, options.settingsFile)
    case 'gemini-cli':
      return buildGeminiHook(baseArgs, hookCommand, options.cwd)
    case 'copilot':
      return buildCopilotHook(baseArgs, hookCommand, options.cwd)
    case 'codex':
      return buildCodexHook(baseArgs, hookCommand)
    default:
      return { args: baseArgs, hookFiles: [] }
  }
}

function buildClaudeCodeHook(
  baseArgs: string[],
  hookCommand: string,
  cmd?: string,
  settingsFile?: string,
): HookInjectionResult {
  // If a custom wrapper is used (e.g. claude-launcher), skip --settings <json> injection.
  // Wrappers detect --settings in their args and skip their own overlay (including
  // apiKeyHelper), which breaks authentication.
  if (cmd != null && cmd !== 'claude') {
    if (settingsFile) {
      return buildClaudeCodeHookViaFile(baseArgs, hookCommand, settingsFile)
    }
    return { args: baseArgs, hookFiles: [] }
  }

  const claudeSettingsPath = join(homedir(), '.claude', 'settings.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(claudeSettingsPath)) {
    try {
      existing = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8')) as Record<string, unknown>
    } catch {
      // Unreadable/invalid JSON — start from empty
    }
  }

  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown[]>
  const existingPostToolUse = (existingHooks.PostToolUse ?? []) as unknown[]

  const merged = {
    ...existing,
    hooks: {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: '',
          hooks: [{ type: 'command', command: hookCommand }],
        },
      ],
    },
  }

  return {
    args: [...baseArgs, '--settings', JSON.stringify(merged)],
    hookFiles: [],
  }
}

function buildClaudeCodeHookViaFile(
  baseArgs: string[],
  hookCommand: string,
  settingsFile: string,
): HookInjectionResult {
  const expandedPath = settingsFile.replace(/^~/, homedir())

  // Read the overlay file BEFORE the wrapper starts (and potentially overwrites it).
  // The wrapper's overlay content (apiKeyHelper etc.) is preserved in the temp file,
  // so even though the wrapper skips its own overlay injection, auth still works.
  let existing: Record<string, unknown> = {}
  if (existsSync(expandedPath)) {
    try {
      existing = JSON.parse(readFileSync(expandedPath, 'utf-8')) as Record<string, unknown>
    } catch {
      // Treat as empty
    }
  }

  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown[]>
  const existingPostToolUse = (existingHooks.PostToolUse ?? []) as unknown[]

  const merged = {
    ...existing,
    hooks: {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: '',
          hooks: [{ type: 'command', command: hookCommand }],
        },
      ],
    },
  }

  // Use a deterministic name based on the settingsFile path so that at most one
  // temp file exists per overlay path — crash leftovers get overwritten next run.
  const pathHash = createHash('sha256').update(expandedPath).digest('hex').slice(0, 8)
  const tempPath = join(tmpdir(), `mav-settings-${pathHash}.json`)
  writeFileSync(tempPath, JSON.stringify(merged, null, 2))

  return {
    args: [...baseArgs, '--settings', tempPath],
    hookFiles: [tempPath],
  }
}

const MAV_MARKER = '_mavGenerated'

function buildGeminiHook(
  baseArgs: string[],
  hookCommand: string,
  cwd?: string,
): HookInjectionResult {
  const projectDir = cwd ?? process.cwd()
  const geminiDir = join(projectDir, '.gemini')
  const settingsPath = join(geminiDir, 'settings.local.json')

  // If the file exists and was NOT written by mav, skip to protect user's config
  if (existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
      if (!existing[MAV_MARKER]) {
        // User-owned file — do not overwrite
        return { args: baseArgs, hookFiles: [] }
      }
    } catch {
      // Unreadable/invalid JSON — treat as user-owned and skip
      return { args: baseArgs, hookFiles: [] }
    }
    // File was written by mav (stale from crash) — overwrite below
  }

  const settings = {
    [MAV_MARKER]: true,
    hooks: {
      AfterTool: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand }] },
      ],
    },
  }

  mkdirSync(geminiDir, { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

  return { args: baseArgs, hookFiles: [settingsPath] }
}

function buildCodexHook(baseArgs: string[], hookCommand: string): HookInjectionResult {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  mkdirSync(codexHome, { recursive: true })
  const profileName = `mav-hook-${randomUUID()}`
  const tomlPath = join(codexHome, `${profileName}.config.toml`)

  const tomlContent = [
    '[hooks.post_tool_use]',
    `cmd = ${JSON.stringify(hookCommand)}`,
    'timeout_seconds = 10',
  ].join('\n')

  writeFileSync(tomlPath, tomlContent)

  return {
    args: [...baseArgs, '--profile-v2', profileName],
    hookFiles: [tomlPath],
  }
}

function buildCopilotHook(
  baseArgs: string[],
  hookCommand: string,
  cwd?: string,
): HookInjectionResult {
  const projectDir = cwd ?? process.cwd()
  const hooksDir = join(projectDir, '.github', 'hooks')
  const hookPath = join(hooksDir, `mav-${randomUUID()}.json`)
  const hookConfig = {
    version: 1,
    hooks: {
      postToolUse: [
        {
          type: 'command',
          command: hookCommand,
        },
      ],
    },
  }

  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(hookPath, JSON.stringify(hookConfig, null, 2))

  return {
    args: baseArgs,
    hookFiles: [hookPath],
  }
}

/**
 * Deletes temp files generated by buildHookArgs.
 * Call this when the agent process exits.
 */
export function cleanupHookFiles(hookFiles: string[]): void {
  for (const f of hookFiles) {
    try {
      if (existsSync(f)) unlinkSync(f)
    } catch {
      // Ignore deletion failures (file may already be gone)
    }
  }
}
