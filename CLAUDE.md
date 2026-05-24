# mav — CLAUDE.md

## プロジェクト概要

`mav` は複数のAI coding assistant CLI を1つのターミナルで管理するラッパーCLI。各エージェントをPTY（疑似端末）サブプロセスとして起動し、Overviewダッシュボード＋Detailフルスクリーンで操作する。

## 技術スタック

- **言語**: TypeScript (Node.js, ESM)
- **TUI**: ANSIエスケープ + `readline.emitKeypressEvents()` ベースの自前実装
- **PTY管理**: node-pty（ネイティブモジュール）
- **設定ファイル**: js-yaml
- **CLI引数**: commander
- **テスト**: vitest
- **パッケージ管理**: pnpm（npmは使わない）

## よく使うコマンド

```bash
pnpm test           # ユニットテスト全実行
pnpm test:watch     # ウォッチモード
pnpm build          # TypeScriptコンパイル + dist/bin/mav.js を chmod +x
pnpm dev            # tsx で直接実行（ビルド不要）
pnpm dev --help     # CLIヘルプ確認
```

## ディレクトリ構成

```
src/
  config.ts          # YAML設定読み込み・デフォルト補完
  agent.ts           # AgentSession クラス（PTYライフサイクル）
  session-manager.ts # SessionManager クラス（状態管理）
  index.ts           # start() 関数（SessionManager + App の組み立て）
  ui/
    app.ts           # TerminalUI 保持、2モード切り替え、グローバルキー
    terminal.ts      # stdin/stdout ラッパー、keypress/resize/alternate screen
    overview.ts      # Overviewモード（ANSI再描画 + 追加プロンプト）
    detail.ts        # Detailモード（PTYパススルー）
bin/
  mav.ts             # CLIエントリ（commander → src/index.ts）
tests/
  config.test.ts
  agent.test.ts      # node-pty をモック
  session-manager.test.ts
scripts/
  postbuild.mjs      # dist/bin/mav.js を chmod 755
```

## アーキテクチャの要点

### モード切り替え

`App`（`src/ui/app.ts`）が `overview` / `detail` の2モードを管理する。

- **Overviewモード**: `OverviewUI` が表示、全画面をANSIで再描画
- **Detailモード**: `DetailUI` が表示、全キーストロークを選択セッションのPTYに転送
- Detail から Overview へ戻るショートカットは `Ctrl+]`
- Detail の戻るキーは `App` の keypress 処理ではなく `DetailUI` の raw input listener 側で処理する
- 理由: Detail モードでは stdin 生入力を直接PTYへ流しており、通常の keypress ハンドリングでは取りこぼすため

### PTYイベントフロー

```
PTY.onData(chunk)
  → AgentSession.logBuffer に追記
  → AgentSession.emit('data', chunk)
    → SessionManager.emit('data', sessionId, chunk)
      → OverviewUI がログストリームを更新
    → DetailUI.dataListener がリアルタイム表示（Detailモード時）
```

### node-pty モック

`tests/agent.test.ts` では `vi.mock('node-pty', ...)` でモックする。`onData` / `onExit` のコールバック参照を外から操作することでPTYイベントを擬似的に発火できる。

`tests/session-manager.test.ts` では `vi.hoisted()` を使って `AgentSession` を `EventEmitter` ベースのモックに差し替える（`vi.mock` のホイスティング問題を回避するため）。

## コーディング規約

- コメントは「なぜ」が自明でない場合のみ書く
- `!` 非nullアサーションは配列アクセス等で安全が明らかな箇所のみ使う
- UIモジュールもロジックが分離できる範囲ではユニットテストを書く
- `DetailUI` の raw input は terminal 実装差分を吸収する。`Ctrl+]` は少なくとも raw control code `\x1d` と kitty/ghostty 系の `CSI u` 形式 `\x1b[93;5u` を戻るキーとして扱う

## テスト方針

- `config.ts` / `agent.ts` / `session-manager.ts` はユニットテスト必須
- `src/ui/` も入力変換やセッション選択のようなロジックはユニットテストで固定する
- ただし ANSI描画や端末依存の体験は手動確認も併用する
- テストを追加するときは必ず先にテストを書いて失敗を確認してから実装する（TDD）

## パッケージ管理

- `pnpm` のみ使用（`npm install` は実行しない）
- 新しい依存を追加する際は `pnpm add <pkg>` / `pnpm add -D <pkg>`
- `pnpm-workspace.yaml` の `minimumReleaseAge: 10080`（7日）は変更しない
- ネイティブビルドが必要なパッケージは `package.json` の `pnpm.onlyBuiltDependencies` に追加する

## ロックファイル管理

このプロジェクトは2つのロックファイルを持つ：

- `pnpm-lock.yaml` — 開発用（pnpm が管理）
- `package-lock.json` — Homebrew formula の `npm ci` 用

**依存関係を追加・更新したら必ず両方を更新すること：**

```bash
pnpm add <pkg>          # pnpm-lock.yaml を更新
npm install --package-lock-only --ignore-scripts  # package-lock.json を更新
```

`package-lock.json` を更新しないと Homebrew インストールが古いバージョンを使う。

## リリース手順

1. `package.json` のバージョンを更新
2. 依存関係変更があれば `package-lock.json` も更新（↑参照）
3. `git tag v<version>`
4. `git push origin main --tags`
5. GitHub Actions が自動でリリースを作成し `Formula/mav.rb` の SHA256を更新する
