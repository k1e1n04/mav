import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { AgentConfig } from './config.js'

export type SessionStatus = 'running' | 'idle' | 'done' | 'error'

const counters: Record<string, number> = {}

export class AgentSession extends EventEmitter {
  private static readonly IDLE_TIMEOUT_MS = 1500
  private static readonly DISPLAY_NAME_MAX_LENGTH = 25
  private static readonly DISPLAY_NAME_MIN_LENGTH = 3

  readonly id: string
  readonly type: string
  displayName: string
  status: SessionStatus = 'running'
  logBuffer: string[] = []
  lastPrompt: string = ''

  private ptyProcess: pty.IPty | undefined
  private exited = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private displayNameLocked = false
  private initialInputBuffer = ''

  constructor(config: AgentConfig, cols: number, rows: number) {
    super()
    counters[config.type] = (counters[config.type] ?? 0) + 1
    this.id = `${config.type}#${counters[config.type]}`
    this.type = config.type
    this.displayName = `${config.type} ${counters[config.type]}`

    let proc: pty.IPty
    try {
      proc = pty.spawn(config.cmd, config.args, {
        name: 'xterm-256color',
        cols,
        rows,
        env: process.env as Record<string, string>,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.status = 'error'
      this.logBuffer.push(`Error: failed to spawn '${config.cmd}': ${msg}\r\n`)
      process.nextTick(() => this.emit('exit', 1))
      return
    }

    this.ptyProcess = proc

    this.ptyProcess.onData((data) => {
      this.appendLog(data)
      this.setStatus('running')
      this.scheduleIdleTimer()
      this.emit('data', data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.clearIdleTimer()
      this.setStatus(exitCode === 0 ? 'done' : 'error')
      this.exited = true
      this.ptyProcess = undefined
      this.emit('exit', exitCode)
    })
  }

  write(data: string): void {
    if (this.exited) return
    this.updateDisplayNameFromInput(data)
    this.ptyProcess?.write(data)
  }

  kill(): void {
    if (this.exited) return
    this.clearIdleTimer()
    this.ptyProcess?.kill()
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return
    this.ptyProcess?.resize(cols, rows)
  }

  private appendLog(chunk: string): void {
    this.logBuffer.push(chunk)
    if (this.logBuffer.length > 500) {
      this.logBuffer.splice(0, this.logBuffer.length - 500)
    }
  }

  private setStatus(nextStatus: SessionStatus): void {
    if (this.status === nextStatus) {
      return
    }
    this.status = nextStatus
    this.emit('status', nextStatus)
  }

  private scheduleIdleTimer(): void {
    if (this.exited) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.exited) return
      this.setStatus('idle')
    }, AgentSession.IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) {
      return
    }
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private updateDisplayNameFromInput(data: string): void {
    if (this.displayNameLocked) {
      return
    }

    this.initialInputBuffer += data
    const newlineIndex = this.initialInputBuffer.search(/\r|\n/)
    if (newlineIndex === -1) {
      return
    }

    const firstLine = this.initialInputBuffer.slice(0, newlineIndex)
    this.displayNameLocked = true
    this.initialInputBuffer = ''

    const normalized = AgentSession.normalizeDisplayName(firstLine)
    if (normalized.length < AgentSession.DISPLAY_NAME_MIN_LENGTH) {
      return
    }

    this.displayName = normalized
    this.emit('name', normalized)
  }

  private static normalizeDisplayName(input: string): string {
    const withoutAnsi = input
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[@-Z\\-_]/g, '')
    const collapsed = withoutAnsi
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (collapsed.length <= AgentSession.DISPLAY_NAME_MAX_LENGTH) {
      return collapsed
    }

    return `${collapsed.slice(0, AgentSession.DISPLAY_NAME_MAX_LENGTH - 3).trimEnd()}...`
  }
}
