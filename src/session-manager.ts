import { EventEmitter } from 'node:events'
import { AgentSession } from './agent.js'
import type { AgentConfig } from './config.js'
import type { MavState } from './state.js'

type SessionListeners = {
  onData: (chunk: string) => void
  onExit: (code: number) => void
  onStatus: (status: string) => void
  onName: (name: string) => void
}

export class SessionManager extends EventEmitter {
  sessions: AgentSession[] = []
  selectedIndex: number = -1
  private sessionListeners = new Map<string, SessionListeners>()

  addSession(config: AgentConfig, cols = 80, rows = 24): AgentSession {
    const session = new AgentSession(config, cols, rows)

    const onData = (chunk: string) => { this.emit('data', session.id, chunk) }
    const onExit = (code: number) => { this.emit('exit', session.id, code) }
    const onStatus = (status: string) => { this.emit('status', session.id, status) }
    const onName = (name: string) => { this.emit('name', session.id, name) }

    session.on('data', onData)
    session.on('exit', onExit)
    session.on('status', onStatus)
    session.on('name', onName)
    this.sessionListeners.set(session.id, { onData, onExit, onStatus, onName })

    this.sessions.push(session)

    if (this.selectedIndex === -1) {
      this.selectedIndex = 0
    }

    return session
  }

  removeSession(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id)
    if (idx === -1) return

    const session = this.sessions[idx]!
    const ls = this.sessionListeners.get(id)
    if (ls) {
      session.off('data', ls.onData)
      session.off('exit', ls.onExit)
      session.off('status', ls.onStatus)
      session.off('name', ls.onName)
      this.sessionListeners.delete(id)
    }
    session.kill()
    this.sessions.splice(idx, 1)

    if (this.sessions.length === 0) {
      this.selectedIndex = -1
    } else if (idx < this.selectedIndex) {
      this.selectedIndex -= 1
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

  restoreLogBuffers(state: MavState): void {
    for (const session of this.sessions) {
      const saved = state.sessions[session.id]
      if (saved) {
        session.logBuffer = [...saved.logBuffer]
        if (saved.sessionId != null) {
          session.sessionId = saved.sessionId
        }
      }
    }
  }

  killAll(): void {
    for (const session of this.sessions) {
      const ls = this.sessionListeners.get(session.id)
      if (ls) {
        session.off('data', ls.onData)
        session.off('exit', ls.onExit)
        session.off('status', ls.onStatus)
        session.off('name', ls.onName)
      }
      session.kill()
    }
    this.sessions = []
    this.sessionListeners.clear()
    this.selectedIndex = -1
  }
}
