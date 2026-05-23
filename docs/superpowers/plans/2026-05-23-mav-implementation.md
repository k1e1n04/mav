# mav — multi-agent view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TypeScript CLI ツール `mav` を実装する。複数のAI coding assistant CLIをPTYサブプロセスとして管理し、Overviewモード（ダッシュボード）とDetailモード（フルスクリーン）を切り替えて表示する。

**Architecture:** `AgentSession` がPTYプロセス1つを管理し、`SessionManager` が全セッションの状態を保持する。`neo-blessed` の Screen が2モードを切り替え、OverviewはListBox＋LogBox、DetailはRaw PTY出力をBoxに流す。

**Tech Stack:** TypeScript, Node.js, neo-blessed, node-pty, js-yaml, commander, vitest

---

## File Map

| ファイル | 責務 |
|---------|------|
| `package.json` | 依存・scripts定義 |
| `tsconfig.json` | TypeScript設定 |
| `pnpm-workspace.yaml` | pnpm設定（minimumReleaseAge） |
| `src/config.ts` | YAMLファイル読み込み・バリデーション・デフォルト埋め |
| `src/agent.ts` | `AgentSession` クラス（PTY起動・書き込み・バッファ・イベント） |
| `src/session-manager.ts` | `SessionManager` クラス（セッション追加・削除・選択） |
| `src/ui/app.ts` | `blessed.screen` 保持、Overview/Detail モード切り替え |
| `src/ui/overview.ts` | Overviewモード描画（エージェントリスト＋ログストリーム＋入力バー） |
| `src/ui/detail.ts` | Detailモード（PTYパススルー、ヘッダー表示） |
| `src/index.ts` | アプリケーションエントリ（SessionManager＋UI組み立て） |
| `bin/mav.ts` | CLIエントリ（commander で引数解析 → src/index.ts呼び出し） |
| `tests/config.test.ts` | config.ts ユニットテスト |
| `tests/agent.test.ts` | AgentSession ユニットテスト（node-ptyモック） |
| `tests/session-manager.test.ts` | SessionManager ユニットテスト |

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "mav",
  "version": "0.1.0",
  "description": "Multi-agent view — manage multiple AI CLI sessions in one terminal",
  "type": "module",
  "bin": {
    "mav": "./dist/bin/mav.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx bin/mav.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "13.1.0",
    "js-yaml": "4.1.0",
    "neo-blessed": "0.2.0",
    "node-pty": "1.0.0"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/neo-blessed": "0.1.9",
    "@types/node": "22.15.21",
    "tsx": "4.19.3",
    "typescript": "5.8.3",
    "vitest": "3.2.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: pnpm-workspace.yaml を作成**

```yaml
minimumReleaseAge: 10080 # 7日
minimumReleaseAgeStrict: true
```

- [ ] **Step 4: .gitignore を作成**

```
node_modules/
dist/
*.js.map
```

- [ ] **Step 5: 依存をインストール**

```bash
cd /Users/ishiiken/Develop/multi-agent-view
pnpm install
```

Expected: `node_modules/` が作成され、`pnpm-lock.yaml` が生成される。

- [ ] **Step 6: commit**

```bash
git init
git add package.json tsconfig.json pnpm-workspace.yaml .gitignore pnpm-lock.yaml
git commit -m "chore: initial project setup"
```

---

### Task 2: Config モジュール

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: テストを書く**

`tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, type MavConfig, type AgentConfig } from '../src/config.js'

const TMP = join(tmpdir(), 'mav-test-config')

beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('設定ファイルがない場合はデフォルト設定を返す', () => {
    const config = loadConfig(join(TMP, 'nonexistent.yaml'))
    expect(config.agents).toHaveLength(1)
    expect(config.agents[0].type).toBe('claude-code')
    expect(config.agents[0].cmd).toBe('claude')
    expect(config.agents[0].args).toEqual([])
  })

  it('typeのみ指定でデフォルトcmdが補完される', () => {
    const yaml = `agents:\n  - type: codex\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('codex')
    expect(config.agents[0].args).toEqual([])
  })

  it('cmdをオーバーライドできる', () => {
    const yaml = `agents:\n  - type: claude-code\n    cmd: claude-launcher\n    args: []\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('claude-launcher')
  })

  it('argsを複数指定できる', () => {
    const yaml = `agents:\n  - type: copilot\n    cmd: gh\n    args:\n      - copilot\n      - suggest\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gh')
    expect(config.agents[0].args).toEqual(['copilot', 'suggest'])
  })

  it('gemini-cliのデフォルトcmdはgemini', () => {
    const yaml = `agents:\n  - type: gemini-cli\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gemini')
  })

  it('copilotのデフォルトcmdはgh', () => {
    const yaml = `agents:\n  - type: copilot\n`
    writeFileSync(join(TMP, 'config.yaml'), yaml)
    const config = loadConfig(join(TMP, 'config.yaml'))
    expect(config.agents[0].cmd).toBe('gh')
    expect(config.agents[0].args).toEqual(['copilot', 'suggest'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/ishiiken/Develop/multi-agent-view
pnpm test
```

Expected: `Cannot find module '../src/config.js'` 系のエラー

- [ ] **Step 3: src/config.ts を実装**

```typescript
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test tests/config.test.ts
```

Expected: 6 tests pass

- [ ] **Step 5: commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with YAML loading and defaults"
```

---

### Task 3: AgentSession クラス

**Files:**
- Create: `src/agent.ts`
- Create: `tests/agent.test.ts`

- [ ] **Step 1: テストを書く**

`tests/agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// node-pty をモック
vi.mock('node-pty', () => {
  const mockPty = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    pid: 1234,
  }
  return {
    spawn: vi.fn(() => mockPty),
    __mockPty: mockPty,
  }
})

import * as nodePty from 'node-pty'
import { AgentSession } from '../src/agent.js'

const getMockPty = () => (nodePty as any).__mockPty

describe('AgentSession', () => {
  let session: AgentSession
  let onDataCb: ((data: string) => void) | undefined
  let onExitCb: ((exitCode: { exitCode: number }) => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    getMockPty().onData.mockImplementation((cb: (data: string) => void) => { onDataCb = cb })
    getMockPty().onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => { onExitCb = cb })
    session = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
  })

  it('起動時にstatus=runningになる', () => {
    expect(session.status).toBe('running')
  })

  it('idはtype#1形式', () => {
    expect(session.id).toBe('claude-code#1')
  })

  it('PTYにデータが届くとlogBufferに追記される', () => {
    onDataCb?.('Hello World\r\n')
    expect(session.logBuffer).toContain('Hello World\r\n')
  })

  it('logBufferは最大500行を保持する', () => {
    for (let i = 0; i < 600; i++) {
      onDataCb?.(`line ${i}\r\n`)
    }
    expect(session.logBuffer.length).toBeLessThanOrEqual(500)
  })

  it('PTY exitでstatus=doneになる', () => {
    onExitCb?.({ exitCode: 0 })
    expect(session.status).toBe('done')
  })

  it('PTY exit code非0でstatus=errorになる', () => {
    onExitCb?.({ exitCode: 1 })
    expect(session.status).toBe('error')
  })

  it('write()がPTYにデータを送る', () => {
    session.write('hello\n')
    expect(getMockPty().write).toHaveBeenCalledWith('hello\n')
  })

  it('kill()でPTYが終了される', () => {
    session.kill()
    expect(getMockPty().kill).toHaveBeenCalled()
  })

  it('resize()でPTYがリサイズされる', () => {
    session.resize(100, 30)
    expect(getMockPty().resize).toHaveBeenCalledWith(100, 30)
  })

  it('データ受信時にonDataイベントが発火される', () => {
    const handler = vi.fn()
    session.on('data', handler)
    onDataCb?.('chunk')
    expect(handler).toHaveBeenCalledWith('chunk')
  })

  it('exit時にonExitイベントが発火される', () => {
    const handler = vi.fn()
    session.on('exit', handler)
    onExitCb?.({ exitCode: 0 })
    expect(handler).toHaveBeenCalledWith(0)
  })
})

