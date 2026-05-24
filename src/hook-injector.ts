import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface RestoreFile {
  /** Temp backup of the original content */
  backupPath: string
  /** The file that was modified and needs to be restored */
  originalPath: string
}

export interface HookInjectionResult {
  /** Injected startup args */
  args: string[]
  /** Temp file paths to delete on agent exit */
  hookFiles: string[]
  /** Settings files that were modified in-place and need to be restored on exit */
  restoreFiles: RestoreFile[]
}

interface BuildHookArgsOptions {
  /** Agent working directory (for gemini-cli) */
  cwd?: string
  /** Actual command being invoked (e.g. 'claude-launcher' vs 'claude') */
  cmd?: string
  /** Path to a settings file owned by a wrapper; mav merges hook there instead of passing --settings */
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
      return { args: baseArgs, hookFiles: [], restoreFiles: [] }
  }
}

function buildClaudeCodeHook(
  baseArgs: string[],
  hookCommand: string,
  cmd?: string,
  settingsFile?: string,
): HookInjectionResult {
  // If a custom wrapper is used (e.g. claude-launcher), skip --settings injection.
  // Wrappers detect --settings in their args and skip their own overlay (including
  // apiKeyHelper), which breaks authentication.
  if (cmd != null && cmd !== 'claude') {
    if (settingsFile) {
      return buildClaudeCodeHookViaFile(baseArgs, hookCommand, settingsFile)
    }
    return { args: baseArgs, hookFiles: [], restoreFiles: [] }
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
    restoreFiles: [],
  }
}

function buildClaudeCodeHookViaFile(
  baseArgs: string[],
  hookCommand: string,
  settingsFile: string,
): HookInjectionResult {
  const expandedPath = settingsFile.replace(/^~/, homedir())

  let originalContent = '{}'
  let existing: Record<string, unknown> = {}
  if (existsSync(expandedPath)) {
    try {
      originalContent = readFileSync(expandedPath, 'utf-8')
      existing = JSON.parse(originalContent) as Record<string, unknown>
    } catch {
      // Unreadable/invalid JSON — treat as empty, preserve original bytes for restore
    }
  }

  const backupPath = join(tmpdir(), `mav-settings-backup-${randomUUID()}.json`)
  writeFileSync(backupPath, originalContent)

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

  mkdirSync(dirname(expandedPath), { recursive: true })
  writeFileSync(expandedPath, JSON.stringify(merged, null, 2))

  return {
    args: baseArgs,
    hookFiles: [],
    restoreFiles: [{ backupPath, originalPath: expandedPath }],
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
        return { args: baseArgs, hookFiles: [], restoreFiles: [] }
      }
    } catch {
      // Unreadable/invalid JSON — treat as user-owned and skip
      return { args: baseArgs, hookFiles: [], restoreFiles: [] }
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

  return { args: baseArgs, hookFiles: [settingsPath], restoreFiles: [] }
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
    restoreFiles: [],
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
    restoreFiles: [],
  }
}

/**
 * Cleans up temp files generated by buildHookArgs.
 * - hookFiles: deleted
 * - restoreFiles: original content is restored from backup, then backup is deleted
 * Call this when the agent process exits.
 */
export function cleanupHookFiles(hookFiles: string[], restoreFiles: RestoreFile[] = []): void {
  for (const f of hookFiles) {
    try {
      if (existsSync(f)) unlinkSync(f)
    } catch {
      // Ignore deletion failures (file may already be gone)
    }
  }
  for (const { backupPath, originalPath } of restoreFiles) {
    try {
      if (existsSync(backupPath)) {
        writeFileSync(originalPath, readFileSync(backupPath, 'utf-8'))
        unlinkSync(backupPath)
      }
    } catch {
      // Ignore restore failures
    }
  }
}
