# mav Neovim Integration Design

## 概要

`mav` の選択中セッションに合わせて、単一の Neovim インスタンスを自動追従させる。初版は `LazyVim` 向けの軽量 plugin として統合し、`mav` 側は選択中セッション情報を外部公開するだけに留める。

この設計は次の制約を前提にする。

- Neovim は 1 インスタンスのみ使う
- セッション切り替え時は自動追従したい
- repo を跨いだ切り替えも許可する
- `LSP` 再解析はゼロにはできないため、影響を `window-local cwd` と debounce で抑える

## ゴール

- `mav` で選択中のセッションを Neovim 側から参照できる
- 選択変更時に Neovim が自動で対象セッションの `cwd` へ追従する
- `LazyVim` 上で最小構成の plugin として導入できる
- `mav` 本体は terminal 依存の UI automation を持たない

## 非ゴール

- セッションごとに別 Neovim を起動すること
- Warp や tmux の tab/window を自動で前面化すること
- セッション内で実行された `cd` を完全にリアルタイム追跡すること
- repo 跨ぎ時の `LSP` 再解析を完全になくすこと

## 全体アーキテクチャ

```
mav
  -> selected session state file (JSON)
  -> LazyVim plugin poll / read
  -> debounce
  -> Neovim current window に lcd
```

責務の分離は明確にする。

- `mav`: 選択中セッション情報の生成と保存
- `LazyVim plugin`: 状態読取、変更検知、follow 制御
- Neovim 本体: `lcd` による window-local な作業ディレクトリ切り替え

## mav 側設計

### 公開 state file

`mav` は専用 JSON ファイルを更新する。

- パス: `~/.local/state/mav/current-session.json`
- 上書き更新とする
- `state.json` とは分離し、Neovim 連携専用ファイルとして扱う

### JSON 形式

```json
{
  "sessionId": "codex#1",
  "agentType": "codex",
  "displayName": "fix auth redirect",
  "cwd": "/Users/ishiiken/Develop/project-a",
  "updatedAt": "2026-05-23T12:34:56.000Z"
}
```

各項目の意味は次の通り。

- `sessionId`: `mav` 内の一意なセッション ID
- `agentType`: `claude-code` / `codex` / `gemini-cli` / `copilot`
- `displayName`: Overview に表示している人間向けラベル
- `cwd`: Neovim が follow 先に使う絶対パス
- `updatedAt`: 変更検知用タイムスタンプ

### 更新タイミング

次のタイミングで `current-session.json` を更新する。

- `selectedIndex` が変化した時
- 選択中セッションが削除され、別セッションへ選択が移った時
- 初回起動後、最初の選択セッションが確定した時

### cwd の扱い

初版では `cwd` を「セッション起動時のカレントディレクトリ」とする。

理由は次の通り。

- 既存の `AgentSession` は shell 内部の `cd` を追跡していない
- まずは安定した最小実装で `mav` と Neovim の連携面を固めたい
- 将来 `cwd` 追跡を足しても JSON 契約を変えずに拡張できる

そのため、同一セッション内でユーザーが `cd` した後は、Neovim の follow 先と実際の shell `cwd` がズレる可能性は残る。これは既知の制約として明示する。

## Neovim / LazyVim plugin 設計

### 目的

plugin は `mav` の state file を読み、選択変更を検知したら現在 window を対象セッションの `cwd` へ自動追従させる。

### 想定構成

```text
lua/
  mav/
    init.lua
    state.lua
    follow.lua
  plugins/
    mav.lua
```

### 設定項目

```lua
{
  state_file = vim.fn.expand("~/.local/state/mav/current-session.json"),
  auto_follow = true,
  debounce_ms = 500,
  notify_on_switch = true,
  ignore_filetypes = {},
}
```

初版で必要なのは以下。

- `state_file`: 監視対象 JSON
- `auto_follow`: 自動追従の有効化
- `debounce_ms`: 選択移動連打時の過剰反応防止
- `notify_on_switch`: 切り替え通知の有無
- `ignore_filetypes`: follow を抑止したい filetype 一覧

