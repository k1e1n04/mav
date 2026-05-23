import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'
import { OverviewUI } from './overview.js'
import { DetailUI } from './detail.js'

type Mode = 'overview' | 'detail'

export class App {
  private screen: Widgets.Screen
  private manager: SessionManager
  private overviewUI: OverviewUI
  private detailUI: DetailUI
  private mode: Mode = 'overview'

  constructor(manager: SessionManager) {
    this.manager = manager

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'mav',
      fullUnicode: true,
    })

    this.overviewUI = new OverviewUI(this.screen, manager)
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
      for (const session of this.manager.sessions) {
        session.resize(cols, rows)
      }
    })
  }

  private bindGlobalKeys(): void {
    this.screen.key('q', () => {
      if (this.mode === 'detail') return
      this.manager.killAll()
      this.screen.destroy()
      process.exit(0)
    })

    this.screen.key('C-c', () => {
      if (this.mode === 'overview') {
        this.manager.killAll()
        this.screen.destroy()
        process.exit(0)
      }
    })

    this.screen.key(['right', 'enter'], () => {
      if (this.mode !== 'overview') return
      const session = this.manager.selectedSession
      if (!session) return
      this.switchToDetail()
    })
  }

  private switchToDetail(): void {
    const session = this.manager.selectedSession
    if (!session) return
    this.mode = 'detail'
    this.overviewUI.hide()
    this.detailUI.attach(session)
    this.detailUI.show()
  }

  private switchToOverview(): void {
    this.mode = 'overview'
    this.detailUI.detach()
    this.detailUI.hide()
    this.screen.program.alternateBuffer()
    this.screen.realloc()
    this.overviewUI.show()
  }

  start(): void {
    const cols = this.screen.width as number
    const rows = this.screen.height as number
    for (const session of this.manager.sessions) {
      session.resize(cols, rows)
    }
    this.overviewUI.show()
    this.screen.render()
  }
}
