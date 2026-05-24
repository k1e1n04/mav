import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface HookInjectionResult {
  /** 注入済みの起動引数 */
  args: string[]
  /** 終了時に削除すべき一時ファイルパスのリスト */
  hookFiles: string[]
}

interface BuildHookArgsOptions {
  /** エージェントの作業ディレクトリ（gemini-cli用） */
  cwd?: string
}

/**
 * エージェント種別に応じてhookを起動引数に注入し、結果を返す。
 * 生成した一時ファイルは hookFiles に含まれる。
 * エージェント終了後に cleanupHookFiles() を呼ぶこと。
 */
export function buildHookArgs(
  agentType: string,
  baseArgs: string[],
  hookCommand: string,
  options: BuildHookArgsOptions = {},
): HookInjectionResult {
  switch (agentType) {
    case 'claude-code':
      return buildClaudeCodeHook(baseArgs, hookCommand)
    case 'gemini-cli':
      return buildGeminiHook(baseArgs, hookCommand, options.cwd)
    case 'codex':
      return buildCodexHook(baseArgs, hookCommand)
    default:
      return { args: baseArgs, hookFiles: [] }
  }
}

function buildClaudeCodeHook(baseArgs: string[], hookCommand: string): HookInjectionResult {
  const settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: hookCommand }],
        },
      ],
    },
  }
  return {
    args: [...baseArgs, '--settings', JSON.stringify(settings)],
    hookFiles: [],
  }
}

function buildGeminiHook(
  baseArgs: string[],
  hookCommand: string,
  cwd?: string,
): HookInjectionResult {
  const projectDir = cwd ?? process.cwd()
  const geminiDir = join(projectDir, '.gemini')
  const settingsPath = join(geminiDir, 'settings.local.json')

  const settings = {
    hooks: {
      AfterTool: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: hookCommand }],
        },
      ],
    },
  }

  if (!existsSync(geminiDir)) {
    mkdirSync(geminiDir, { recursive: true })
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

  return { args: baseArgs, hookFiles: [settingsPath] }
}

function buildCodexHook(baseArgs: string[], hookCommand: string): HookInjectionResult {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  if (!existsSync(codexHome)) {
    mkdirSync(codexHome, { recursive: true })
  }
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

/**
 * buildHookArgs で生成した一時ファイルを削除する。
 * エージェントプロセス終了時に呼ぶこと。
 */
export function cleanupHookFiles(hookFiles: string[]): void {
  for (const f of hookFiles) {
    try {
      if (existsSync(f)) unlinkSync(f)
    } catch {
      // 削除失敗は無視する（既に消えている場合など）
    }
  }
}
