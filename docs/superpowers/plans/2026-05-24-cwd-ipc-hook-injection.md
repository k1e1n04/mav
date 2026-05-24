# CWD IPC & Hook Auto-Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント（claude-code, gemini-cli, codex）がワークツリー等でcwdを変更したとき、mav が自動でそれを検知できるようにする。Unix socket IPC + エージェント別hook自動注入で実現する。

**Architecture:**
- mav起動時に Unix socket (`/tmp/mav-<pid>.sock`) を立てて `MAV_SOCKET` / `MAV_SESSION_ID` 環境変数でエージェントに通知する。
- エージェント種別ごとに hook注入アダプターを用意し、起動引数に自動でhookを追加する。
- hookが発火すると `mav report cwd "$(pwd)"` を呼び出し、socket経由で mav の SessionManager が cwd を更新する。
- Copilot は PostToolUse 相当の hook がないため、既存のlsofポーリングのみ対応（README に記載）。

**Tech Stack:** TypeScript / Node.js ESM, `node:net` (Unix socket), `commander` (CLI)

---

## File Structure

```
src/
  ipc-server.ts       (新規) Unix socketサーバー + メッセージ処理
  hook-injector.ts    (新規) エージェント種別ごとのhook注入ロジック
  agent.ts            (変更) 起動時に MAV_SOCKET / MAV_SESSION_ID を env 注入
  index.ts            (変更) IPC サーバー起動 + agent.ts へのソケットパス伝達
bin/
  mav.ts              (変更) `mav report cwd <path>` サブコマンド追加
tests/
  ipc-server.test.ts  (新規) ソケットサーバーのユニットテスト
  hook-injector.test.ts (新規) 各アダプターの出力検証テスト
```

---

### Task 1: IPC サーバー（`src/ipc-server.ts`）

**Files:**
- Create: `src/ipc-server.ts`
- Create: `tests/ipc-server.test.ts`

#### メッセージプロトコル設計

socketに届くJSONメッセージ（1行 = 1メッセージ、改行区切り）:

```json
{"type": "cwd", "sessionId": "claude-code#1", "path": "/new/worktree"}
```

- [ ] **Step 1: 失敗するテストを書く**