### 状態読取

plugin は一定間隔で `state_file` を poll する。

- `updatedAt` が前回値と変わっていなければ何もしない
- 変化していれば debounce 後に follow を実行する
- ファイルが存在しない場合は何もしない
- JSON 破損時は通知せず無視するか、必要なら debug 用ログのみ出す

`fs_event` 監視より poll を優先する理由は、構成を単純に保ち、macOS / Linux 間の差異を避けるため。

### follow 動作

follow 時はグローバル `:cd` を使わず、現在 window に対して `:lcd` を適用する。

処理順は次を想定する。

1. `ignore_filetypes` に該当するなら中断
2. `cwd` が存在しなければ中断
3. `vim.cmd.lcd(cwd)` を実行
4. 必要なら通知を出す

この方針により、Neovim 全体ではなく「今見ている window」だけを追従させる。

### UI 露出

初版では次の API を提供する。

- 現在の `mav` session 名を返す Lua 関数
- `:MavStatus` コマンド
- `:MavFollowNow` コマンド

用途は次の通り。

- statusline / winbar への表示
- 自動 follow が無効な時の手動同期
- 問題切り分け時の状態確認

## LSP への影響

### 前提

repo を跨いで単一 Neovim を自動追従させる以上、`LSP` の再 attach や再解析は起こり得る。これは初版では受け入れる。

### 緩和策

初版で入れる緩和策は次の2つ。

- `lcd` による window-local `cwd` 切り替え
- debounce による過剰な切り替え抑制

これで避けられるのは主に次の問題。

- Overview 上で選択を上下しただけで何度も follow が走る
- グローバル `cwd` 切り替えにより他 window まで巻き込む

### 将来拡張

必要なら後から次を追加できる。

- `ignore_filetypes`
- `ignore_repos`
- 特定 repo だけ通知のみで follow しないモード
- セッション内 `cd` を追跡して `cwd` をより正確にする

## 変更対象

### mav

- `src/agent.ts`
  - セッション起動時 `cwd` を保持できるようにする
- `src/session-manager.ts`
  - 選択変更のタイミングで外部 state 更新を呼べるようにする
- `src/ui/app.ts`
  - Overview 操作経由の選択変化後に公開 state を反映する
- `src/index.ts`
  - state file の保存先初期化

### LazyVim plugin

このリポジトリには含めないが、別途次の最小 plugin を想定する。

- `lua/mav/init.lua`
- `lua/mav/state.lua`
- `lua/mav/follow.lua`
- `lua/plugins/mav.lua`

## テスト方針

`mav` 側はユニットテストで担保する。

- 選択変更時に `current-session.json` が更新される
- 初回起動時に選択中セッションが書き出される
- セッション削除で選択対象が変わった時に更新される
- `cwd` が起動時ディレクトリとして保存される

Neovim plugin 側は初版では手動確認を前提にする。

- `mav` で session を切り替える
- Neovim で `lcd` 先が変わる
- repo 跨ぎでも current window だけが追従する
- 激しく移動しても debounce が効く

## 受け入れ条件

- `mav` 実行中に `current-session.json` が生成・更新される
- JSON には選択中セッションの `sessionId`, `agentType`, `displayName`, `cwd`, `updatedAt` が入る
- `LazyVim` plugin がその JSON を読んで現在 window を `lcd` で追従できる
- repo 跨ぎでも自動追従が動く
- `mav` 本体は Warp など特定 terminal の API に依存しない

## 懸念事項

- 初版の `cwd` はセッション起動時の値なので、shell 内 `cd` を追従できない
- repo 跨ぎの自動 follow は言語サーバによっては体感コストが大きい
- poll 間隔次第では切り替え体感に遅延が出る

このため、初版は「シンプルで壊れにくい経路を先に作る」ことを優先し、その上で `cwd` 精度や follow 条件を後から調整できる構造にしておく。
