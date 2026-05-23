# mav — multi-agent view 設計ドキュメント

## 概要

`mav` は複数のAI coding assistant CLI（claude-code, codex, gemini-cli, copilot等）を1つのターミナルウィンドウで管理するラッパーCLIなのだ。各エージェントをサブプロセス（PTY）として起動し、ダッシュボード + 統合ログストリームの形で一覧表示する。

## ゴール

- 複数AIエージェントのセッションを1画面で俯瞰できる
- 各セッションにフルスクリーンでダイブイン・バックできる
- エージェントの種類や起動コマンドを設定ファイルで柔軟に定義できる
- 既存のCLIツールをそのまま使う（APIキー不要、ツール固有の挙動を保持）

## 技術スタック

| 項目 | 選択 |
|------|------|
| 言語 | TypeScript (Node.js) |
| TUI | blessed / neo-blessed |
| PTY管理 | node-pty |
| 設定ファイル | YAML (`~/.config/mav/config.yaml`) |
| パッケージ管理 | pnpm |

## UXモデル

### 2つのモード

**Overview モード**（通常表示）

```
┌── AGENTS ──────────────┬── LOG STREAM ────────────────────────────────────┐
│ ▶ claude-code #1       │ [claude-code#1] Reading auth.ts...               │
│   ⣾ running            │ [gemini#1]      Creating test_auth.py            │
│   fix auth bug         │ [claude-code#1] Found issue at line 42           │
│                        │ [copilot#1]     Extracting 3 helper functions     │
│   codex #1             │ [claude-code#1] ⣾ running bash: pnpm test...     │
│   ✓ idle               │                                                  │
│                        │                                                  │
│   gemini-cli #1        │                                                  │
│   ⣾ running            │                                                  │
│   write unit tests     │                                                  │
│                        │                                                  │
│   copilot #1           │                                                  │
│   ⣾ running            │                                                  │
│   refactor utils.ts    │                                                  │
├────────────────────────┴──────────────────────────────────────────────────┤
│ claude-code#1 │ > fix the login redirect bug_                             │
└───────────────────────────────────────────────────────────────────────────┘
```

**Detail モード**（`→` or `Enter` を押した後）

選択セッションのPTYを全画面に展開する。全キーストロークをPTYに素通し（`←` のみラッパーが横取り）。

