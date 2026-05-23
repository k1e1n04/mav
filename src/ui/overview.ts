import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'

type TerminalWidget = Widgets.BoxElement & {
  write(data: string): void
  destroy(): void
  setLabel(label: string): void
}

export class OverviewUI {
  private static readonly LIST_WIDTH_RATIO = 0.25
  private static readonly INPUT_BAR_HEIGHT = 3
  private static readonly BORDER_SIZE = 2
  private static readonly OSC_SEQUENCE_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
  private static readonly ALT_SCREEN_PATTERN = /\x1b\[\?104[79][hl]|\x1b\[\?47[hl]/g
  private static readonly DEVICE_CONTROL_PATTERN = /\x1b\[(?:>?\d*c|\?u|>q|\?\d+\$p)/g
  private static readonly VIEWPORT_CONTROL_PATTERN = /\x1b\[[0-9;?]*[ABCDHJKSTfhlsu]/g
  private static readonly DEC_CURSOR_PATTERN = /\x1b[78]/g

  private screen: Widgets.Screen
  private manager: SessionManager
  private onSessionCreated?: (session: SessionManager['selectedSession']) => void
  private listBox: Widgets.ListElement
  private detailTerminal: TerminalWidget
  private inputBar: Widgets.TextboxElement
  private promptOpen = false
  private detailSessionId: string | null = null

  constructor(
    screen: Widgets.Screen,
    manager: SessionManager,
    onSessionCreated?: (session: SessionManager['selectedSession']) => void
  ) {
    this.screen = screen
    this.manager = manager
    this.onSessionCreated = onSessionCreated

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

    this.detailTerminal = this.createDetailTerminal()

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

    manager.on('data', (sessionId: string, chunk: string) => {
      if (sessionId !== this.manager.selectedSession?.id) {
        return
      }
      this.ensureDetailSession()
      this.detailTerminal.write(this.sanitizeOverviewOutput(chunk))
      screen.render()
    })

    manager.on('exit', () => {
      this.syncList()
      this.refreshDetail()
      screen.render()
    })
  }

  private createDetailTerminal(): TerminalWidget {
    return blessed.terminal({
      parent: this.screen,
      top: 0,
      left: '25%',
      width: '75%',
      height: '100%-3',
      border: { type: 'line' },
      label: ' DETAIL ',
      cursor: 'block',
      cursorBlink: false,
      screenKeys: false,
      handler: () => {},
      style: { border: { fg: 'cyan' } },
    }) as unknown as TerminalWidget
  }

  private bindKeys(): void {
    this.listBox.key(['up', 'k'], () => {
      if (this.manager.sessions.length === 0) return
      const idx = Math.max(0, this.manager.selectedIndex - 1)
      this.manager.selectSession(idx)
      this.listBox.select(idx)
      this.refreshDetail()
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
      this.refreshDetail()
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
        this.refreshDetail()
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
        'copilot': { cmd: 'copilot', args: [] },
      }
      const d = defaults[selected] ?? { cmd: selected, args: [] }
      const session = this.manager.addSession({ type: selected, cmd: d.cmd, args: d.args })

      if (session.status === 'error') {
        this.manager.removeSession(session.id)
        this.showError(`'${d.cmd}' command not found.\nIs ${selected} installed?`)
        this.syncList()
        return
      }

      this.manager.selectSession(this.manager.sessions.length - 1)
      this.syncList()
      this.refreshDetail()
      this.onSessionCreated?.(session)
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

  private setDetailLabel(): void {
    const session = this.manager.selectedSession
    if (!session) {
      this.detailTerminal.setLabel(' DETAIL ')
      return
    }

    this.detailTerminal.setLabel(` DETAIL ${session.id} ${session.status} `)
  }

  private rebuildDetailTerminal(): void {
    this.detailTerminal.destroy()
    this.detailTerminal = this.createDetailTerminal()
  }

  private getDetailViewportSize(): { cols: number; rows: number } {
    const screenWidth = Number(this.screen.width) || 80
    const screenHeight = Number(this.screen.height) || 24
    const listWidth = Math.floor(screenWidth * OverviewUI.LIST_WIDTH_RATIO)
    const detailWidth = Math.max(1, screenWidth - listWidth)
    const detailHeight = Math.max(1, screenHeight - OverviewUI.INPUT_BAR_HEIGHT)

    return {
      cols: Math.max(1, detailWidth - OverviewUI.BORDER_SIZE),
      rows: Math.max(1, detailHeight - OverviewUI.BORDER_SIZE),
    }
  }

  private resizeSessionToDetail(session: SessionManager['selectedSession']): void {
    if (!session || typeof session.resize !== 'function') {
      return
    }

    const { cols, rows } = this.getDetailViewportSize()
    session.resize(cols, rows)
  }

  private sanitizeOverviewOutput(output: string): string {
    return output
      .replace(OverviewUI.OSC_SEQUENCE_PATTERN, '')
      .replace(OverviewUI.ALT_SCREEN_PATTERN, '')
      .replace(OverviewUI.DEVICE_CONTROL_PATTERN, '')
      .replace(OverviewUI.VIEWPORT_CONTROL_PATTERN, '')
      .replace(OverviewUI.DEC_CURSOR_PATTERN, '')
  }

  private ensureDetailSession(): void {
    const selectedId = this.manager.selectedSession?.id ?? null
    if (this.detailSessionId === selectedId) {
      this.setDetailLabel()
      return
    }
    this.refreshDetail()
  }

  private refreshDetail(): void {
    this.rebuildDetailTerminal()
    this.detailSessionId = this.manager.selectedSession?.id ?? null
    this.setDetailLabel()

    const session = this.manager.selectedSession
    this.resizeSessionToDetail(session)
    if (!session) {
      this.detailTerminal.write('No agents running.\r\n\r\nPress "n" to add a session.\r\n')
      return
    }

    const safeLog = this.sanitizeOverviewOutput(session.logBuffer.join(''))
    this.detailTerminal.write(safeLog)
  }

  show(): void {
    this.listBox.show()
    this.detailTerminal.show()
    this.inputBar.show()
    this.listBox.focus()
    this.syncList()
    this.refreshDetail()
    this.screen.render()
  }

  isPromptOpen(): boolean {
    return this.promptOpen
  }

  resizeSelectedSession(): void {
    this.resizeSessionToDetail(this.manager.selectedSession)
  }

  hide(): void {
    this.listBox.hide()
    this.detailTerminal.hide()
    this.inputBar.hide()
  }
}
