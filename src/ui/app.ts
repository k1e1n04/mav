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
    this.detailUI = new DetailUI(this.screen)

    // Suppress blessed widget rendering while in raw PTY passthrough mode
    const proto = Object.getPrototypeOf(this.screen) as { render: () => void }
    const protoRender = proto.render.bind(this.screen)
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
      if (this.mode === 'detail') return // 'q' must reach the PTY in detail mode
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
      // detail mode: raw input listener in DetailUI forwards \x03 to PTY
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
    // A done session's exit sequences may have left the terminal in the normal
    // buffer. Re-enter the alternate buffer that blessed expects before rendering.
    this.screen.program.alternateBuffer()
    // Reallocate blessed buffers so the next render is a full redraw,
    // not a delta from the raw PTY output we wrote directly to the terminal.
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
