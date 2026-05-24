# mav Neovim State Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mav` が選択中セッションの `sessionId` / `agentType` / `displayName` / `cwd` / `updatedAt` を専用 JSON に公開できるようにする。

**Architecture:** `AgentSession` に起動時 `cwd` を持たせ、`SessionManager` に選択変更イベントを追加する。新しい current-session publisher モジュールが選択中セッションを書き出し、`start()` が初期化と更新配線を担当する。

**Tech Stack:** TypeScript, Node.js, node-pty, vitest

---

## Scope

この plan は `mav` リポジトリ内で完結する実装だけを対象にする。`LazyVim` plugin 側の poll / `lcd` follow は別リポジトリ作業なので、この plan には含めない。

## File Map

| ファイル | 役割 |
|---------|------|
| `src/agent.ts` | 起動時 `cwd` の保持 |
| `src/config.ts` | `AgentConfig` に `cwd` を通せるようにする |
| `src/session-manager.ts` | 選択変更イベントの発火 |
| `src/current-session.ts` | 選択中セッション JSON の保存・削除 |
| `src/index.ts` | state file path の決定、publisher の初期反映とイベント配線 |
| `src/ui/overview.ts` | 動的追加セッションに `cwd` を渡す |
| `tests/agent.test.ts` | `cwd` 保持のテスト |
| `tests/session-manager.test.ts` | selection event のテスト |
| `tests/current-session.test.ts` | current-session JSON の保存・削除テスト |
| `tests/index.test.ts` | 起動時・選択変更時の publisher 呼び出しテスト |
| `tests/overview.test.ts` | `n` 追加セッションが `cwd` を引き継ぐテスト |

---

### Task 1: Current Session Publisher を追加する

