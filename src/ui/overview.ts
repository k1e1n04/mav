import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'
import type { AgentSession } from '../agent.js'
import { getAgentDefaults, resolveSessionArgs } from '../agent-launch.js'

export class OverviewUI {
  private static readonly STATUS_GROUPS = [
    { status: 'running', label: 'Working' },
    { status: 'idle', label: 'Waiting' },
    { status: 'done', label: 'Complete' },
    { status: 'error', label: 'Failed' },
  ] as const
  private static readonly STATUS_COLORS = {
    running: 'cyan',
    idle: 'yellow',
    done: 'green',
    error: 'red',
  } as const

  private screen: Widgets.Screen
  private manager: SessionManager
  private onSessionCreated?: (session: SessionManager['selectedSession']) => void
  private listBox: Widgets.ListElement
  private promptOpen = false

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
      width: '100%',
      height: '100%',
      border: { type: 'line' },
      label: ' AGENTS ',
      tags: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        border: { fg: 'cyan' },
      },
      keys: true,
      mouse: true,
    })

    this.bindKeys()
    this.syncList()

    manager.on('data', (sessionId: string) => {
      if (sessionId !== this.manager.selectedSession?.id) {
        return
      }
      this.syncList()
      screen.render()
    })

    manager.on('exit', () => {
      this.syncList()
      screen.render()
    })

    manager.on('status', () => {
      this.syncList()
      screen.render()
    })

    manager.on('name', () => {
      this.syncList()
      screen.render()
    })
  }

  private bindKeys(): void {
    this.listBox.key(['up', 'k'], () => {
      if (this.manager.sessions.length === 0) return
      this.moveSelection(-1)
      this.syncList()
      this.screen.render()
    })

    this.listBox.key(['down', 'j'], () => {
      if (this.manager.sessions.length === 0) return
      this.moveSelection(1)
      this.syncList()
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

      const defaults = getAgentDefaults(selected)
      const { args, newSessionId } = resolveSessionArgs(selected, defaults.args, undefined, false)
      const session = this.manager.addSession({
        type: selected,
        cmd: defaults.cmd,
        args,
        cwd: process.cwd(),
      }) as AgentSession & { sessionId?: string }
      session.baseArgs = defaults.args
      if (newSessionId != null) {
        session.sessionId = newSessionId
      }

      if (session.status === 'error') {
        this.manager.removeSession(session.id)
        this.showError(`'${defaults.cmd}' command not found.\nIs ${selected} installed?`)
        this.syncList()
        return
      }

      this.manager.selectSession(this.manager.sessions.length - 1)
      this.syncList()
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
    const orderedSessions = this.getOrderedSessions()

    const items: string[] = []
    const selectedId = this.manager.selectedSession?.id
    let selectedDisplayIndex = -1

    for (const group of OverviewUI.STATUS_GROUPS) {
      const sessions = orderedSessions.filter((session) => session.status === group.status)
      if (sessions.length === 0) continue

      items.push(` ${group.label}`)
      for (const session of sessions) {
        const statusIcon =
          session.status === 'running' ? '⣾'
          : session.status === 'idle'    ? '○'
          : session.status === 'done'    ? '✓'
          : '✗'
        const sessionTitle = session.displayName ?? session.id
        const sessionLabel = session.type ? `${sessionTitle} (${session.type})` : sessionTitle
        const content = `${statusIcon} ${sessionLabel}  ${this.getStatusLabel(session.status)}`
        const color = OverviewUI.STATUS_COLORS[session.status]
        items.push(` {${color}-fg}${content}{/${color}-fg}`)
        if (session.id === selectedId) {
          selectedDisplayIndex = items.length - 1
        }
      }
    }

    this.listBox.setItems(items)
    if (selectedDisplayIndex >= 0) {
      this.listBox.select(selectedDisplayIndex)
    }
  }

  private getOrderedSessions(): SessionManager['sessions'] {
    return [...this.manager.sessions].sort((a, b) => {
      const rankDiff = this.getStatusRank(a.status) - this.getStatusRank(b.status)
      if (rankDiff !== 0) return rankDiff
      return a.id.localeCompare(b.id)
    })
  }

  private moveSelection(direction: -1 | 1): void {
    const orderedSessions = this.getOrderedSessions()
    const selectedId = this.manager.selectedSession?.id
    const currentIndex = selectedId
      ? orderedSessions.findIndex((session) => session.id === selectedId)
      : -1
    const nextIndex = currentIndex === -1
      ? 0
      : Math.max(0, Math.min(orderedSessions.length - 1, currentIndex + direction))
    const nextSession = orderedSessions[nextIndex]
    if (!nextSession) return

    const managerIndex = this.manager.sessions.findIndex((session) => session.id === nextSession.id)
    if (managerIndex >= 0) {
      this.manager.selectSession(managerIndex)
    }
  }

  private getStatusLabel(status: string): string {
    switch (status) {
      case 'running':
        return 'working'
      case 'idle':
        return 'waiting'
      case 'done':
        return 'complete'
      case 'error':
        return 'failed'
      default:
        return status
    }
  }

  private getStatusRank(status: string): number {
    switch (status) {
      case 'running':
        return 0
      case 'idle':
        return 1
      case 'done':
        return 2
      case 'error':
        return 3
      default:
        return 99
    }
  }

  show(): void {
    this.listBox.show()
    this.listBox.focus()
    this.syncList()
    this.screen.render()
  }

  isPromptOpen(): boolean {
    return this.promptOpen
  }

  resizeSelectedSession(): void {
    this.syncList()
  }

  hide(): void {
    this.listBox.hide()
  }
}
