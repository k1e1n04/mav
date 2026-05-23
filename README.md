# mav — multi-agent view

`mav` is a wrapper CLI that lets you manage multiple AI coding assistant CLIs such as `claude-code`, `codex`, `gemini-cli`, and `copilot` from a single terminal window.

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

## Features

- See multiple AI agent sessions at a glance in one screen
- Overview groups sessions under `Working / Waiting / Complete / Failed`
- Open the selected agent in fullscreen with `→` / `Enter`
- Define startup agents freely with YAML
- No API key required, as it uses your existing CLI tools directly

## Installation

### Homebrew (Recommended)

```bash
brew tap k1e1n04/mav
brew install mav
```

### npm / pnpm

```bash
npm install -g mav
# or
pnpm add -g mav
```

### Build from Source

```bash
git clone https://github.com/k1e1n04/mav.git
cd mav
pnpm install
pnpm build
pnpm link --global
```

## Usage

```bash
mav                          # Start all agents from the config file
mav --agent claude-code      # Start only the specified agent type
mav --config ./mav.yaml      # Use a custom config file path
mav --version
mav --help
```

If no config file exists at `~/.config/mav/config.yaml`, `mav` starts only `claude`.

## Configuration

Create `~/.config/mav/config.yaml`.

```yaml
agents:
  - type: claude-code
    cmd: claude-launcher   # Override the default "claude" command
    args: []
  - type: codex
    # If cmd is omitted, the default "codex" command is used
  - type: gemini-cli
    cmd: gemini
  - type: copilot
    cmd: gh
    args: []
```

### Default Commands by Agent Type

| type | default cmd |
|------|----------------|
| `claude-code` | `claude` |
| `codex` | `codex` |
| `gemini-cli` | `gemini` |
| `copilot` | `copilot` |

## Keybindings

| Key | Scope | Action |
|------|----------|------|
| `↑` `↓` | Overview | Move through the session list |
| `→` / `Enter` | Overview | Open the selected session in fullscreen |
| `Ctrl+]` | Detail | Return to Overview |
| `n` | Overview | Add a new session |
| `d` | Overview | Terminate and remove the selected session |
| `q` / `Ctrl+C` | Overview | Quit `mav` and terminate all sessions |

> **Note:** Overview is a progress dashboard. For input and full terminal interaction, use Detail mode. In Detail mode, keys including `←` are passed directly to the agent, so use `Ctrl+]` to return to Overview.

## Neovim Integration

`mav` writes the currently selected session to `~/.local/state/mav/current-session.json`.
This file is intended for editor integrations such as Neovim plugins that want to follow the active session's working directory.

### How the Neovim Plugin Is Provided

This repository now includes a Neovim plugin.

- `mav` publishes the selected session state as JSON
- the bundled Neovim plugin reads that file
- the plugin can follow the selected session by running `:lcd` into its `cwd`

In other words, the stable interface is the state file:

```text
~/.local/state/mav/current-session.json
```

The JSON contains:

```json
{
  "sessionId": "codex#1",
  "agentType": "codex",
  "displayName": "fix auth redirect",
  "cwd": "/Users/you/Develop/project-a",
  "updatedAt": "2026-05-23T12:34:56.000Z"
}
```

The plugin runtime is included in this repo under:

```text
lua/mav/
plugin/mav.lua
```

### Installation with LazyVim / lazy.nvim

Add this to `lua/plugins/mav.lua` in your Neovim config:

```lua
return {
  {
    "k1e1n04/mav",
    opts = {
      auto_follow = true,
      poll_interval_ms = 500,
      notify_on_switch = false,
      ignore_filetypes = {},
    },
    config = function(_, opts)
      require("mav").setup(opts)
    end,
  },
}
```

### How to Use It

1. Start `mav`.
2. Install the plugin from this repo in Neovim using the `lazy.nvim` example above.
3. Restart Neovim or reload your plugin config.
4. Change the selected session in `mav`.
5. Neovim will follow the selected session's startup `cwd`.

The plugin exposes:

- `:MavFollowNow` to force an immediate refresh
- `:MavStatus` to print the current selected session name, agent type, and `cwd`

### Plugin Options

```lua
{
  state_file = vim.fn.expand("~/.local/state/mav/current-session.json"),
  auto_follow = true,
  poll_interval_ms = 500,
  notify_on_switch = false,
  ignore_filetypes = {},
}
```

- `state_file`: path to the `mav` state file to watch
- `auto_follow`: whether polling should automatically update the current window cwd
- `poll_interval_ms`: polling interval in milliseconds
- `notify_on_switch`: show a Neovim notification when the followed session changes
- `ignore_filetypes`: filetypes where follow should be skipped

### Current Limitation

The published `cwd` is the session startup directory, not a live shell-tracked directory. If you `cd` inside the agent session after launch, Neovim will still follow the original startup path.

## Requirements

- Node.js 20+
- Supported platforms: macOS and Linux

## Contributing

1. Fork the repository and run `git checkout -b feat/your-feature`
2. Make your changes and add tests with `pnpm test`
3. Commit with `git commit -m "feat: your feature"`
4. Open a pull request

## License

MIT. See [LICENSE](LICENSE) for details.
