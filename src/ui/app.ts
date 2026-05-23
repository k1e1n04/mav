import * as blessed from 'neo-blessed'
import type { SessionManager } from '../session-manager.js'
import { OverviewUI } from './overview.js'
import { DetailUI } from './detail.js'

type Mode = 'overview' | 'detail'

export class App {
  private screen: blessed.Widgets.Screen
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
    this.detailUI = new DetailUI(this.screen)

    this.bindGlobalKeys()

    this.screen.on('resize', () => {
      const cols = this.screen.width as number
      const rows = this.screen.height as number
      if (this.mode === 'detail') {
        this.detailUI.resize(cols, rows)
      }
    })
  }

  private bindGlobalKeys(): void {
    this.screen.key(['q', 'C-c'], () => {
      this.manager.killAll()
      this.screen.destroy()
      process.exit(0)
    })

    this.screen.key(['right', 'enter'], () => {
      if (this.mode !== 'overview') return
      const session = this.manager.selectedSession
      if (!session) return
      this.switchToDetail()
    })

    this.screen.key('left', () => {
      if (this.mode === 'detail') {
        this.switchToOverview()
      }
    })

    this.screen.on('keypress', (ch: string, key: { name: string }) => {
      if (this.mode !== 'detail') return
      if (key.name === 'left') return
      if (key.name === 'q') return
      this.detailUI.forwardKey(key.name ?? '', ch ?? '')
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
    this.overviewUI.show()
  }

  start(): void {
    this.overviewUI.show()
    this.screen.render()
  }
}
