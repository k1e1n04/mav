import type { AgentSession } from '../agent.js'
import type { AgentConfig } from '../config.js'
import type { SessionManager } from '../session-manager.js'
import { saveState } from '../state.js'
import { DetailUI } from './detail.js'
import { OverviewUI } from './overview.js'
import type { KeyInfo } from './terminal.js'
import { TerminalUI } from './terminal.js'

type Mode = 'overview' | 'detail'

export class App {
  private manager: SessionManager
  private statePath: string
  private terminal: TerminalUI
  private overviewUI: OverviewUI
  private detailUI: DetailUI
  private mode: Mode = 'overview'

  constructor(
    manager: SessionManager,
    statePath: string,
    terminal = new TerminalUI(),
    agentConfigs: AgentConfig[] = [],
    socketPath?: string,
  ) {
    this.manager = manager
    this.statePath = statePath
    this.terminal = terminal

    this.overviewUI = new OverviewUI(terminal, manager, (session) => {
      if (session) {
        this.switchToDetail(session)
      }
    }, agentConfigs, socketPath)
    this.detailUI = new DetailUI(terminal, () => {
      if (this.mode === 'detail') {
        this.switchToOverview()
      }
    })

    this.bindGlobalKeys()

    this.terminal.onResize(() => {
      const cols = this.terminal.cols
      const rows = this.terminal.rows
      if (this.mode === 'detail') {
        this.detailUI.resize(cols, rows)
        return
      }

      this.overviewUI.resizeSelectedSession()
    })
  }

  private bindGlobalKeys(): void {
    this.terminal.onKeypress((str, key) => {
      if (this.mode === 'overview') {
        this.handleOverviewKeypress(str, key)
      }
    })
  }

  private handleOverviewKeypress(str: string, key: KeyInfo): void {
    if (key.ctrl && key.name === 'c') {
      this.shutdown()
      return
    }

    if (str === 'q') {
      this.shutdown()
      return
    }

    if (!this.overviewUI.isPromptOpen() && (key.name === 'right' || key.name === 'enter' || key.name === 'return')) {
      const session = this.manager.selectedSession
      if (!session) return
      this.switchToDetail(session)
      return
    }

    this.overviewUI.handleKeypress(str, key)
  }

  private switchToDetail(session: AgentSession | null = this.manager.selectedSession): void {
    if (!session) return
    this.mode = 'detail'
    this.overviewUI.hide()
    this.terminal.exitAlternateScreen()
    this.detailUI.attach(session)
    this.detailUI.resize(this.terminal.cols, this.terminal.rows)
    this.detailUI.show()
  }

  private switchToOverview(): void {
    this.mode = 'overview'
    this.detailUI.detach()
    this.detailUI.hide()
    this.terminal.enterAlternateScreen()
    this.overviewUI.show()
  }

  private shutdown(): void {
    try {
      saveState(this.statePath, this.manager)
    } catch {
      // 終了シーケンスは継続する
    }
    this.manager.killAll()
    this.terminal.destroy()
    process.exit(0)
  }

  start(): void {
    this.terminal.enterAlternateScreen()
    this.overviewUI.show()
    this.overviewUI.resizeSelectedSession()
  }
}
