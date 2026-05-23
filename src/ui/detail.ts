import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private screen: Widgets.Screen
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null
  private rawInputListener: ((chunk: unknown) => void) | null = null

  constructor(screen: Widgets.Screen) {
    this.screen = screen
  }

  attach(session: AgentSession): void {
    this.detach()
    this.currentSession = session

    const { input, output } = this.screen.program

    // Replay log buffer directly to the physical terminal.
    // Filter alternate-buffer switch sequences so we stay in blessed's alt buffer.
    const safeLog = session.logBuffer
      .join('')
      .replace(/\x1b\[\?104[79][hl]|\x1b\[\?47[hl]/g, '')
    output.write('\x1b[?1l')    // Normal cursor key mode (← sends \x1b[D)
    output.write('\x1b[H\x1b[2J')
    output.write(safeLog)

    this.dataListener = (data: string) => {
      output.write(data)
    }
    session.on('data', this.dataListener)

    // Forward raw stdin bytes to PTY, bypassing blessed's key processing
    this.rawInputListener = (chunk: unknown) => {
      const str = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : typeof chunk === 'string'
          ? chunk
          : ''
      if (!str) return
      // ← in normal (\x1b[D) and application (\x1bOD) cursor key modes
      if (str === '\x1b[D' || str === '\x1bOD') return
      if (str === '\x02') {    // C-b → cursor left (since ← is taken for "go back")
        this.currentSession?.write('\x1b[D')
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
