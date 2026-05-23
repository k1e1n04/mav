import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'
import type { SessionManager } from '../session-manager.js'
import { saveState } from '../state.js'
import { OverviewUI } from './overview.js'
import { DetailUI } from './detail.js'

type Mode = 'overview' | 'detail'

export class App {
  private screen: Widgets.Screen
  private manager: SessionManager
  private statePath: string
  private overviewUI: OverviewUI
  private detailUI: DetailUI
  private mode: Mode = 'overview'

  constructor(manager: SessionManager, statePath: string) {
    this.manager = manager
    this.statePath = statePath

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'mav',
      fullUnicode: true,
    })

    this.overviewUI = new OverviewUI(this.screen, manager, (session) => {
      if (session) {
        this.switchToDetail(session)
      }
    })
    this.detailUI = new DetailUI(this.screen, () => {
      if (this.mode === 'detail') {
        this.switchToOverview()
      }
    })

    const proto = Object.getPrototypeOf(this.screen) as { render?: () => void }
    const baseRender = proto.render ?? this.screen.render
    const protoRender = baseRender.bind(this.screen)
    ;(this.screen as unknown as { render: () => void }).render = () => {
      if (this.mode === 'detail') return
      protoRender()
    }

    this.bindGlobalKeys()

    this.screen.on('resize', () => {
      const cols = this.screen.width as number
      const rows = this.screen.height as number
      if (this.mode === 'detail') {
        this.detailUI.resize(cols, rows)
        return
      }

      this.overviewUI.resizeSelectedSession()
    })
  }

  private bindGlobalKeys(): void {
    this.screen.key('q', () => {
      if (this.mode === 'detail') return
      saveState(this.statePath, this.manager)
      this.manager.killAll()
      this.screen.destroy()
      process.exit(0)
    })

    this.screen.key('C-c', () => {
      if (this.mode === 'overview') {
        saveState(this.statePath, this.manager)
        this.manager.killAll()
        this.screen.destroy()
        process.exit(0)
      }
    })

    this.screen.key(['right', 'enter'], () => {
      if (this.mode !== 'overview') return
      if (this.overviewUI.isPromptOpen()) return
      const session = this.manager.selectedSession
      if (!session) return
      this.switchToDetail()
    })
  }

  private switchToDetail(session: AgentSession | null = this.manager.selectedSession): void {
    if (!session) return
    this.mode = 'detail'
    this.overviewUI.hide()
    this.screen.program.normalBuffer()
    this.screen.program.disableMouse()
    this.screen.realloc()
    this.detailUI.attach(session)
    this.detailUI.resize(this.screen.width as number, this.screen.height as number)
    this.detailUI.show()
  }

  private switchToOverview(): void {
    this.mode = 'overview'
    this.detailUI.detach()
    this.detailUI.hide()
    this.screen.program.alternateBuffer()
    this.screen.program.enableMouse()
    this.screen.realloc()
    this.overviewUI.show()
  }

  start(): void {
    this.overviewUI.show()
    this.overviewUI.resizeSelectedSession()
    this.screen.render()
  }
}
