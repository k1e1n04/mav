import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private screen: Widgets.Screen
  private onExitDetail: () => void
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null
  private rawInputListener: ((chunk: unknown) => void) | null = null

  constructor(screen: Widgets.Screen, onExitDetail: () => void) {
    this.screen = screen
    this.onExitDetail = onExitDetail
  }

  private isExitShortcut(input: string): boolean {
    return input === '\x1d' || input === '\x1b[93;5u'
  }

  attach(session: AgentSession): void {
    this.detach()
    this.currentSession = session

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
      this.currentSession?.write(str)
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
    this.currentSession = null
  }

  show(): void {}
  hide(): void {}

  resize(cols: number, rows: number): void {
    this.currentSession?.resize(cols, rows)
  }
}
