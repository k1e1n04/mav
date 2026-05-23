import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'

export class OverviewUI {
  private screen: Widgets.Screen
  private manager: SessionManager
  private listBox: Widgets.ListElement
  private logBox: Widgets.BoxElement
  private inputBar: Widgets.TextboxElement
  private promptOpen = false

  constructor(screen: Widgets.Screen, manager: SessionManager) {
    this.screen = screen
    this.manager = manager

    this.listBox = blessed.list({
      parent: screen,
      top: 0,
      left: 0,
      width: '25%',
      height: '100%-3',
      border: { type: 'line' },
      label: ' AGENTS ',
      style: {
        selected: { bg: 'blue', fg: 'white' },
        border: { fg: 'cyan' },
      },
      keys: true,
      mouse: true,
    })

    this.logBox = blessed.box({
      parent: screen,
      top: 0,
      left: '25%',
      width: '75%',
      height: '100%-3',
      border: { type: 'line' },
      label: ' LOG STREAM ',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: '│' },
      style: { border: { fg: 'cyan' } },
      tags: true,
    })

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
      if (this.manager.sessions.length === 0) return
      const idx = Math.max(0, this.manager.selectedIndex - 1)
      this.manager.selectSession(idx)
      this.listBox.select(idx)
      this.screen.render()
    })

    this.listBox.key(['down', 'j'], () => {
      if (this.manager.sessions.length === 0) return
      const idx = Math.min(
        this.manager.sessions.length - 1,
        this.manager.selectedIndex + 1
      )
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

    this.listBox.key(['d', 'C-x'], () => {
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

    this.inputBar.on('cancel', () => {
      this.listBox.focus()
      this.screen.render()
    })
  }

  private showAddPrompt(): void {
    if (this.promptOpen) return
    this.promptOpen = true

    const agentTypes = ['claude-code', 'codex', 'gemini-cli', 'copilot']

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

    const close = () => {
      this.promptOpen = false
      prompt.destroy()
      this.listBox.focus()
      this.screen.render()
    }

    prompt.key('enter', () => {
      const selectedIdx = (prompt as unknown as { selected: number }).selected ?? 0
      const selected = agentTypes[selectedIdx]!
      close()

      const defaults: Record<string, { cmd: string; args: string[] }> = {
        'claude-code': { cmd: 'claude', args: [] },
        'codex': { cmd: 'codex', args: [] },
        'gemini-cli': { cmd: 'gemini', args: [] },
        'copilot': { cmd: 'gh', args: ['copilot', 'suggest'] },
      }
      const d = defaults[selected] ?? { cmd: selected, args: [] }
      const session = this.manager.addSession({ type: selected, cmd: d.cmd, args: d.args })

      if (session.status === 'error') {
        this.manager.removeSession(session.id)
        this.showError(`'${d.cmd}' command not found.\nIs ${selected} installed?`)
        this.syncList()
        return
      }

      this.syncList()
    })

    prompt.key('escape', close)

    prompt.focus()
    this.screen.render()
  }

  private showError(message: string): void {
    const overlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: message.split('\n').length + 4,
      border: { type: 'line' },
      label: ' Error ',
      content: `\n ${message.split('\n').join('\n ')}`,
      style: { border: { fg: 'red' }, label: { fg: 'red' } },
      keys: true,
      mouse: true,
    })
    overlay.key(['enter', 'escape', 'q'], () => {
      overlay.destroy()
      this.listBox.focus()
      this.screen.render()
    })
    overlay.focus()
    this.screen.render()
  }

  private syncList(): void {
    const items = this.manager.sessions.map((s) => {
      const statusIcon =
        s.status === 'running' ? '⣾'
        : s.status === 'idle'    ? '○'
        : s.status === 'done'    ? '✓'
        : '✗'
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
      // Combine recent chunks, strip all escape sequences, then split into lines
      const raw = session.logBuffer.slice(-30).join('')
      const stripped = raw
        .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '') // CSI
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')           // OSC
        .replace(/\x1b[A-Za-z]/g, '')                                  // two-char
        .replace(/\r/g, '\n')                                          // CR → newline for splitting
      const textLines = stripped
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .slice(-5) // last 5 non-empty lines per session
      for (const line of textLines) {
        lines.push(`{cyan-fg}[${session.id}]{/cyan-fg} ${line}`)
      }
    }
    this.logBox.setContent(lines.join('\n'))
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
