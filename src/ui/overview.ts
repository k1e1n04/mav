import type { SessionManager } from '../session-manager.js'
import type { AgentSession } from '../agent.js'
import type { AgentConfig } from '../config.js'
import { getAgentDefaults, resolveSessionArgs } from '../agent-launch.js'
import { buildHookArgs } from '../hook-injector.js'
import { completePath } from './path-completion.js'
import type { KeyInfo, TerminalUI } from './terminal.js'

type PromptState =
  | { mode: 'agent'; selectedIndex: number }
  | { mode: 'cwd'; agentType: string; value: string; candidates: string[] }
  | { mode: 'rename'; sessionId: string; value: string }
  | { mode: 'error'; message: string }
  | null

export class OverviewUI {
  private static readonly HORIZONTAL_MARGIN = 1

  private static readonly ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    fgSlate: '\x1b[38;5;245m',
    fgGreen: '\x1b[38;5;42m',
    fgAmber: '\x1b[38;5;221m',
    fgCyan: '\x1b[38;5;81m',
    fgRed: '\x1b[38;5;203m',
  } as const

  private static readonly STATUS_GROUPS = [
    { status: 'running', label: 'Working' },
    { status: 'idle', label: 'Waiting' },
    { status: 'done', label: 'Complete' },
    { status: 'error', label: 'Failed' },
  ] as const

  private static readonly AGENT_TYPES = ['claude-code', 'codex', 'gemini-cli', 'copilot', 'cursor', 'opencode', 'antigravity-cli'] as const

  private terminal: TerminalUI
  private manager: SessionManager
  private onSessionCreated?: (session: SessionManager['selectedSession']) => void
  private agentConfigs: AgentConfig[]
  private socketPath: string | undefined
  private promptState: PromptState = null
  private displaySessionIds: string[] = []
  private visible = false

  constructor(
    terminal: TerminalUI,
    manager: SessionManager,
    onSessionCreated?: (session: SessionManager['selectedSession']) => void,
    agentConfigs: AgentConfig[] = [],
    socketPath?: string,
  ) {
    this.terminal = terminal
    this.manager = manager
    this.onSessionCreated = onSessionCreated
    this.agentConfigs = agentConfigs
    this.socketPath = socketPath

    this.syncList()

    manager.on('data', (sessionId: string) => {
      if (sessionId !== this.manager.selectedSession?.id) {
        return
      }
      this.syncList()
      this.render()
    })

    manager.on('exit', () => {
      this.syncList()
      this.render()
    })

    manager.on('status', () => {
      this.syncList()
      this.render()
    })

    manager.on('name', () => {
      this.syncList()
      this.render()
    })

    manager.on('selection', () => {
      this.syncList()
      this.render()
    })
  }

  handleKeypress(str: string, key: KeyInfo): void {
    if (this.promptState?.mode === 'agent') {
      this.handleAgentPromptKeypress(key)
      return
    }
    if (this.promptState?.mode === 'cwd') {
      this.handleCwdPromptKeypress(key)
      return
    }
    if (this.promptState?.mode === 'rename') {
      this.handleRenamePromptKeypress(key)
      return
    }
    if (this.promptState?.mode === 'error') {
      if (key.name === 'enter' || key.name === 'return' || key.name === 'escape' || str === 'q') {
        this.promptState = null
        this.render()
      }
      return
    }

    if ((key.name === 'up' || str === 'k') && this.manager.sessions.length > 0) {
      this.moveSelection(-1)
      return
    }

    if ((key.name === 'down' || str === 'j') && this.manager.sessions.length > 0) {
      this.moveSelection(1)
      return
    }

    if (str === 'n') {
      this.showAddPrompt()
      return
    }

    if (str === 'e') {
      this.showRenamePrompt()
      return
    }

    if (str === 'd' || (key.ctrl && key.name === 'x')) {
      const session = this.manager.selectedSession
      if (session) {
        this.manager.removeSession(session.id)
        this.syncList()
        this.render()
      }
    }
  }

  private handleAgentPromptKeypress(key: KeyInfo): void {
    const state = this.promptState
    if (!state || state.mode !== 'agent') return

    if (key.name === 'escape') {
      this.promptState = null
      this.render()
      return
    }

    if (key.name === 'up') {
      state.selectedIndex =
        (state.selectedIndex - 1 + OverviewUI.AGENT_TYPES.length) % OverviewUI.AGENT_TYPES.length
      this.render()
      return
    }

    if (key.name === 'down') {
      state.selectedIndex = (state.selectedIndex + 1) % OverviewUI.AGENT_TYPES.length
      this.render()
      return
    }

    if (key.name === 'enter' || key.name === 'return') {
      const agentType = OverviewUI.AGENT_TYPES[state.selectedIndex]!
      this.promptState = {
        mode: 'cwd',
        agentType,
        value: process.cwd(),
        candidates: [],
      }
      this.render()
    }
  }

  private handleCwdPromptKeypress(key: KeyInfo): void {
    const state = this.promptState
    if (!state || state.mode !== 'cwd') return

    if (key.name === 'escape') {
      this.promptState = null
      this.render()
      return
    }

    if (key.name === 'enter' || key.name === 'return') {
      const expanded = state.value.trim().replace(/^~/, process.env.HOME ?? '~') || process.cwd()
      const agentType = state.agentType
      this.promptState = null
      this.render()
      this.spawnAgent(agentType, expanded)
      return
    }

    if (key.name === 'tab') {
      const { completed, candidates } = completePath(state.value)
      state.value = completed
      state.candidates = candidates
      this.render()
      return
    }

    state.candidates = []

    if (key.name === 'backspace') {
      state.value = state.value.slice(0, -1)
      this.render()
      return
    }

    if (!key.ctrl && !key.meta && key.sequence?.length === 1) {
      state.value += key.sequence
      this.render()
    }
  }

  private handleRenamePromptKeypress(key: KeyInfo): void {
    const state = this.promptState
    if (!state || state.mode !== 'rename') return

    if (key.name === 'escape') {
      this.promptState = null
      this.render()
      return
    }

    if (key.name === 'enter' || key.name === 'return') {
      const session = this.manager.sessions.find((candidate) => candidate.id === state.sessionId)
      const value = state.value.trim()
      this.promptState = null
      if (session && value.length >= 3) {
        if ('setDisplayName' in session && typeof session.setDisplayName === 'function') {
          session.setDisplayName(value)
        } else {
          session.displayName = value
        }
      }
      this.syncList()
      this.render()
      return
    }

    if (key.name === 'backspace') {
      state.value = state.value.slice(0, -1)
      this.render()
      return
    }

    if (!key.ctrl && !key.meta && key.sequence?.length === 1) {
      state.value += key.sequence
      this.render()
    }
  }

  private showAddPrompt(): void {
    if (this.promptState) return
    this.promptState = { mode: 'agent', selectedIndex: 0 }
    this.render()
  }

  private showRenamePrompt(): void {
    if (this.promptState) return
    const session = this.manager.selectedSession
    if (!session) return
    this.promptState = {
      mode: 'rename',
      sessionId: session.id,
      value: session.displayName ?? session.id,
    }
    this.render()
  }

  private spawnAgent(agentType: string, cwd: string): void {
    const config = this.agentConfigs.find((candidate) => candidate.type === agentType)
    const defaults = config ?? {
      type: agentType,
      ...getAgentDefaults(agentType),
    }
    const { args, newSessionId } = resolveSessionArgs(agentType, defaults.args, undefined, false)

    let hookedArgs = args
    let hookFiles: string[] = []
    if (this.socketPath) {
      try {
        const hookCmd = `mav report cwd "$(pwd)"`
        const hookResult = buildHookArgs(agentType, args, hookCmd, { cwd, cmd: defaults.cmd, settingsFile: config?.settingsFile })
        hookedArgs = hookResult.args
        hookFiles = hookResult.hookFiles
      } catch {
        // hook injection failed — start agent without hooks
      }
    }

    const ipcContext = this.socketPath ? { socketPath: this.socketPath, hookFiles } : undefined
    const session = this.manager.addSession({
      type: agentType,
      cmd: defaults.cmd,
      args: hookedArgs,
      cwd,
    }, ipcContext) as AgentSession & { sessionId?: string }
    session.baseArgs = defaults.args
    if (newSessionId != null) {
      session.sessionId = newSessionId
    }

    if (session.status === 'error') {
      this.manager.removeSession(session.id)
      this.showError(`'${defaults.cmd}' command not found.\nIs ${agentType} installed?`)
      this.syncList()
      return
    }

    this.manager.selectSession(this.manager.sessions.length - 1)
    this.syncList()
    this.onSessionCreated?.(session)
  }

  private showError(message: string): void {
    this.promptState = { mode: 'error', message }
    this.render()
  }

  private syncList(): void {
    const orderedSessions = this.getOrderedSessions()
    this.displaySessionIds = orderedSessions.map((session) => session.id)
  }

  private groupByCwd(sessions: SessionManager['sessions']): Map<string, SessionManager['sessions']> {
    const map = new Map<string, SessionManager['sessions']>()
    for (const session of sessions) {
      const key = session.cwd ?? process.cwd()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(session)
    }
    return map
  }

  private shortenPath(p: string): string {
    const home = process.env.HOME
    if (home && p.startsWith(home)) {
      return '~' + p.slice(home.length)
    }
    return p
  }

  private getOrderedSessions(): SessionManager['sessions'] {
    return [...this.manager.sessions].sort((a, b) => {
      const cwdA = a.cwd ?? process.cwd()
      const cwdB = b.cwd ?? process.cwd()
      const cwdDiff = cwdA.localeCompare(cwdB)
      if (cwdDiff !== 0) return cwdDiff
      const rankDiff = this.getStatusRank(a.status) - this.getStatusRank(b.status)
      if (rankDiff !== 0) return rankDiff
      return a.id.localeCompare(b.id)
    })
  }

  private moveSelection(direction: -1 | 1): void {
    const selectedId = this.manager.selectedSession?.id
    if (this.displaySessionIds.length === 0) return

    const currentIndex = selectedId ? this.displaySessionIds.indexOf(selectedId) : -1
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + direction + this.displaySessionIds.length) % this.displaySessionIds.length
    const nextSessionId = this.displaySessionIds[nextIndex]
    if (!nextSessionId) return

    const managerIndex = this.manager.sessions.findIndex((session) => session.id === nextSessionId)
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

  private countByStatus(status: string): number {
    return this.manager.sessions.filter((session) => session.status === status).length
  }

  private stripAnsi(value: string): string {
    return value.replace(/\x1b\[[0-9;]*m/g, '')
  }

  private visibleLength(value: string): number {
    return this.stripAnsi(value).length
  }

  private getRenderWidth(): number {
    return Math.max(20, this.terminal.cols || 80)
  }

  private getContentWidth(): number {
    return Math.max(10, this.getRenderWidth() - (OverviewUI.HORIZONTAL_MARGIN * 2))
  }

  private insetLine(line: string): string {
    if (line.length === 0) return ''
    return `${' '.repeat(OverviewUI.HORIZONTAL_MARGIN)}${line}`
  }

  private finalizeLines(lines: string[]): string[] {
    const maxWidth = this.getRenderWidth()
    return lines.map((line) => {
      const inset = this.insetLine(line)
      return this.fitVisible(inset, maxWidth)
    })
  }

  private padRight(value: string, width: number): string {
    const visibleLength = this.visibleLength(value)
    if (visibleLength >= width) {
      return value
    }
    return value + ' '.repeat(width - visibleLength)
  }

  private fitPlain(value: string, width: number): string {
    if (width <= 0) return ''
    if (value.length <= width) return value
    if (width === 1) return '…'
    return `${value.slice(0, width - 1)}…`
  }

  private fitVisible(value: string, width: number): string {
    const plain = this.stripAnsi(value)
    return plain.length <= width ? value : this.fitPlain(plain, width)
  }

  private color(text: string, ...codes: string[]): string {
    return `${codes.join('')}${text}${OverviewUI.ANSI.reset}`
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case 'running':
        return OverviewUI.ANSI.fgGreen
      case 'idle':
        return OverviewUI.ANSI.fgAmber
      case 'done':
        return OverviewUI.ANSI.fgCyan
      case 'error':
        return OverviewUI.ANSI.fgRed
      default:
        return OverviewUI.ANSI.fgSlate
    }
  }

  private makeRule(label: string, width = this.getRenderWidth()): string {
    const text = ` ${label} `
    if (text.length >= width) {
      return this.fitPlain(text, width)
    }
    const fill = '─'.repeat(width - text.length)
    return text + fill
  }

  private wrapPlainText(text: string, width: number): string[] {
    if (width <= 0) return ['']
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length === 0) return ['']

    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length <= width) {
        current = next
        continue
      }

      if (current) {
        lines.push(current)
        current = ''
      }

      if (word.length <= width) {
        current = word
      } else {
        lines.push(this.fitPlain(word, width))
      }
    }

    if (current) {
      lines.push(current)
    }

    return lines
  }

  private wrapPathText(text: string, width: number): string[] {
    if (width <= 0) return ['']
    if (text.length <= width) return [text]

    const lines: string[] = []
    let remaining = text

    while (remaining.length > width) {
      const slice = remaining.slice(0, width + 1)
      const breakIndex = slice.lastIndexOf('/')
      if (breakIndex > 0) {
        lines.push(remaining.slice(0, breakIndex))
        remaining = remaining.slice(breakIndex)
        continue
      }

      lines.push(remaining.slice(0, width))
      remaining = remaining.slice(width)
    }

    if (remaining.length > 0) {
      lines.push(remaining)
    }

    return lines
  }

  private wrapVisibleParts(parts: string[], width: number): string[] {
    if (width <= 0) return ['']

    const lines: string[] = []
    let current = ''
    for (const part of parts) {
      const next = current ? `${current}  ·  ${part}` : part
      if (this.visibleLength(next) <= width) {
        current = next
        continue
      }

      if (current) {
        lines.push(current)
      }

      current = this.visibleLength(part) <= width ? part : this.fitVisible(part, width)
    }

    if (current) {
      lines.push(current)
    }

    return lines
  }

  private formatSummaryLines(width: number): string[] {
    const parts = OverviewUI.STATUS_GROUPS.map((group) => {
      const count = this.countByStatus(group.status)
      return this.color(`${group.label} ${count}`, OverviewUI.ANSI.bold, this.getStatusColor(group.status))
    })
    return this.wrapVisibleParts(parts, width)
  }

  private buildMainLines(): string[] {
    const orderedSessions = this.getOrderedSessions()
    const selectedId = this.manager.selectedSession?.id
    const width = this.getContentWidth()
    const lines = [
      this.color(this.makeRule('mav overview', width), OverviewUI.ANSI.dim),
      'AGENTS',
      ...this.formatSummaryLines(width),
      '',
    ]

    const cwdGroups = this.groupByCwd(orderedSessions)
    for (const [cwd, sessions] of cwdGroups) {
      lines.push(this.color(this.makeRule(this.shortenPath(cwd)), OverviewUI.ANSI.dim))

      for (const group of OverviewUI.STATUS_GROUPS) {
        const groupSessions = sessions.filter((s) => s.status === group.status)
        if (groupSessions.length === 0) continue

        lines.push(this.color(`  ${group.label} (${groupSessions.length})`, OverviewUI.ANSI.bold, this.getStatusColor(group.status)))
        for (const session of groupSessions) {
          const color = this.getStatusColor(session.status)
          const statusIcon =
            session.status === 'running' ? '⣾'
            : session.status === 'idle'    ? '○'
            : session.status === 'done'    ? '✓'
            : '✗'
          const sessionTitle = session.displayName ?? session.id
          const sessionLabel = session.type ? `${sessionTitle} (${session.type})` : sessionTitle
          const prefix = session.id === selectedId ? '> ' : '  '
          const sessionLine = this.fitPlain(
            `${prefix}${statusIcon} ${sessionLabel}  ${this.getStatusLabel(session.status)}`,
            width
          )
          lines.push(session.id === selectedId
            ? this.color(sessionLine, OverviewUI.ANSI.bold, color)
            : this.color(sessionLine, color))
        }

        lines.push('')
      }
    }

    if (orderedSessions.length === 0) {
      lines.push(this.color(this.makeRule('empty', width), OverviewUI.ANSI.dim))
      lines.push(this.fitPlain('  No sessions. Press n to add one.', width))
      lines.push('')
    }

    lines.push(this.color(this.makeRule('controls', width), OverviewUI.ANSI.dim))
    lines.push(...this.wrapPlainText('↑/↓ or j/k move   Enter detail   Ctrl+] back   n new   e rename   d delete   q quit', width))
    return this.finalizeLines(lines)
  }

  private buildPromptLines(): string[] {
    const state = this.promptState
    if (!state) return []

    const width = this.getContentWidth()
    const lines = ['', this.color(this.makeRule('prompt', width), OverviewUI.ANSI.dim)]
    if (state.mode === 'agent') {
      lines.push(this.fitPlain('Select agent type', width))
      lines.push('')
      for (const [index, agentType] of OverviewUI.AGENT_TYPES.entries()) {
        lines.push(this.fitPlain(`${index === state.selectedIndex ? '> ' : '  '}${agentType}`, width))
      }
      lines.push('')
      lines.push(...this.wrapPlainText('Enter: select  Esc: cancel', width))
      return this.finalizeLines(lines)
    }

    if (state.mode === 'cwd') {
      lines.push(this.fitPlain(`cwd for ${state.agentType}`, width))
      lines.push(...this.wrapPathText(state.value, width))
      if (state.candidates.length > 1) {
        lines.push('')
        lines.push(this.fitPlain('Candidates:', width))
        for (const candidate of state.candidates.slice(0, 8)) {
          lines.push(...this.wrapPathText(`  ${candidate}`, width))
        }
      }
      lines.push('')
      lines.push(...this.wrapPlainText('Tab: complete  Enter: confirm  Esc: cancel', width))
      return this.finalizeLines(lines)
    }

    if (state.mode === 'rename') {
      lines.push(this.fitPlain('rename session', width))
      lines.push(...this.wrapPlainText(state.value, width))
      lines.push('')
      lines.push(...this.wrapPlainText('Enter: confirm  Esc: cancel', width))
      return this.finalizeLines(lines)
    }

    lines.push(this.fitPlain('Error', width))
    for (const line of state.message.split('\n')) {
      lines.push(this.fitPlain(line, width))
    }
    lines.push('')
    lines.push(...this.wrapPlainText('Enter/Esc/q: close', width))
    return this.finalizeLines(lines)
  }

  private render(): void {
    if (!this.visible) return
    this.terminal.render([...this.buildMainLines(), ...this.buildPromptLines()].join('\n'))
  }

  show(): void {
    this.visible = true
    this.syncList()
    this.render()
  }

  isPromptOpen(): boolean {
    return this.promptState != null
  }

  resizeSelectedSession(): void {
    this.syncList()
    this.render()
  }

  hide(): void {
    this.visible = false
  }
}