`tests/ipc-server.test.ts` を作成する:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, IpcServer } from '../src/ipc-server.js'
import { connect, Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('IpcServer', () => {
  const socketPath = join(tmpdir(), `mav-test-${process.pid}.sock`)
  let server: IpcServer

  beforeEach(() => {
    if (existsSync(socketPath)) unlinkSync(socketPath)
    server = createServer(socketPath)
  })

  afterEach(() => {
    server.close()
    if (existsSync(socketPath)) unlinkSync(socketPath)
  })

  it('socketファイルを作成してlistenする', async () => {
    await server.listen()
    expect(existsSync(socketPath)).toBe(true)
  })

  it('cwd メッセージを受信してハンドラーを呼ぶ', async () => {
    const received: Array<{ type: string; sessionId: string; path: string }> = []
    server.onMessage((msg) => received.push(msg))
    await server.listen()

    await new Promise<void>((resolve, reject) => {
      const client: Socket = connect(socketPath, () => {
        client.write(JSON.stringify({ type: 'cwd', sessionId: 'claude-code#1', path: '/new' }) + '\n')
        setTimeout(() => { client.destroy(); resolve() }, 50)
      })
      client.on('error', reject)
    })

    await new Promise((r) => setTimeout(r, 100))
    expect(received).toEqual([{ type: 'cwd', sessionId: 'claude-code#1', path: '/new' }])
  })

  it('不正なJSONは無視する', async () => {
    const received: unknown[] = []
    server.onMessage((msg) => received.push(msg))
    await server.listen()

    await new Promise<void>((resolve, reject) => {
      const client: Socket = connect(socketPath, () => {
        client.write('not-json\n')
        setTimeout(() => { client.destroy(); resolve() }, 50)
      })
      client.on('error', reject)
    })

    await new Promise((r) => setTimeout(r, 100))
    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd /Users/ishiiken/Develop/multi-agent-view
pnpm test -- tests/ipc-server.test.ts 2>&1 | tail -5
```

期待: `Cannot find module '../src/ipc-server.js'` などのエラー

- [ ] **Step 3: `src/ipc-server.ts` を実装する**

```typescript
import { createServer as netCreateServer, Server, Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'

export interface IpcMessage {
  type: string
  sessionId: string
  path: string
}

type MessageHandler = (msg: IpcMessage) => void

export interface IpcServer {
  listen(): Promise<void>
  onMessage(handler: MessageHandler): void
  close(): void
}

export function createServer(socketPath: string): IpcServer {
  const handlers: MessageHandler[] = []
  let server: Server | null = null

  return {
    onMessage(handler) {
      handlers.push(handler)
    },

    listen() {
      return new Promise((resolve, reject) => {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath)
        }

        server = netCreateServer((socket: Socket) => {
          let buf = ''
          socket.on('data', (chunk) => {
            buf += chunk.toString()
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const msg = JSON.parse(line) as IpcMessage
                if (msg.type && msg.sessionId) {
                  handlers.forEach((h) => h(msg))
                }
              } catch {
                // 不正なJSONは無視する
              }
            }
          })
        })

        server.once('error', reject)
        server.listen(socketPath, () => resolve())
      })
    },

    close() {
      server?.close()
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath) } catch { /* ignore */ }
      }
    },
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
pnpm test -- tests/ipc-server.test.ts 2>&1 | tail -10
```

期待: `3 passed`

- [ ] **Step 5: コミット**

```bash
git add src/ipc-server.ts tests/ipc-server.test.ts
git commit -m "feat(ipc): add Unix socket IPC server"
```

---

### Task 2: Hook注入アダプター（`src/hook-injector.ts`）

各エージェントの起動引数にhookを自動追加し、必要なら一時ファイルも生成する。

**Files:**
- Create: `src/hook-injector.ts`
- Create: `tests/hook-injector.test.ts`

#### 各エージェントの注入方法

| エージェント | 注入方法 |
|---|---|
| `claude-code` | `args` に `--settings '{"hooks":{"PostToolUse":[...]}}'` を追加 |
| `gemini-cli` | プロジェクト `.gemini/settings.local.json` を生成、終了時に削除 |
| `codex` | 一時TOMLファイルを `$CODEX_HOME/<uuid>.config.toml` に書き、`--profile-v2 <uuid>` を追加 |
| `copilot` | 何もしない（lsofポーリングのみ） |

hook コマンドのテンプレート（全エージェント共通）:
```
mav report cwd "$(pwd)"
```

- [ ] **Step 1: 失敗するテストを書く**

`tests/hook-injector.test.ts` を作成する:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const { buildHookArgs, buildHookEnv, cleanupHookFiles } = await import('../src/hook-injector.js')

describe('hook-injector: claude-code', () => {
  it('PostToolUse hook を --settings 引数に追加する', () => {
    const { args } = buildHookArgs('claude-code', [], 'mav report cwd "$(pwd)"')
    const settingsArg = args.find((a) => a.startsWith('--settings'))
    expect(settingsArg).toBeDefined()
    const json = JSON.parse(args[args.indexOf('--settings') + 1])
    expect(json.hooks.PostToolUse[0].hooks[0].command).toBe('mav report cwd "$(pwd)"')
  })

  it('既存のargs を保持する', () => {
    const { args } = buildHookArgs('claude-code', ['--model', 'opus'], 'mav report cwd "$(pwd)"')
    expect(args).toContain('--model')
    expect(args).toContain('opus')
  })
})

describe('hook-injector: gemini-cli', () => {
  it('settings.local.json を書く候補パスを返す', () => {
    const cwd = '/tmp/test-project'
    const { hookFiles } = buildHookArgs('gemini-cli', [], 'mav report cwd "$(pwd)"', { cwd })
    expect(hookFiles).toHaveLength(1)
    expect(hookFiles[0]).toBe(join(cwd, '.gemini', 'settings.local.json'))
  })
})

describe('hook-injector: codex', () => {
  it('--profile-v2 引数を追加する', () => {
    const { args } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(args).toContain('--profile-v2')
  })

  it('hookFiles にTOMLファイルパスが含まれる', () => {
    const { hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(hookFiles[0]).toMatch(/\.config\.toml$/)
    expect(existsSync(hookFiles[0])).toBe(true)
    const content = readFileSync(hookFiles[0], 'utf-8')
    expect(content).toContain('post_tool_use')
    expect(content).toContain('mav report cwd')
  })

  afterEach(() => {
    // TOMLファイルのクリーンアップはcleanupHookFilesで行う
  })
})

describe('hook-injector: copilot', () => {
  it('argsを変更しない', () => {
    const original = ['--allow-all']
    const { args } = buildHookArgs('copilot', original, 'mav report cwd "$(pwd)"')
    expect(args).toEqual(original)
  })
})

describe('cleanupHookFiles', () => {
  it('hookFilesを削除する', async () => {
    const { hookFiles } = buildHookArgs('codex', [], 'mav report cwd "$(pwd)"')
    expect(existsSync(hookFiles[0])).toBe(true)
    cleanupHookFiles(hookFiles)
    expect(existsSync(hookFiles[0])).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm test -- tests/hook-injector.test.ts 2>&1 | tail -5
```

期待: `Cannot find module '../src/hook-injector.js'` などのエラー

- [ ] **Step 3: `src/hook-injector.ts` を実装する**

```typescript
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
  /** エージェントの作業ディレクトリ（gemini-li用） */
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
  // cwdが未指定の場合はprocess.cwd()を使う（実際のcwdはagent起動後に決まる）
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
  const profileName = `mav-hook-${randomUUID()}`
  const tomlPath = join(codexHome, `${profileName}.config.toml`)

  // Codex config.toml の [hooks] セクション形式
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
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
pnpm test -- tests/hook-injector.test.ts 2>&1 | tail -10
```

期待: `8 passed`（失敗するテストがあれば実装を修正する）

- [ ] **Step 5: Codexの実際のhook TOML形式を確認・修正する**

Codexの実際のconfig.toml形式がわかったら、`buildCodexHook()` の `tomlContent` を修正する。
現時点では推測形式のため、実際に `codex -c` で試してから修正すること:

```bash
codex -c 'hooks.post_tool_use=[{cmd="echo test", timeout_seconds=10}]' --help 2>&1 | head -5
```

エラーが出た場合はCodexの公式ドキュメントか `codex doctor` で正しい形式を確認し、`tomlContent` を修正する。

- [ ] **Step 6: コミット**

```bash
git add src/hook-injector.ts tests/hook-injector.test.ts
git commit -m "feat(ipc): add per-agent hook injection adapters"
```

---

### Task 3: `mav report cwd` サブコマンド（`bin/mav.ts`）

エージェントのhookから呼ばれるコマンド。socket経由でmavにcwdを通知する。

**Files:**
- Modify: `bin/mav.ts`
- Modify: `tests/` (新規テスト不要、手動確認でOK)

- [ ] **Step 1: `bin/mav.ts` に `report` サブコマンドを追加する**

`bin/mav.ts` を開いて、`program.parse()` の前に以下を追加する:

```typescript
import { connect } from 'node:net'

// ...（既存のimportと program 定義の後に追加）

const report = program.command('report')
  .description('Report runtime state back to the mav TUI process')

report
  .command('cwd <path>')
  .description('Report current working directory change to mav')
  .action((path: string) => {
    const socketPath = process.env.MAV_SOCKET
    const sessionId = process.env.MAV_SESSION_ID

    if (!socketPath || !sessionId) {
      // mav外から呼ばれた場合は何もせず正常終了
      process.exit(0)
    }

    const msg = JSON.stringify({ type: 'cwd', sessionId, path }) + '\n'
    const client = connect(socketPath, () => {
      client.write(msg, () => {
        client.destroy()
        process.exit(0)
      })
    })
    client.on('error', () => {
      // 接続失敗は無視（mavが既に終了している場合など）
      process.exit(0)
    })
    // 接続タイムアウト: 3秒で強制終了
    setTimeout(() => process.exit(0), 3000).unref()
  })
```

- [ ] **Step 2: `report` コマンドが動作することを手動確認する**

まず一時socketでサーバーを立てて、`mav report cwd` を試す:

```bash
# terminal 1: 一時サーバーを立てる
node -e "
const net = require('net');
const s = net.createServer(c => {
  c.on('data', d => console.log('received:', d.toString()))
});
s.listen('/tmp/mav-test.sock', () => console.log('listening'));
"

# terminal 2: mav report を試す
MAV_SOCKET=/tmp/mav-test.sock MAV_SESSION_ID=claude-code#1 pnpm dev report cwd /new/worktree
```

期待: terminal 1 に `received: {"type":"cwd","sessionId":"claude-code#1","path":"/new/worktree"}` が表示される

- [ ] **Step 3: コミット**

```bash
git add bin/mav.ts
git commit -m "feat(cli): add 'mav report cwd' subcommand for IPC"
```

---

### Task 4: `src/agent.ts` に env 注入と hook ファイルクリーンアップを追加

**Files:**
- Modify: `src/agent.ts`
- Modify: `tests/agent.test.ts`

AgentSession が socket パスと session ID を env に注入し、終了時に hook ファイルを削除する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/agent.test.ts` に以下のテストを追加する（既存の `describe('AgentSession')` ブロック内に追記）:

```typescript
it('MAV_SOCKET と MAV_SESSION_ID を env に注入する', () => {
  const spawnMock = vi.mocked((nodePty as unknown as { spawn: ReturnType<typeof vi.fn> }).spawn)
  spawnMock.mockClear()

  new AgentSession(
    { type: 'claude-code', cmd: 'claude', args: [] },
    80, 24,
    { socketPath: '/tmp/mav-test.sock', hookFiles: [] }
  )

  const spawnCall = spawnMock.mock.calls[0]
  const env = spawnCall?.[2]?.env as Record<string, string>
  expect(env.MAV_SOCKET).toBe('/tmp/mav-test.sock')
  expect(env.MAV_SESSION_ID).toMatch(/^claude-code#\d+$/)
})

it('args に hook が注入済みの引数を使う', () => {
  const spawnMock = vi.mocked((nodePty as unknown as { spawn: ReturnType<typeof vi.fn> }).spawn)
  spawnMock.mockClear()

  new AgentSession(
    { type: 'claude-code', cmd: 'claude', args: ['--settings', '{"hooks":{}}'] },
    80, 24,
    { socketPath: '/tmp/mav-test.sock', hookFiles: [] }
  )

  const spawnCall = spawnMock.mock.calls[0]
  expect(spawnCall?.[1]).toContain('--settings')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm test -- tests/agent.test.ts 2>&1 | tail -10
```

期待: 新しく追加したテストが失敗する

- [ ] **Step 3: `src/agent.ts` を修正する**

`AgentSession` のコンストラクタ引数に `IpcContext` を追加し、env 注入とhookファイルクリーンアップを実装する:

```typescript
// src/agent.ts の先頭 import 部分に追加
import { cleanupHookFiles } from './hook-injector.js'

// IpcContext の型定義（コンストラクタの引数として追加）
export interface IpcContext {
  socketPath: string
  hookFiles: string[]
}

// AgentSession クラスの private フィールドに追加
private hookFiles: string[] = []

// コンストラクタのシグネチャを変更
constructor(config: AgentConfig, cols: number, rows: number, ipcContext?: IpcContext) {
  super()
  // ... 既存のコード ...

  // IPC 環境変数を env に注入する
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  if (ipcContext) {
    env.MAV_SOCKET = ipcContext.socketPath
    env.MAV_SESSION_ID = this.id
    this.hookFiles = ipcContext.hookFiles
  }

  // pty.spawn の env を差し替える
  proc = pty.spawn(config.cmd, config.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: this.cwd,
    env,  // ← process.env から env に変更
  })

  // onExit でクリーンアップ
  this.ptyProcess.onExit(({ exitCode }) => {
    this.clearIdleTimer()
    this.clearCwdPollTimer()
    cleanupHookFiles(this.hookFiles)  // ← 追加
    this.setStatus(exitCode === 0 ? 'done' : 'error')
    this.exited = true
    this.ptyProcess = undefined
    this.emit('exit', exitCode)
  })
}
```

**注意**: 既存の `env: process.env as Record<string, string>` を上記の `env` 変数に置き換えること。

- [ ] **Step 4: 既存テストが全て通ることを確認する**

```bash
pnpm test -- tests/agent.test.ts 2>&1 | tail -10
```

期待: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/agent.ts tests/agent.test.ts
git commit -m "feat(agent): inject MAV_SOCKET/MAV_SESSION_ID env and cleanup hook files on exit"
```

---

### Task 5: `src/index.ts` で IPC サーバー起動と hook 注入を組み合わせる

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

mav起動時に IPC サーバーを立て、`manager.addSession()` 呼び出し前に hook を注入する。

- [ ] **Step 1: 既存の `tests/index.test.ts` を確認する**

```bash
cat tests/index.test.ts | head -50
```

どんなモックが使われているかを確認してから次のステップへ進む。

- [ ] **Step 2: `src/index.ts` を修正する**

`src/index.ts` の先頭 import に追加:

```typescript
import { createServer } from './ipc-server.js'
import { buildHookArgs } from './hook-injector.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

`start()` 関数内、`const manager = new SessionManager()` の直前に追加:

```typescript
// IPC サーバーをセットアップする
const socketPath = join(tmpdir(), `mav-${process.pid}.sock`)
const ipcServer = createServer(socketPath)
await ipcServer.listen()

ipcServer.onMessage((msg) => {
  if (msg.type === 'cwd') {
    const session = manager.sessions.find((s) => s.id === msg.sessionId)
    if (session) {
      // AgentSession.updateCwd は private なので、cwd プロパティを直接更新して emit する
      // （Task 6 で AgentSession に public メソッドを追加する）
      session.notifyCwd(msg.path)
    }
  }
})

// プロセス終了時に socket を閉じる
const cleanupIpc = () => { ipcServer.close() }
process.once('SIGTERM', cleanupIpc)
process.once('SIGHUP', cleanupIpc)
```

各エージェント起動部分（`manager.addSession` の前）に hook 注入を追加:

```typescript
// 既存の const session = manager.addSession({...}) を以下に変更する
const hookCmd = `mav report cwd "$(pwd)"`
const { args: hookedArgs, hookFiles } = buildHookArgs(
  agentConfig.type,
  args,  // resolveSessionArgs から得た args
  hookCmd,
  { cwd: restoredCwd },
)

const session = manager.addSession(
  { ...agentConfig, args: hookedArgs, ...(restoredCwd != null && { cwd: restoredCwd }) },
  { socketPath, hookFiles },  // IpcContext
) as AgentSession & { sessionId?: string }
```

- [ ] **Step 3: `src/session-manager.ts` の `addSession` シグネチャを確認・更新する**

```bash
cat src/session-manager.ts | grep -A5 "addSession"
```

`addSession` に `IpcContext` を第2引数として渡せるよう更新:

```typescript
// session-manager.ts の addSession
addSession(config: AgentConfig, ipcContext?: IpcContext): AgentSession {
  const { cols, rows } = this.terminal.getSize()
  const session = new AgentSession(config, cols, rows, ipcContext)
  // ... 既存のコード ...
}
```

- [ ] **Step 4: AgentSession に `notifyCwd` メソッドを追加する（`src/agent.ts`）**

```typescript
// src/agent.ts の AgentSession クラスに追加
/** IPC経由でcwd変更を通知する（外部からcwdを更新する） */
notifyCwd(newCwd: string): void {
  this.updateCwd(newCwd)
}
```

- [ ] **Step 5: 全テストが通ることを確認する**

```bash
pnpm test 2>&1 | tail -15
```

期待: 全テスト PASS

- [ ] **Step 6: コミット**

```bash
git add src/index.ts src/session-manager.ts src/agent.ts
git commit -m "feat(index): start IPC server and inject hooks on agent launch"
```

---

### Task 6: 動作確認（手動テスト）

**Files:** なし（確認のみ）

- [ ] **Step 1: mav をビルドする**

```bash
pnpm build 2>&1 | tail -5
```

期待: エラーなし

- [ ] **Step 2: claude-code で worktree を使い cwd が更新されるか確認する**

```bash
pnpm dev
```

Overviewを開いた状態で、claude-code セッションに切り替え（Detail モード）、以下を入力する:

```
/worktree
```

または EnterWorktree を使うプロンプトを投げる。Overviewに戻ったとき（`Ctrl+]`）、cwd が新しいワークツリーパスに更新されていることを確認する。

- [ ] **Step 3: gemini-cli の AfterTool hook が動くか確認する**

mav 外で手動テスト:

```bash
# .gemini/settings.local.json を手動で作成
mkdir -p /tmp/test-gemini/.gemini
cat > /tmp/test-gemini/.gemini/settings.local.json << 'EOF'
{
  "hooks": {
    "AfterTool": [{"matcher": "", "hooks": [{"type": "command", "command": "echo 'hook fired' >> /tmp/gemini-hook.log"}]}]
  }
}
EOF

cd /tmp/test-gemini
gemini -p "list files in current directory" --yolo
cat /tmp/gemini-hook.log
```

期待: `/tmp/gemini-hook.log` に `hook fired` が記録される

- [ ] **Step 4: codex の hook が動くか確認する**

```bash
codex -p "list files" --profile-v2 mav-hook-test 2>&1
# 実際のTOML形式が合っているか確認する
```

エラーがあれば `buildCodexHook()` の `tomlContent` を修正する。

- [ ] **Step 5: コミット（修正がある場合）**

```bash
git add -A
git commit -m "fix(hook-injector): adjust codex TOML hook format based on testing"
```

---

### Task 7: README に未サポートエージェントを記載

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README の対応エージェント表に hook サポート列を追加する**

`README.md` を開き、エージェント対応表（または対応状況の記載箇所）に以下を追記する。
表がなければ新規作成する:

```markdown
## CWD 追跡

各エージェントの作業ディレクトリ変更（worktreeへの切り替え等）を mav が追跡する仕組みです。

| エージェント | CWD 追跡方法 | Hook 自動注入 |
|---|---|---|
| `claude-code` | IPC + PostToolUse hook | ✅ `--settings` で自動注入 |
| `gemini-cli` | IPC + AfterTool hook | ✅ `.gemini/settings.local.json` を自動生成 |
| `codex` | IPC + PostToolUse hook | ✅ `--profile-v2` で自動注入 |
| `copilot` | lsof ポーリングのみ | ❌ 未サポート（hook API なし） |
| その他 | lsof ポーリングのみ | ❌ 未サポート |

> **Copilot** と上記以外のエージェントはプロセスのcwdをポーリングで追跡します。
> エージェントが子プロセスでディレクトリを変更した場合（worktree等）は検知できません。
```

- [ ] **Step 2: コミット**

```bash
git add README.md
git commit -m "docs: document CWD tracking and hook injection support per agent"
```

---

## Self-Review

### Spec Coverage チェック

- [x] Unix socket IPC サーバー → Task 1
- [x] `mav report cwd` サブコマンド → Task 3
- [x] claude-code の hook 注入 → Task 2 (`buildClaudeCodeHook`)
- [x] gemini-cli の hook 注入 → Task 2 (`buildGeminiHook`)
- [x] codex の hook 注入 → Task 2 (`buildCodexHook`)
- [x] Copilot は未サポート → Task 7 README
- [x] MAV_SOCKET / MAV_SESSION_ID の env 注入 → Task 4
- [x] 一時ファイルのクリーンアップ → Task 2, Task 4
- [x] SessionManager への cwd 反映 → Task 5 (`notifyCwd`)
- [x] 動作確認 → Task 6

### Type Consistency チェック

- `IpcContext` は `src/agent.ts` で定義し、`src/index.ts` と `src/session-manager.ts` からインポートする
- `IpcMessage` は `src/ipc-server.ts` で定義
- `HookInjectionResult` は `src/hook-injector.ts` で定義
- `session.notifyCwd(path)` は Task 5 で `src/agent.ts` に追加

### Placeholder チェック

- Task 2 Step 5: Codexの実際のhook TOML形式の確認ステップを設けた（推測形式のため）
- Task 5 Step 1: 既存のindex.test.tsを事前確認するステップを設けた
