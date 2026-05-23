# mav — multi-agent view

複数のAI coding assistant CLI（claude-code, codex, gemini-cli, copilot等）を1つのターミナルウィンドウで管理するラッパーCLIツールです。

```
┌── AGENTS ──────────────┬── LOG STREAM ────────────────────────────────────┐
│ ▶ claude-code#1        │ [claude-code#1] Reading auth.ts...               │
│   ⣾ running            │ [gemini-cli#1]  Creating test_auth.py            │
│   fix auth bug         │ [claude-code#1] Found issue at line 42           │
│                        │ [codex#1]       Extracting 3 helper functions     │
│   codex#1              │ [claude-code#1] ⣾ running bash: pnpm test...     │
│   ✓ idle               │                                                  │
│                        │                                                  │
│   gemini-cli#1         │                                                  │
│   ⣾ running            │                                                  │
│                        │                                                  │
├────────────────────────┴──────────────────────────────────────────────────┤
│ claude-code#1 │ > fix the login redirect bug_                             │
└───────────────────────────────────────────────────────────────────────────┘
```

## 特徴

- 複数AIエージェントのセッションを1画面で俯瞰
- `→` / `Enter` でエージェントにダイブイン、`←` で一覧に戻る
- 全キーストロークをPTYに直接パススルー（各ツール固有の挙動を保持）
- YAMLで起動エージェントを自由に定義
- APIキー不要（既存のCLIツールをそのまま使用）

## インストール

### Homebrew（推奨）

```bash
brew tap k1e1n04/mav
brew install mav
```

### npm / pnpm

```bash
npm install -g mav
# または
pnpm add -g mav
```

### ソースからビルド

```bash
git clone https://github.com/k1e1n04/mav.git
cd mav
pnpm install
pnpm build
pnpm link --global
```

## 使い方

```bash
mav                          # 設定ファイルのエージェントを全起動
mav --agent claude-code      # 指定エージェントのみ起動
mav --config ./mav.yaml      # 設定ファイルのパスを指定
mav --version
mav --help
```

設定ファイル（`~/.config/mav/config.yaml`）がない場合は `claude` のみで起動します。

## 設定

`~/.config/mav/config.yaml` を作成してください。

```yaml
agents:
  - type: claude-code
    cmd: claude-launcher   # デフォルト "claude" をオーバーライド
    args: []
  - type: codex
    # cmd 省略 → デフォルト "codex" を使用
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

## キーバインド

| キー | スコープ | 動作 |
|------|----------|------|
| `↑` `↓` | Overview | セッションリストを移動 |
| `→` / `Enter` | Overview | 選択セッションをフルスクリーン表示 |
| `←` | Detail | Overviewに戻る |
| `Tab` | Overview | 入力バーにフォーカス |
| `n` | Overview | 新規セッションを追加 |
| `d` | Overview | 選択セッションを終了・削除 |
| `q` / `Ctrl+C` | Both | mav を終了（全セッションも終了） |

> **Note:** Detailモードでカーソルを左移動したい場合は `←` の代わりに `Ctrl+B` を使ってください（`←` はOverviewに戻るキーとして予約されています）。

## 動作要件

- Node.js 20+
- 対応プラットフォーム: macOS, Linux

## 貢献

1. フォークして `git checkout -b feat/your-feature`
2. 変更を加えてテストを書く（`pnpm test`）
3. `git commit -m "feat: your feature"`
4. プルリクエストを送る

## ライセンス

MIT — 詳細は [LICENSE](LICENSE) を参照してください。
