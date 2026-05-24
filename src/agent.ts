import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { AgentConfig } from './config.js'
import { getProcessCwd } from './process-cwd.js'

export type SessionStatus = 'running' | 'idle' | 'done' | 'error'

const counters: Record<string, number> = {}

export class AgentSession extends EventEmitter {
  private static readonly IDLE_TIMEOUT_MS = 1500
  private static readonly DISPLAY_NAME_MAX_LENGTH = 25
  private static readonly DISPLAY_NAME_MIN_LENGTH = 3
  private static readonly CWD_POLL_INTERVAL_MS = 1000

  readonly id: string
  readonly type: string
  readonly cmd: string
  cwd: string
  displayName: string
  baseArgs: string[] = []
  status: SessionStatus = 'running'
  logBuffer: string[] = []
  lastPrompt: string = ''
  sessionId?: string

  private ptyProcess: pty.IPty | undefined
  private exited = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private cwdPollTimer: ReturnType<typeof setInterval> | null = null
  private displayNameLocked = false
  private initialInputBuffer = ''

  constructor(config: AgentConfig, cols: number, rows: number) {
    super()
    counters[config.type] = (counters[config.type] ?? 0) + 1
    this.id = `${config.type}#${counters[config.type]}`
    this.type = config.type
    this.cmd = config.cmd
    this.cwd = config.cwd ?? process.cwd()
    this.displayName = `${config.type} ${counters[config.type]}`

    let proc: pty.IPty
    try {
      proc = pty.spawn(config.cmd, config.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.cwd,
        env: process.env as Record<string, string>,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.exited = true
      this.status = 'error'
      this.logBuffer.push(`Error: failed to spawn '${config.cmd}': ${msg}\r\n`)
      process.nextTick(() => this.emit('exit', 1))
      return
    }

    this.ptyProcess = proc

    this.ptyProcess.onData((data) => {
      this.updateCwdFromOutput(data)
      this.appendLog(data)
      this.setStatus('running')
      this.scheduleIdleTimer()
      this.emit('data', data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.clearIdleTimer()
      this.clearCwdPollTimer()
      this.setStatus(exitCode === 0 ? 'done' : 'error')
      this.exited = true
      this.ptyProcess = undefined
      this.emit('exit', exitCode)
    })

    this.startCwdPolling()
  }

  /** 保存されたdisplayNameを復元し、以降の入力で上書きされないようにロックする */
  restoreDisplayName(name: string): void {
    this.displayName = name
    this.displayNameLocked = true
    this.emit('name', name)
  }

  setDisplayName(name: string): void {
    const normalized = AgentSession.normalizeDisplayName(name)
    if (normalized.length < AgentSession.DISPLAY_NAME_MIN_LENGTH) {
      return
    }

    this.displayName = normalized
    this.displayNameLocked = true
    this.emit('name', normalized)
  }

  write(data: string): void {
    if (this.exited) return
    this.updateDisplayNameFromInput(data)
    this.ptyProcess?.write(data)
  }

  kill(): void {
    if (this.exited) return
    this.clearIdleTimer()
    this.clearCwdPollTimer()
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

  private startCwdPolling(): void {
    if (this.cwdPollTimer || !this.ptyProcess) {
      return
    }

    this.cwdPollTimer = setInterval(() => {
      if (this.exited || !this.ptyProcess) {
        return
      }

      this.updateCwd(getProcessCwd(this.ptyProcess.pid))
    }, AgentSession.CWD_POLL_INTERVAL_MS)
  }

  private clearCwdPollTimer(): void {
    if (!this.cwdPollTimer) {
      return
    }

    clearInterval(this.cwdPollTimer)
    this.cwdPollTimer = null
  }

  private updateDisplayNameFromInput(data: string): void {
    if (this.displayNameLocked) {
      return
    }

    this.initialInputBuffer += data

    // DCS/APC/PM/SOS シーケンス（Warp など一部ターミナルがstdinに送る）を除去してから
    // ユーザー入力の改行を探す。これらのシーケンスは CR/LF を含むことがあり、
    // そのまま処理すると表示名がターミナル固有の文字列で汚染される。
    const cleaned = this.initialInputBuffer.replace(/\x1b[P_^X][^\x1b]*(?:\x1b\\)?/g, '')

    const newlineIndex = cleaned.search(/\r|\n/)
    if (newlineIndex === -1) {
      return
    }

    const firstLine = cleaned.slice(0, newlineIndex)
    this.initialInputBuffer = ''

    const normalized = AgentSession.normalizeDisplayName(firstLine)
    if (normalized.length < AgentSession.DISPLAY_NAME_MIN_LENGTH) {
      return
    }

    this.displayNameLocked = true
    this.displayName = normalized
    this.emit('name', normalized)
  }

  private updateCwdFromOutput(data: string): void {
    this.updateCwd(AgentSession.extractOsc7Cwd(data))
  }

  private updateCwd(nextCwd: string | null): void {
    if (!nextCwd || nextCwd === this.cwd) {
      return
    }

    this.cwd = nextCwd
    this.emit('cwd', nextCwd)
  }

  private static extractOsc7Cwd(data: string): string | null {
    const matches = [...data.matchAll(/\x1b\]7;([^\x07\x1b]+)(?:\x07|\x1b\\)/g)]
    const rawUrl = matches.at(-1)?.[1]
    if (!rawUrl) {
      return null
    }

    try {
      const url = new URL(rawUrl)
      if (url.protocol !== 'file:') {
        return null
      }

      return decodeURIComponent(url.pathname || '')
    } catch {
      return null
    }
  }

  private static normalizeDisplayName(input: string): string {
    const withoutAnsi = input
      .replace(/\x1b[P_^X][^\x1b]*(?:\x1b\\)?/g, '')  // DCS, APC, PM, SOS（複数文字シーケンス）
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