describe('AgentSession — 連番ID', () => {
  it('同typeで複数起動すると連番になる', () => {
    vi.clearAllMocks()
    getMockPty().onData.mockImplementation(vi.fn())
    getMockPty().onExit.mockImplementation(vi.fn())

    const s1 = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    const s2 = new AgentSession({ type: 'claude-code', cmd: 'claude', args: [] }, 80, 24)
    expect(s1.id).toBe('claude-code#1')
    expect(s2.id).toBe('claude-code#2')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test tests/agent.test.ts
```

Expected: `Cannot find module '../src/agent.js'` 系エラー

- [ ] **Step 3: src/agent.ts を実装**

```typescript
import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { AgentConfig } from './config.js'

export type SessionStatus = 'running' | 'idle' | 'done' | 'error'

const counters: Record<string, number> = {}

export class AgentSession extends EventEmitter {
  readonly id: string
  readonly type: string
  status: SessionStatus = 'running'
  logBuffer: string[] = []
  lastPrompt: string = ''

  private ptyProcess: pty.IPty

  constructor(config: AgentConfig, cols: number, rows: number) {
    super()
    counters[config.type] = (counters[config.type] ?? 0) + 1
    this.id = `${config.type}#${counters[config.type]}`
    this.type = config.type

    this.ptyProcess = pty.spawn(config.cmd, config.args, {
      name: 'xterm-256color',
      cols,
      rows,
      env: process.env as Record<string, string>,
    })

    this.ptyProcess.onData((data) => {
      this.appendLog(data)
      this.emit('data', data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.status = exitCode === 0 ? 'done' : 'error'
      this.emit('exit', exitCode)
    })
  }

  write(data: string): void {
    this.ptyProcess.write(data)
  }

  kill(): void {
    this.ptyProcess.kill()
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows)
  }

  private appendLog(chunk: string): void {
    this.logBuffer.push(chunk)
    if (this.logBuffer.length > 500) {
      this.logBuffer.splice(0, this.logBuffer.length - 500)
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test tests/agent.test.ts
```

Expected: 全テストpass

- [ ] **Step 5: commit**

```bash
git add src/agent.ts tests/agent.test.ts
git commit -m "feat: add AgentSession with PTY lifecycle management"
```

---

### Task 4: SessionManager クラス

**Files:**
- Create: `src/session-manager.ts`
- Create: `tests/session-manager.test.ts`

- [ ] **Step 1: テストを書く**

`tests/session-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// AgentSession をモック
vi.mock('../src/agent.js', () => {
  let counter = 0
  class MockAgentSession extends EventEmitter {
    id: string
    type: string
    status = 'running'
    logBuffer: string[] = []
    lastPrompt = ''
    write = vi.fn()
    kill = vi.fn()
    resize = vi.fn()

    constructor(config: { type: string; cmd: string; args: string[] }) {
      super()
      counter++
      this.type = config.type
      this.id = `${config.type}#${counter}`
    }
  }
  return { AgentSession: MockAgentSession }
})

import { SessionManager } from '../src/session-manager.js'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
  })

  it('初期状態でsessions空、selectedIndex=-1', () => {
    expect(manager.sessions).toHaveLength(0)
    expect(manager.selectedIndex).toBe(-1)
  })

  it('addSession でセッションが追加される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.sessions).toHaveLength(1)
  })

  it('最初のaddSessionで selectedIndex=0 になる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.selectedIndex).toBe(0)
  })

  it('複数セッション追加でも selectedIndex は変わらない', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    expect(manager.selectedIndex).toBe(0)
  })

  it('selectSession でindexが変わる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    manager.selectSession(1)
    expect(manager.selectedIndex).toBe(1)
  })

  it('範囲外のselectSessionは無視される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.selectSession(5)
    expect(manager.selectedIndex).toBe(0)
  })

  it('removeSession でセッションが削除される', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const id = manager.sessions[0].id
    manager.removeSession(id)
    expect(manager.sessions).toHaveLength(0)
  })

  it('削除後 selectedIndex は有効範囲にクランプされる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.addSession({ type: 'codex', cmd: 'codex', args: [] })
    manager.selectSession(1)
    manager.removeSession(manager.sessions[1].id)
    expect(manager.selectedIndex).toBe(0)
  })

  it('全削除後 selectedIndex は -1 になる', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    manager.removeSession(manager.sessions[0].id)
    expect(manager.selectedIndex).toBe(-1)
  })

  it('selectedSession は selectedIndex のセッションを返す', () => {
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    expect(manager.selectedSession).toBe(manager.sessions[0])
  })

  it('selectedSession は空の場合 null を返す', () => {
    expect(manager.selectedSession).toBeNull()
  })

  it('addSession でdataイベントが発火される', () => {
    const handler = vi.fn()
    manager.on('data', handler)
    manager.addSession({ type: 'claude-code', cmd: 'claude', args: [] })
    const session = manager.sessions[0]
    session.emit('data', 'hello')
    expect(handler).toHaveBeenCalledWith(session.id, 'hello')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
pnpm test tests/session-manager.test.ts
```

Expected: `Cannot find module '../src/session-manager.js'` 系エラー

- [ ] **Step 3: src/session-manager.ts を実装**

```typescript
import { EventEmitter } from 'node:events'
import { AgentSession } from './agent.js'
import type { AgentConfig } from './config.js'

export class SessionManager extends EventEmitter {
  sessions: AgentSession[] = []
  selectedIndex: number = -1

  addSession(config: AgentConfig, cols = 80, rows = 24): AgentSession {
    const session = new AgentSession(config, cols, rows)

    session.on('data', (chunk: string) => {
      this.emit('data', session.id, chunk)
    })

    session.on('exit', (code: number) => {
      this.emit('exit', session.id, code)
    })

    this.sessions.push(session)

    if (this.selectedIndex === -1) {
      this.selectedIndex = 0
    }

    return session
  }

  removeSession(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id)
    if (idx === -1) return

    this.sessions[idx].kill()
    this.sessions.splice(idx, 1)

    if (this.sessions.length === 0) {
      this.selectedIndex = -1
    } else if (this.selectedIndex >= this.sessions.length) {
      this.selectedIndex = this.sessions.length - 1
    }
  }

  selectSession(index: number): void {
    if (index < 0 || index >= this.sessions.length) return
    this.selectedIndex = index
  }

  get selectedSession(): AgentSession | null {
    if (this.selectedIndex === -1) return null
    return this.sessions[this.selectedIndex] ?? null
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill()
    }
    this.sessions = []
    this.selectedIndex = -1
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
pnpm test tests/session-manager.test.ts
```

Expected: 全テストpass

- [ ] **Step 5: commit**

```bash
git add src/session-manager.ts tests/session-manager.test.ts
git commit -m "feat: add SessionManager with session lifecycle and selection"
```

---

### Task 5: UI — Overview モード

**Files:**
- Create: `src/ui/overview.ts`

TUI部分はユニットテスト困難なため、手動確認。

- [ ] **Step 1: src/ui/overview.ts を実装**

```typescript
import * as blessed from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'
import type { AgentSession } from '../agent.js'

export class OverviewUI {
  private screen: blessed.Widgets.Screen
  private manager: SessionManager
  private listBox: blessed.Widgets.ListElement
  private logBox: blessed.Widgets.BoxElement
  private inputBar: blessed.Widgets.TextboxElement
  private addPrompt: blessed.Widgets.BoxElement | null = null

  constructor(screen: blessed.Widgets.Screen, manager: SessionManager) {
    this.screen = screen
    this.manager = manager

    // エージェントリスト（左ペイン）
    this.listBox = blessed.list({
      parent: screen,
      top: 0,
      left: 0,
      width: '25%',
      height: '90%-1',
      border: { type: 'line' },
      label: ' AGENTS ',
      style: {
        selected: { bg: 'blue', fg: 'white' },
        border: { fg: 'cyan' },
      },
      keys: true,
      mouse: true,
    })

    // ログストリーム（右ペイン）
    this.logBox = blessed.box({
      parent: screen,
      top: 0,
      left: '25%',
      width: '75%',
      height: '90%-1',
      border: { type: 'line' },
      label: ' LOG STREAM ',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: '│' },
      style: { border: { fg: 'cyan' } },
      tags: true,
    })

    // 入力バー（下部）
    this.inputBar = blessed.textbox({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      label: ' INPUT ',
      style: { border: { fg: 'yellow' }, focus: { border: { fg: 'white' } } },
      inputOnFocus: true,
    })

    this.bindKeys()
    this.syncList()

    manager.on('data', () => {
      this.updateLog()
      screen.render()
    })

    manager.on('exit', () => {
      this.syncList()
      screen.render()
    })
  }

  private bindKeys(): void {
    this.listBox.key(['up', 'k'], () => {
      const idx = Math.max(0, this.manager.selectedIndex - 1)
      this.manager.selectSession(idx)
      this.listBox.select(idx)
      this.screen.render()
    })

    this.listBox.key(['down', 'j'], () => {
      const idx = Math.min(this.manager.sessions.length - 1, this.manager.selectedIndex + 1)
      this.manager.selectSession(idx)
      this.listBox.select(idx)
      this.screen.render()
    })

    this.listBox.key('tab', () => {
      this.inputBar.focus()
      this.screen.render()
    })

    this.listBox.key('n', () => {
      this.showAddPrompt()
    })

    this.listBox.key('d', () => {
      const session = this.manager.selectedSession
      if (session) {
        this.manager.removeSession(session.id)
        this.syncList()
        this.screen.render()
      }
    })

    this.inputBar.key('enter', () => {
      const text = this.inputBar.getValue()
      if (text) {
        this.manager.selectedSession?.write(text + '\r')
        this.inputBar.clearValue()
      }
      this.inputBar.cancel()
      this.listBox.focus()
      this.screen.render()
    })

    this.inputBar.key('escape', () => {
      this.inputBar.cancel()
      this.listBox.focus()
      this.screen.render()
    })
  }

  private showAddPrompt(): void {
    const agentTypes = ['claude-code', 'codex', 'gemini-cli', 'copilot']

    if (this.addPrompt) {
      this.addPrompt.destroy()
      this.addPrompt = null
    }

    const prompt = blessed.list({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 40,
      height: agentTypes.length + 4,
      border: { type: 'line' },
      label: ' Select agent type ',
      items: agentTypes,
      keys: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        border: { fg: 'green' },
      },
    })

    this.addPrompt = prompt as unknown as blessed.Widgets.BoxElement

    prompt.key('enter', () => {
      const selected = agentTypes[prompt.selected ?? 0]
      prompt.destroy()
      this.addPrompt = null

      const defaults: Record<string, { cmd: string; args: string[] }> = {
        'claude-code': { cmd: 'claude', args: [] },
        'codex': { cmd: 'codex', args: [] },
        'gemini-cli': { cmd: 'gemini', args: [] },
        'copilot': { cmd: 'gh', args: ['copilot', 'suggest'] },
      }
      const d = defaults[selected] ?? { cmd: selected, args: [] }
      this.manager.addSession({ type: selected, cmd: d.cmd, args: d.args })
      this.syncList()
      this.listBox.focus()
      this.screen.render()
    })

    prompt.key('escape', () => {
      prompt.destroy()
      this.addPrompt = null
      this.listBox.focus()
      this.screen.render()
    })

    prompt.focus()
    this.screen.render()
  }

  private syncList(): void {
    const items = this.manager.sessions.map((s) => {
      const statusIcon = s.status === 'running' ? '⣾' : s.status === 'done' ? '✓' : '✗'
      return ` ${statusIcon} ${s.id}`
    })
    this.listBox.setItems(items)
    if (this.manager.selectedIndex >= 0) {
      this.listBox.select(this.manager.selectedIndex)
    }
  }

  private updateLog(): void {
    const lines: string[] = []
    for (const session of this.manager.sessions) {
      const recent = session.logBuffer.slice(-20)
      for (const chunk of recent) {
        const escaped = chunk.replace(/\x1b\[[0-9;]*m/g, '')
        lines.push(`{cyan-fg}[${session.id}]{/cyan-fg} ${escaped}`)
      }
    }
    this.logBox.setContent(lines.join(''))
    this.logBox.setScrollPerc(100)
  }

  show(): void {
    this.listBox.show()
    this.logBox.show()
    this.inputBar.show()
    this.listBox.focus()
    this.syncList()
    this.updateLog()
    this.screen.render()
  }

  hide(): void {
    this.listBox.hide()
    this.logBox.hide()
    this.inputBar.hide()
  }
}
```

- [ ] **Step 2: commit**

```bash
git add src/ui/overview.ts
git commit -m "feat: add Overview UI with agent list, log stream, and input bar"
```

---

### Task 6: UI — Detail モード

**Files:**
- Create: `src/ui/detail.ts`

- [ ] **Step 1: src/ui/detail.ts を実装**

```typescript
import * as blessed from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private screen: blessed.Widgets.Screen
  private headerBox: blessed.Widgets.BoxElement
  private contentBox: blessed.Widgets.BoxElement
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen

    this.headerBox = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { bg: 'blue', fg: 'white', bold: true },
      tags: true,
    })

    this.contentBox = blessed.box({
      parent: screen,
      top: 1,
      left: 0,
      width: '100%',
      height: screen.height as number - 1,
      scrollable: true,
      alwaysScroll: true,
      tags: false,
    })
  }

  attach(session: AgentSession): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
    }

    this.currentSession = session
    this.contentBox.setContent('')

    const buf = session.logBuffer.join('')
    this.contentBox.setContent(buf)
    this.contentBox.setScrollPerc(100)

    this.dataListener = (data: string) => {
      this.contentBox.pushLine(data)
      this.contentBox.setScrollPerc(100)
      this.screen.render()
    }
    session.on('data', this.dataListener)

    this.headerBox.setContent(
      ` mav — {bold}${session.id}{/bold}  {grey-fg}[← to back]{/grey-fg} `
    )

    this.screen.render()
  }

  detach(): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
    }
    this.currentSession = null
    this.dataListener = null
  }

  forwardKey(key: string, ch: string): void {
    if (this.currentSession) {
      if (key === 'return') {
        this.currentSession.write('\r')
      } else if (key === 'backspace') {
        this.currentSession.write('\x7f')
      } else if (key === 'ctrl+c') {
        this.currentSession.write('\x03')
      } else if (key === 'ctrl+d') {
        this.currentSession.write('\x04')
      } else if (key === 'ctrl+b') {
        // ctrl+b → カーソル左移動（← の代替）
        this.currentSession.write('\x1b[D')
      } else if (ch) {
        this.currentSession.write(ch)
      }
    }
  }

  resize(cols: number, rows: number): void {
    this.contentBox.height = rows - 1
    this.currentSession?.resize(cols, rows - 1)
  }

  show(): void {
    this.headerBox.show()
    this.contentBox.show()
    this.screen.render()
  }

  hide(): void {
    this.headerBox.hide()
    this.contentBox.hide()
  }
}
```

- [ ] **Step 2: commit**

```bash
git add src/ui/detail.ts
git commit -m "feat: add Detail UI with PTY passthrough and header"
```

---

### Task 7: UI App — モード切り替え

**Files:**
- Create: `src/ui/app.ts`

- [ ] **Step 1: src/ui/app.ts を実装**

```typescript
import * as blessed from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'
import { OverviewUI } from './overview.js'
import { DetailUI } from './detail.js'

