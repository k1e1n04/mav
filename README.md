# mav — multi-agent view

複数のAI coding assistant CLI（claude-code, codex, gemini-cli, copilot等）を1つのターミナルウィンドウで管理するラッパーCLIツールです。

```text
┌── AGENTS ────────────────────────────────────────────────────────────────┐
│ Working                                                                 │
│ ⣾ claude-code#1  working                                               │
│ ⣾ codex#1        working                                               │
│ Waiting                                                                 │
│ ○ gemini-cli#1   waiting                                               │
│ Complete                                                                │
│ ✓ copilot#1      complete                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

## 特徴

- 複数AIエージェントのセッションを1画面で俯瞰
- Overview は `Working / Waiting / Complete / Failed` の見出し付き一覧で進捗を把握
- `→` / `Enter` で選択中エージェントをフルスクリーン表示
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
    args: []
```

### エージェントのデフォルトコマンド

| type | デフォルト cmd |
|------|----------------|
| `claude-code` | `claude` |
| `codex` | `codex` |
| `gemini-cli` | `gemini` |
| `copilot` | `copilot` |

## キーバインド

| キー | スコープ | 動作 |
|------|----------|------|
| `↑` `↓` | Overview | セッションリストを移動 |
| `→` / `Enter` | Overview | 選択セッションをフルスクリーン表示 |
| `Ctrl+]` | Detail | Overview に戻る |
| `n` | Overview | 新規セッションを追加 |
| `d` | Overview | 選択セッションを終了・削除 |
| `q` / `Ctrl+C` | Overview | mav を終了（全セッションも終了） |

> **Note:** Overview は進捗確認用の一覧です。入力や完全な画面操作は Detail モードで行います。Detail モードでは `←` を含むキー入力はそのままエージェントに送られるため、Overview へ戻るときは `Ctrl+]` を使ってください。

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
