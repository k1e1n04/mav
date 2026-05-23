import { appendFileSync } from 'node:fs'
import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private static readonly KEYBOARD_FLAGS_RESPONSE_PATTERN = /\x1b\[\?(\d+)u/g

  private static readonly EXIT_SEQUENCES = [
    '\x1d',
    '\x1b[93;5u',
    '\x1b[27;5;93~',
  ] as const
  private static readonly EXIT_SEQUENCE_PATTERNS = [
    /^\x1b\[93(?:::\d+)?;5(?::\d+)?u$/,
    /^\x1b\[99;5u$/,
  ] as const

  private screen: Widgets.Screen
  private onExitDetail: () => void
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null
  private rawInputListener: ((chunk: unknown) => void) | null = null
  private pendingInput = ''
  private keyboardEnhancementFlags: string | null = null

  constructor(screen: Widgets.Screen, onExitDetail: () => void) {
    this.screen = screen
    this.onExitDetail = onExitDetail
  }

  private isExitShortcut(input: string): boolean {
    return (
      DetailUI.EXIT_SEQUENCES.includes(
      input as (typeof DetailUI.EXIT_SEQUENCES)[number]
      ) ||
      DetailUI.EXIT_SEQUENCE_PATTERNS.some((pattern) => pattern.test(input))
    )
  }

  private isExitShortcutPrefix(input: string): boolean {
    return (
      DetailUI.EXIT_SEQUENCES.some((sequence) => sequence.startsWith(input)) ||
      '\x1b[93::92;5u'.startsWith(input) ||
      '\x1b[93::92;5:3u'.startsWith(input) ||
      '\x1b[99;5u'.startsWith(input)
    )
  }

  private debugLogInput(str: string): void {
    const path = process.env.MAV_DEBUG_KEYS_PATH
    if (!path) return

    const hex = Buffer.from(str, 'utf8').toString('hex')
    appendFileSync(path, `raw=${JSON.stringify(str)} hex=${hex}\n`)
  }

  private rememberKeyboardEnhancementFlags(str: string): void {
    for (const match of str.matchAll(DetailUI.KEYBOARD_FLAGS_RESPONSE_PATTERN)) {
      this.keyboardEnhancementFlags = match[1] ?? null
    }
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
    if (this.keyboardEnhancementFlags) {
      output.write(`\x1b[=${this.keyboardEnhancementFlags}u`)
    }
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
      this.debugLogInput(str)
      this.rememberKeyboardEnhancementFlags(str)
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
    if (this.keyboardEnhancementFlags) {
      this.screen.program.output.write('\x1b[=0u')
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