**Files:**
- Create: `src/current-session.ts`
- Create: `tests/current-session.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/current-session.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCurrentSessionState, saveCurrentSessionState } from '../src/current-session.js'

describe('current session state', () => {
  let root: string
  let statePath: string

  beforeEach(() => {
    root = join(tmpdir(), `mav-current-session-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    statePath = join(root, 'current-session.json')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('選択中セッションを JSON に保存する', async () => {
    saveCurrentSessionState(statePath, {
      id: 'codex#1',
      type: 'codex',
      displayName: 'fix auth redirect',
      cwd: '/tmp/project-a',
    })

    const raw = await import('node:fs/promises').then((fs) => fs.readFile(statePath, 'utf-8'))
    const parsed = JSON.parse(raw) as {
      sessionId: string
      agentType: string
      displayName: string
      cwd: string
      updatedAt: string
    }

    expect(parsed.sessionId).toBe('codex#1')
    expect(parsed.agentType).toBe('codex')
    expect(parsed.displayName).toBe('fix auth redirect')
    expect(parsed.cwd).toBe('/tmp/project-a')
    expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('親ディレクトリがなくても保存できる', () => {
    const nested = join(root, 'a', 'b', 'current-session.json')
    saveCurrentSessionState(nested, {
      id: 'claude-code#1',
      type: 'claude-code',
      displayName: 'claude-code 1',
      cwd: '/tmp/project-b',
    })

    expect(existsSync(nested)).toBe(true)
  })

  it('clear で current-session.json を削除する', () => {
    saveCurrentSessionState(statePath, {
      id: 'gemini-cli#1',
      type: 'gemini-cli',
      displayName: 'gemini-cli 1',
      cwd: '/tmp/project-c',
    })

    clearCurrentSessionState(statePath)

    expect(existsSync(statePath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/current-session.test.ts`

Expected: FAIL with `Cannot find module '../src/current-session.js'`

- [ ] **Step 3: Write the minimal implementation**

`src/current-session.ts`

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CurrentSessionSnapshot {
  id: string
  type: string
  displayName: string
  cwd: string
}

export interface CurrentSessionState {
  sessionId: string
  agentType: string
  displayName: string
  cwd: string
  updatedAt: string
}

export function saveCurrentSessionState(path: string, session: CurrentSessionSnapshot): void {
  const state: CurrentSessionState = {
    sessionId: session.id,
    agentType: session.type,
    displayName: session.displayName,
    cwd: session.cwd,
    updatedAt: new Date().toISOString(),
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state), 'utf-8')
}

export function clearCurrentSessionState(path: string): void {
  rmSync(path, { force: true })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/current-session.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/current-session.ts tests/current-session.test.ts
git commit -m "feat: add current session state publisher"
```

---

### Task 2: AgentSession に起動時 cwd を持たせる

**Files:**
- Modify: `src/config.ts`
- Modify: `src/agent.ts`
- Test: `tests/agent.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/agent.test.ts` に次を追加する。

```ts
it('config.cwd を保持する', () => {
  const session = new AgentSession(
    { type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/project-a' },
    80,
    24,
  )

  expect(session.cwd).toBe('/tmp/project-a')
})

it('node-pty spawn に cwd を渡す', () => {
  new AgentSession(
    { type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/project-b' },
    80,
    24,
  )

  expect(spawnMock).toHaveBeenCalledWith(
    'claude',
    [],
    expect.objectContaining({ cwd: '/tmp/project-b' }),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/agent.test.ts`

Expected: FAIL with `Property 'cwd' does not exist`

- [ ] **Step 3: Implement the minimal code**

`src/config.ts` の `AgentConfig` を更新する。

```ts
export interface AgentConfig {
  type: string
  cmd: string
  args: string[]
  cwd?: string
  resumeArgs?: string[]
}
```

`src/agent.ts` を更新する。

```ts
  readonly cmd: string
  readonly cwd: string
```

```ts
    this.cmd = config.cmd
    this.cwd = config.cwd ?? process.cwd()
```

```ts
      proc = pty.spawn(config.cmd, config.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.cwd,
        env: process.env as Record<string, string>,
      })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/agent.ts tests/agent.test.ts
git commit -m "feat: persist session startup cwd"
```

---

### Task 3: SessionManager に selection event を追加する

**Files:**
- Modify: `src/session-manager.ts`
- Test: `tests/session-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/session-manager.test.ts` に次を追加する。

```ts
it('selectSession で selection イベントが発火される', () => {
  manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })
  manager.addSession({ type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/b' })

  const handler = vi.fn()
  manager.on('selection', handler)

  manager.selectSession(1)

  expect(handler).toHaveBeenCalledWith(manager.sessions[1])
})

it('最初の addSession で selection イベントが発火される', () => {
  const handler = vi.fn()
  manager.on('selection', handler)

  manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })

  expect(handler).toHaveBeenCalledWith(manager.sessions[0])
})

it('選択中セッション削除で次の selection イベントが発火される', () => {
  manager.addSession({ type: 'claude-code', cmd: 'claude', args: [], cwd: '/tmp/a' })
  manager.addSession({ type: 'codex', cmd: 'codex', args: [], cwd: '/tmp/b' })
  manager.selectSession(1)

  const handler = vi.fn()
  manager.on('selection', handler)

  manager.removeSession(manager.sessions[1]!.id)

  expect(handler).toHaveBeenCalledWith(manager.sessions[0])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/session-manager.test.ts`

Expected: FAIL because `selection` is never emitted

- [ ] **Step 3: Implement the minimal code**

`src/session-manager.ts` に helper を追加する。

```ts
  private emitSelection(): void {
    this.emit('selection', this.selectedSession)
  }
```

`addSession`, `removeSession`, `selectSession`, `killAll` に発火を追加する。

```ts
    if (this.selectedIndex === -1) {
      this.selectedIndex = 0
      this.emitSelection()
    }
```

```ts
    if (this.sessions.length === 0) {
      this.selectedIndex = -1
    } else if (idx < this.selectedIndex) {
      this.selectedIndex -= 1
    } else if (this.selectedIndex >= this.sessions.length) {
      this.selectedIndex = this.sessions.length - 1
    }
    this.emitSelection()
```

```ts
    this.selectedIndex = index
    this.emitSelection()
```

```ts
    this.sessions = []
    this.sessionListeners.clear()
    this.selectedIndex = -1
    this.emitSelection()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/session-manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session-manager.ts tests/session-manager.test.ts
git commit -m "feat: emit session selection changes"
```

---

### Task 4: start() から current-session publisher を配線する

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/index.test.ts` に mock を追加する。

```ts
const { saveCurrentSessionStateMock, clearCurrentSessionStateMock } = vi.hoisted(() => {
  return {
    saveCurrentSessionStateMock: vi.fn(),
    clearCurrentSessionStateMock: vi.fn(),
  }
})
```

```ts
vi.mock('../src/current-session.js', () => ({
  saveCurrentSessionState: saveCurrentSessionStateMock,
  clearCurrentSessionState: clearCurrentSessionStateMock,
}))
```

`SessionManager` mock に event emitter を足す。

```ts
SessionManager: class extends (require('node:events').EventEmitter) {
  sessions: unknown[] = []
  selectedIndex = -1
  selectedSession: unknown = null
  addSession(...args: unknown[]) {
    const result = managerAddSessionMock(...args)
    this.sessions.push(result ?? {})
    if (this.selectedIndex === -1) {
      this.selectedIndex = 0
      this.selectedSession = this.sessions[0] ?? null
    }
    return result
  }
  emitSelection(session: unknown) {
    this.selectedSession = session
    this.emit('selection', session)
  }
}
```

次のテストを追加する。

```ts
it('起動時に選択中セッションを current-session.json へ保存する', () => {
  loadConfigMock.mockReturnValue({
    agents: [{ type: 'codex', cmd: 'codex', args: [] }],
  })
  managerAddSessionMock.mockReturnValue({
    id: 'codex#1',
    type: 'codex',
    displayName: 'codex 1',
    cwd: '/tmp/project-a',
    logBuffer: [],
    status: 'idle',
  })

  start()

  expect(saveCurrentSessionStateMock).toHaveBeenCalledWith(
    expect.stringContaining('current-session.json'),
    expect.objectContaining({
      id: 'codex#1',
      type: 'codex',
      displayName: 'codex 1',
      cwd: '/tmp/project-a',
    }),
  )
})

it('selection イベントで current-session.json を更新する', () => {
  loadConfigMock.mockReturnValue({
    agents: [{ type: 'codex', cmd: 'codex', args: [] }],
  })
  const createdSession = {
    id: 'codex#1',
    type: 'codex',
    displayName: 'codex 1',
    cwd: '/tmp/project-a',
    logBuffer: [],
    status: 'idle',
  }
  managerAddSessionMock.mockReturnValue(createdSession)

  const manager = start() as unknown as { emitSelection: (session: unknown) => void }
  manager.emitSelection({
    id: 'claude-code#1',
    type: 'claude-code',
    displayName: 'fix bug',
    cwd: '/tmp/project-b',
  })

  expect(saveCurrentSessionStateMock).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      id: 'claude-code#1',
      type: 'claude-code',
      displayName: 'fix bug',
      cwd: '/tmp/project-b',
    }),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/index.test.ts`

Expected: FAIL because `current-session.js` is not wired

- [ ] **Step 3: Implement the minimal code**

`src/index.ts` に import を追加する。

```ts
import { clearCurrentSessionState, saveCurrentSessionState } from './current-session.js'
```

`start()` 冒頭で path を計算する。

```ts
  const currentSessionPath = join(homedir(), '.local', 'state', 'mav', 'current-session.json')
```

publisher helper を追加する。

```ts
  const publishSelectedSession = () => {
    const session = manager.selectedSession
    if (!session) {
      clearCurrentSessionState(currentSessionPath)
      return
    }

    saveCurrentSessionState(currentSessionPath, {
      id: session.id,
      type: session.type,
      displayName: session.displayName,
      cwd: session.cwd,
    })
  }
```

初回起動と selection event に配線する。

```ts
  manager.on('selection', () => {
    publishSelectedSession()
  })
```

```ts
  publishSelectedSession()
```

`start()` の末尾は manager を返すようにする。

```ts
export function start(options: StartOptions = {}): SessionManager {
  // existing logic
  app.start()
  return manager
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: publish selected session state"
```

---

### Task 5: Overview の動的追加セッションにも cwd を渡す

**Files:**
- Modify: `src/ui/overview.ts`
- Test: `tests/overview.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/overview.test.ts` に次を追加する。

```ts
it('n で追加したセッションは process.cwd() を cwd として起動する', () => {
  const initialSession = { id: 'claude-code#1', displayName: 'claude-code 1', status: 'running', logBuffer: [], write: vi.fn() }
  const addedSession = { id: 'codex#1', displayName: 'codex 1', status: 'running', logBuffer: [], write: vi.fn(), cwd: '/tmp/project-a' }
  const screen = { render: vi.fn() }
  const manager = Object.assign(new EventEmitter(), {
    sessions: [initialSession],
    selectedIndex: 0,
    selectedSession: initialSession,
    selectSession(index: number) {
      this.selectedIndex = index
      this.selectedSession = this.sessions[index] ?? null
    },
    addSession: vi.fn(() => {
      manager.sessions.push(addedSession)
      return addedSession
    }),
    removeSession: vi.fn(),
  })

  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/project-a')

  new OverviewUI(screen as never, manager as never)

  const listBox = widgets.createdLists[0]!
  listBox.handlers.get('n')?.()
  const prompt = widgets.createdLists[1]!
  prompt.selected = 1
  prompt.handlers.get('enter')?.()

  expect(manager.addSession).toHaveBeenCalledWith({
    type: 'codex',
    cmd: 'codex',
    args: [],
    cwd: '/tmp/project-a',
  })

  cwdSpy.mockRestore()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/overview.test.ts`

Expected: FAIL because `cwd` is missing in `addSession` arguments

- [ ] **Step 3: Implement the minimal code**

`src/ui/overview.ts` の追加処理を更新する。

```ts
      const session = this.manager.addSession({
        type: selected,
        cmd: d.cmd,
        args: d.args,
        cwd: process.cwd(),
      })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/overview.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/overview.ts tests/overview.test.ts
git commit -m "feat: pass cwd when creating sessions from overview"
```

---

### Task 6: Full verification and docs touch-up

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short doc note for Neovim integration state file**

`README.md` の設定または特徴の近くに次の一節を追加する。

```md
## Neovim Integration

`mav` writes the currently selected session to `~/.local/state/mav/current-session.json`.
This file is intended for editor integrations such as Neovim plugins that want to follow the active session's working directory.
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`

Expected: PASS

- [ ] **Step 3: Run the build**

Run: `pnpm build`

Expected: PASS with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document current session state output"
```

---

## Self-Review

- Spec coverage: `mav` 側要件である `cwd` 保持、選択変更検知、JSON 出力、起動時反映、動的追加セッション対応をすべて task 化した。`LazyVim` plugin 実装は別 repo のためこの plan から意図的に除外した。
- Placeholder scan: `TODO` / `TBD` / “write tests for above” のような空欄指示は含めていない。
- Type consistency: `cwd`, `saveCurrentSessionState`, `clearCurrentSessionState`, `selection` event の命名を全 task で統一した。

Plan complete and saved to `docs/superpowers/plans/2026-05-23-mav-neovim-state-publication-implementation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
