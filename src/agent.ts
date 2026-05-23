import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { AgentConfig } from './config.js'

export type SessionStatus = 'running' | 'idle' | 'done' | 'error'

const counters: Record<string, number> = {}

export class AgentSession extends EventEmitter {
  readonly id: string
  readonly type: string
  status: SessionStatus = 'running'
  logBuffer: string[] = []
  lastPrompt: string = ''

  private ptyProcess: pty.IPty

  constructor(config: AgentConfig, cols: number, rows: number) {
    super()
    counters[config.type] = (counters[config.type] ?? 0) + 1
    this.id = `${config.type}#${counters[config.type]}`
    this.type = config.type

    this.ptyProcess = pty.spawn(config.cmd, config.args, {
      name: 'xterm-256color',
      cols,
      rows,
      env: process.env as Record<string, string>,
    })

    this.ptyProcess.onData((data) => {
      this.appendLog(data)
      this.emit('data', data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.status = exitCode === 0 ? 'done' : 'error'
      this.emit('exit', exitCode)
    })
  }

  write(data: string): void {
    this.ptyProcess.write(data)
  }

  kill(): void {
    this.ptyProcess.kill()
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows)
  }

  private appendLog(chunk: string): void {
    this.logBuffer.push(chunk)
    if (this.logBuffer.length > 500) {
      this.logBuffer.splice(0, this.logBuffer.length - 500)
    }
  }
}
