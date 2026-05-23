# mav — CLAUDE.md

## プロジェクト概要

`mav` は複数のAI coding assistant CLI を1つのターミナルで管理するラッパーCLI。各エージェントをPTY（疑似端末）サブプロセスとして起動し、Overviewダッシュボード＋Detailフルスクリーンで操作する。

## 技術スタック

- **言語**: TypeScript (Node.js, ESM)
- **TUI**: neo-blessed（blessedのフォーク、APIは同一）
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
  types/
    neo-blessed.d.ts # neo-blessed → blessed 型マッピング
  ui/
    app.ts           # blessed.screen 保持、2モード切り替え、グローバルキー
    overview.ts      # Overviewモード（エージェントリスト＋ログ＋入力バー）
    detail.ts        # Detailモード（PTYパススルー＋ヘッダー）
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

- **Overviewモード**: `OverviewUI` が表示、`listBox` にフォーカス
- **Detailモード**: `DetailUI` が表示、全キーストロークを選択セッションのPTYに転送
- `←` キーだけは `App` が横取りして `switchToOverview()` を呼ぶ

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
- blessed の型定義が不完全な箇所は `as unknown as T` でキャストする（`as any` は使わない）
- UIモジュール（`src/ui/`）のユニットテストは行わない（blessed のインスタンス化が困難なため手動確認）

## テスト方針

- `config.ts` / `agent.ts` / `session-manager.ts` はユニットテスト必須
- UIモジュール（`src/ui/`）は手動確認
- テストを追加するときは必ず先にテストを書いて失敗を確認してから実装する（TDD）

## パッケージ管理

- `pnpm` のみ使用（`npm install` は実行しない）
- 新しい依存を追加する際は `pnpm add <pkg>` / `pnpm add -D <pkg>`
- `pnpm-workspace.yaml` の `minimumReleaseAge: 10080`（7日）は変更しない
- ネイティブビルドが必要なパッケージは `package.json` の `pnpm.onlyBuiltDependencies` に追加する

## リリース手順

1. `package.json` のバージョンを更新
2. `git tag v<version>`
3. `git push origin main --tags`
4. GitHub Actions が自動でリリースを作成し `Formula/mav.rb` の SHA256を更新する
