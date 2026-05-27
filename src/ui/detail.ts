import { appendFileSync } from 'node:fs'
import type { AgentSession } from '../agent.js'
import type { TerminalUI } from './terminal.js'

export class DetailUI {
  private static readonly KEYBOARD_FLAGS_RESPONSE_PATTERN = /\x1b\[\?(\d+)u/g
  private static readonly PENDING_INPUT_FLUSH_DELAY_MS = 25
  private static readonly EXIT_HINT =
    '\x1b[7m mav detail  \x1b[27m Press Ctrl+] to return to Overview\r\n\r\n'

  private static readonly EXIT_SEQUENCES = [
    '\x1d',
    '\x1b[93;5u',
    '\x1b[27;5;93~',
  ] as const
  private static readonly EXIT_SEQUENCE_PATTERNS = [
    /^\x1b\[93(?:::\d+)?;5(?::\d+)?u$/,
    /^\x1b\[99;5u$/,
  ] as const

  private terminal: TerminalUI
  private onExitDetail: () => void
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null
  private rawInputDisposer: (() => void) | null = null
  private pendingInput = ''
  private pendingInputTimer: ReturnType<typeof setTimeout> | null = null
  private keyboardEnhancementFlags: string | null = null
  private pendingTerminalResponse = ''

  constructor(terminal: TerminalUI, onExitDetail: () => void) {
    this.terminal = terminal
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

  private clearPendingInputTimer(): void {
    if (!this.pendingInputTimer) {
      return
    }
    clearTimeout(this.pendingInputTimer)
    this.pendingInputTimer = null
  }

  private flushPendingInput(): void {
    if (!this.pendingInput) {
      return
    }
    this.currentSession?.write(this.pendingInput)
    this.pendingInput = ''
    this.clearPendingInputTimer()
  }

  private sanitizeTerminalResponses(input: string): string {
    const combined = this.pendingTerminalResponse + input
    const trailingPrefix = DetailUI.extractTrailingTerminalResponsePrefix(combined)
    const processable = trailingPrefix.length > 0
      ? combined.slice(0, -trailingPrefix.length)
      : combined
    this.pendingTerminalResponse = trailingPrefix

    return processable
      .replace(/\x1b[P_^X][\s\S]*?(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[\?\d+(?:;\d+)*u/g, '')
  }

  private static extractTrailingTerminalResponsePrefix(input: string): string {
    const csiMatch = input.match(/\x1b\[\?[0-9;]*$/)
    if (csiMatch) {
      return csiMatch[0]
    }

    const escapeIndex = input.lastIndexOf('\x1b')
    if (escapeIndex === -1) {
      return ''
    }

    const candidate = input.slice(escapeIndex)
    if (!/^\x1b[\]P_^X]/.test(candidate)) {
      return ''
    }

    const hasTerminator = /\x07|\x1b\\/.test(candidate)
    return hasTerminator ? '' : candidate
  }

  attach(session: AgentSession): void {
    this.detach()
    this.currentSession = session
    this.pendingInput = ''

    const safeLog = session.logBuffer
      .join('')
      .replace(/\x1b\[\?104[79][hl]|\x1b\[\?47[hl]/g, '')
      .replace(/\x1b\[(?:>?\d*c|\?u|>q|\?\d+\$p)/g, '')
    // DECSTR (Soft Terminal Reset) でセッション間の端末状態汚染を防ぐ。
    // スクロール領域・SGR属性・カーソルモードなど前セッションが設定したモードをリセットし、
    // 次セッションのログ再生に影響しないようにする。
    this.terminal.write('\x1b[!p')
    if (this.keyboardEnhancementFlags) {
      this.terminal.write(`\x1b[=${this.keyboardEnhancementFlags}u`)
    }
    this.terminal.write('\x1b[?1l')
    this.terminal.clearScreen()
    this.terminal.write(DetailUI.EXIT_HINT)
    this.terminal.write(safeLog)

    const attachedSession = session
    this.dataListener = (data: string) => {
      // attach 後に detach や別セッションへの切り替えが発生した場合の防御的ガード
      if (this.currentSession !== attachedSession) return
      this.terminal.write(data)
    }
    session.on('data', this.dataListener)

    this.rawInputDisposer = this.terminal.onData((chunk: string | Buffer) => {
      const str = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : typeof chunk === 'string'
          ? chunk
          : ''
      if (!str) return
      this.debugLogInput(str)
      this.rememberKeyboardEnhancementFlags(str)
      const sanitized = this.sanitizeTerminalResponses(str)
      if (!sanitized) {
        return
      }
      if (this.isExitShortcut(sanitized)) {
        this.onExitDetail()
        return
      }
      this.pendingInput += sanitized

      if (this.isExitShortcut(this.pendingInput)) {
        this.clearPendingInputTimer()
        this.pendingInput = ''
        this.onExitDetail()
        return
      }

      if (this.isExitShortcutPrefix(this.pendingInput)) {
        this.clearPendingInputTimer()
        this.pendingInputTimer = setTimeout(() => {
          this.pendingInputTimer = null
          this.flushPendingInput()
        }, DetailUI.PENDING_INPUT_FLUSH_DELAY_MS)
        return
      }

      this.flushPendingInput()
    })
  }

  detach(): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
      this.dataListener = null
    }
    this.rawInputDisposer?.()
    this.rawInputDisposer = null
    if (this.keyboardEnhancementFlags) {
      this.terminal.write('\x1b[=0u')
    }
    this.clearPendingInputTimer()
    this.pendingInput = ''
    this.pendingTerminalResponse = ''
    this.currentSession = null
  }

  show(): void {}
  hide(): void {}

  resize(cols: number, rows: number): void {
    this.currentSession?.resize(cols, rows)
  }
}
