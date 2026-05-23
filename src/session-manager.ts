import { EventEmitter } from 'node:events'
import { AgentSession } from './agent.js'
import type { AgentConfig } from './config.js'

export class SessionManager extends EventEmitter {
  sessions: AgentSession[] = []
  selectedIndex: number = -1

  addSession(config: AgentConfig, cols = 80, rows = 24): AgentSession {
    const session = new AgentSession(config, cols, rows)

    session.on('data', (chunk: string) => {
      this.emit('data', session.id, chunk)
    })

    session.on('exit', (code: number) => {
      this.emit('exit', session.id, code)
    })

    this.sessions.push(session)

    if (this.selectedIndex === -1) {
      this.selectedIndex = 0
    }

    return session
  }

  removeSession(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id)
    if (idx === -1) return

    this.sessions[idx]!.kill()
    this.sessions.splice(idx, 1)

    if (this.sessions.length === 0) {
      this.selectedIndex = -1
    } else if (this.selectedIndex >= this.sessions.length) {
      this.selectedIndex = this.sessions.length - 1
    }
  }

  selectSession(index: number): void {
    if (index < 0 || index >= this.sessions.length) return
    this.selectedIndex = index
  }

  get selectedSession(): AgentSession | null {
    if (this.selectedIndex === -1) return null
    return this.sessions[this.selectedIndex] ?? null
  }

  killAll(): void {
    for (const session of this.sessions) {
      session.kill()
    }
    this.sessions = []
    this.selectedIndex = -1
  }
}