```
┌─ mav — claude-code #1  [← to back] ─────────────────────────────────────┐
│ ● Reading auth.ts                                                         │
│   Found issue at line 42: token not invalidated on logout                 │
│ ● Writing auth.ts                                                         │
│   + res.clearCookie('session_token')                                      │
│   + await tokenStore.delete(userId)                                       │
│ ⣾ Running: pnpm test...                                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

### キーバインド

| キー | スコープ | 動作 |
|------|----------|------|
| `↑` `↓` | Overview | セッションリストを移動 |
| `→` / `Enter` | Overview | 選択セッションをDetail表示 |
| `←` | Detail | Overviewに戻る（PTYには渡さない） |
| `Tab` | Overview | 入力バーにフォーカス |
| `n` | Overview | 新規セッションを追加 |
| `d` | Overview | 選択セッションを終了 |
| `q` / `Ctrl+C` | Both | mavを終了（全セッションも終了） |

`←` はDetailモードでラッパーが横取りするため、PTY内でカーソルを左移動したい場合は `Ctrl+B` を使う。

## アーキテクチャ

### ディレクトリ構成

```
mav/
├── src/
│   ├── index.ts              # エントリポイント
│   ├── agent.ts              # AgentSession クラス
│   ├── session-manager.ts    # SessionManager クラス
│   ├── config.ts             # 設定ファイルの読み込み・バリデーション
│   └── ui/
│       ├── app.ts            # blessedルートスクリーン + モード切り替え
│       ├── overview.ts       # Overviewモード描画
│       └── detail.ts         # Detailモード（PTYパススルー）
├── bin/
│   └── mav.ts                # CLIエントリ
├── package.json
├── tsconfig.json
└── pnpm-workspace.yaml
```

### AgentSession

```typescript
interface AgentSession {
  id: string            // "claude-code#1", "codex#2" など
  type: string          // エージェント種別
  cmd: string           // 実際の起動コマンド（設定でオーバーライド済み）
  args: string[]
  pty: IPty             // node-ptyインスタンス
  status: 'idle' | 'running' | 'done' | 'error'
  logBuffer: string[]   // 最新500行を保持
  lastPrompt: string    // 直近のプロンプト（一覧の3行目に表示）
}
```

責務：PTYプロセスの起動・終了、出力のバッファリング、`SessionManager` へのイベント通知（`onData`, `onExit`）。

### SessionManager

全 `AgentSession` を保持し、追加・削除・選択の状態を管理する。UIへはイベント経由でログ更新を通知する。

### UI / app.ts

`blessed.screen` を保持し、Overviewと Detailの2モードを切り替える。`←` キーをグローバルに登録してDetailからOverviewへ戻る処理をハンドルする。

### config.ts

`~/.config/mav/config.yaml` を読み込む。`type` ごとにデフォルトコマンドを定義し、設定で `cmd`/`args` が指定されていればオーバーライドする。

## 設定ファイル

```yaml
# ~/.config/mav/config.yaml
agents:
  - type: claude-code
    cmd: claude-launcher   # デフォルト "claude" をオーバーライド
    args: []
  - type: codex
    # cmd省略 → デフォルト "codex" を使用
  - type: gemini-cli
    cmd: gemini
  - type: copilot
    cmd: gh
    args: ["copilot", "suggest"]
```

### エージェントのデフォルトコマンド

| type | デフォルト cmd |
|------|----------------|
| `claude-code` | `claude` |
| `codex` | `codex` |
| `gemini-cli` | `gemini` |
| `copilot` | `gh copilot suggest` |

## データフロー

```
ユーザー入力
  → (Overviewモード) Tab→入力バー → Enter → 選択セッションのPTY.write()
  → (Detailモード)  ← 以外 → PTY.write()  /  ← → app.switchToOverview()

PTY出力
  → AgentSession.logBuffer に追記
  → SessionManager.emit('data', sessionId, chunk)
  → overview.ts がログストリームに追記・再描画
  → (Detailモード) detail.ts がblessedBoxに直接書き込み
```

## 新規セッション追加（`n` キー）

Overviewモードで `n` を押すと、セッションリストの末尾にインラインプロンプトが表示される：

```
> Select agent type: [claude-code] [codex] [gemini-cli] [copilot]
```

矢印キーで選択して `Enter` を押すと新しい AgentSession が起動し、リストに追加される。`Escape` でキャンセル。

## Detail モードのヘッダー

Detailモードでは blessed のボックスタイトルとして1行のヘッダーを常時表示する。PTYはヘッダー分（2行: タイトル+ボーダー）を除いたサイズで起動し、SIGWINCH で端末リサイズに追従する。

## エラーハンドリング

- PTYプロセスがexitした場合 → ステータスを `error` または `done` に更新、セッションリストに表示（自動削除はしない）
- 設定ファイルが存在しない場合 → デフォルト設定で起動（claude-codeのみ）
- コマンドが見つからない場合（`ENOENT`） → セッション作成失敗のエラーをログストリームに表示

## テスト方針

- `AgentSession` のPTYライフサイクル（起動・書き込み・バッファリング・終了）をユニットテスト
- `SessionManager` の状態管理（追加・削除・選択）をユニットテスト
- `config.ts` のオーバーライドロジックをユニットテスト
- TUI（blessed）部分はE2Eテストが困難なため手動確認

## CLIインターフェース

```
mav                          # 設定ファイルのエージェントを全起動
mav --agent claude-code      # 指定エージェントのみ起動
mav --config ./mav.yaml      # 設定ファイルのパスを指定
mav --version
mav --help
```
