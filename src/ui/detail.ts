import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private static readonly EXIT_SEQUENCES = [
    '\x1d',
    '\x1b[93;5u',
    '\x1b[27;5;93~',
  ] as const

  private screen: Widgets.Screen
  private onExitDetail: () => void
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null
  private rawInputListener: ((chunk: unknown) => void) | null = null
  private pendingInput = ''

  constructor(screen: Widgets.Screen, onExitDetail: () => void) {
    this.screen = screen
    this.onExitDetail = onExitDetail
  }

  private isExitShortcut(input: string): boolean {
    return DetailUI.EXIT_SEQUENCES.includes(
      input as (typeof DetailUI.EXIT_SEQUENCES)[number]
    )
  }

  private isExitShortcutPrefix(input: string): boolean {
    return DetailUI.EXIT_SEQUENCES.some((sequence) => sequence.startsWith(input))
  }

  attach(session: AgentSession): void {
    this.detach()
    this.currentSession = session
    this.pendingInput = ''

    const { input, output } = this.screen.program

    const safeLog = session.logBuffer
      .join('')
      .replace(/\x1b\[\?104[79][hl]|\x1b\[\?47[hl]/g, '')
      .replace(/\x1b\[(?:>?\d*c|\?u|>q|\?\d+\$p)/g, '')
    output.write('\x1b[?1l')
    output.write('\x1b[H\x1b[2J')
    output.write(safeLog)

    this.dataListener = (data: string) => {
      output.write(data)
    }
    session.on('data', this.dataListener)

    this.rawInputListener = (chunk: unknown) => {
      const str = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : typeof chunk === 'string'
          ? chunk
          : ''
      if (!str) return
      if (this.isExitShortcut(str)) {
        this.onExitDetail()
        return
      }
      this.pendingInput += str

      if (this.isExitShortcut(this.pendingInput)) {
        this.pendingInput = ''
        this.onExitDetail()
        return
      }

      if (this.isExitShortcutPrefix(this.pendingInput)) {
        return
      }

      this.currentSession?.write(this.pendingInput)
      this.pendingInput = ''
    }
    input.on('data', this.rawInputListener)
  }

  detach(): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
      this.dataListener = null
    }
    if (this.rawInputListener) {
      this.screen.program.input.removeListener('data', this.rawInputListener)
      this.rawInputListener = null
    }
    this.pendingInput = ''
    this.currentSession = null
  }

  show(): void {}
  hide(): void {}

  resize(cols: number, rows: number): void {
    this.currentSession?.resize(cols, rows)
  }
}