type Mode = 'overview' | 'detail'

export class App {
  private screen: blessed.Widgets.Screen
  private manager: SessionManager
  private overviewUI: OverviewUI
  private detailUI: DetailUI
  private mode: Mode = 'overview'

  constructor(manager: SessionManager) {
    this.manager = manager

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'mav',
      fullUnicode: true,
    })

    this.overviewUI = new OverviewUI(this.screen, manager)
    this.detailUI = new DetailUI(this.screen)

    this.bindGlobalKeys()
    this.bindOverviewNavigation()

    this.screen.on('resize', () => {
      const cols = this.screen.width as number
      const rows = this.screen.height as number
      if (this.mode === 'detail') {
        this.detailUI.resize(cols, rows)
      }
    })
  }

  private bindGlobalKeys(): void {
    this.screen.key(['q', 'C-c'], () => {
      this.manager.killAll()
      this.screen.destroy()
      process.exit(0)
    })
  }

  private bindOverviewNavigation(): void {
    // → or Enter → detail
    this.screen.key(['right', 'enter'], () => {
      if (this.mode !== 'overview') return
      const session = this.manager.selectedSession
      if (!session) return
      this.switchToDetail()
    })

    // ← → overview（detailモード専用）
    this.screen.key('left', () => {
      if (this.mode === 'detail') {
        this.switchToOverview()
      }
    })

    // detailモードで全キーをフォワード
    this.screen.on('keypress', (ch, key) => {
      if (this.mode !== 'detail') return
      if (key.name === 'left') return // ← は上で処理
      this.detailUI.forwardKey(key.name ?? '', ch ?? '')
    })
  }

  private switchToDetail(): void {
    const session = this.manager.selectedSession
    if (!session) return
    this.mode = 'detail'
    this.overviewUI.hide()
    this.detailUI.attach(session)
    this.detailUI.show()
  }

  private switchToOverview(): void {
    this.mode = 'overview'
    this.detailUI.detach()
    this.detailUI.hide()
    this.overviewUI.show()
  }

  start(): void {
    this.overviewUI.show()
    this.screen.render()
  }
}
```

- [ ] **Step 2: commit**

```bash
git add src/ui/app.ts
git commit -m "feat: add App with Overview/Detail mode switching and global keybindings"
```

---

### Task 8: エントリポイント

**Files:**
- Create: `src/index.ts`
- Create: `bin/mav.ts`

- [ ] **Step 1: src/index.ts を実装**

```typescript
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
  const configPath = options.configPath ?? join(homedir(), '.config', 'mav', 'config.yaml')
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
```

- [ ] **Step 2: bin/mav.ts を実装**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('mav')
  .description('Multi-agent view — manage multiple AI CLI sessions in one terminal')
  .version(pkg.version)
  .option('--agent <type>', 'Start only the specified agent type')
  .option('--config <path>', 'Path to config file')
  .action((options) => {
    start({
      agentType: options.agent,
      configPath: options.config,
    })
  })

program.parse()
```

- [ ] **Step 3: mkdir bin**

```bash
mkdir -p /Users/ishiiken/Develop/multi-agent-view/bin
```

- [ ] **Step 4: ビルド確認**

```bash
cd /Users/ishiiken/Develop/multi-agent-view
pnpm build
```

Expected: `dist/` に `.js` ファイルが生成される。エラーなし。

- [ ] **Step 5: commit**

```bash
git add src/index.ts bin/mav.ts
git commit -m "feat: add entry points and CLI argument parsing"
```

---

### Task 9: 全テスト確認＆最終ビルド

- [ ] **Step 1: 全テスト実行**

```bash
cd /Users/ishiiken/Develop/multi-agent-view
pnpm test
```

Expected: config, agent, session-manager の全テストpass

- [ ] **Step 2: ビルド確認**

```bash
pnpm build
```

Expected: エラーなし、`dist/` に全ファイル生成

- [ ] **Step 3: dev モードで動作確認**

```bash
pnpm dev --help
```

Expected: help テキストが表示される

- [ ] **Step 4: 最終 commit**

```bash
git add -A
git commit -m "chore: verify build and tests pass"
```
