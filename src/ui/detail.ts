import blessed from 'neo-blessed'
import type { Widgets } from 'neo-blessed'
import type { AgentSession } from '../agent.js'

export class DetailUI {
  private screen: Widgets.Screen
  private headerBox: Widgets.BoxElement
  private contentBox: Widgets.BoxElement
  private currentSession: AgentSession | null = null
  private dataListener: ((data: string) => void) | null = null

  constructor(screen: Widgets.Screen) {
    this.screen = screen

    this.headerBox = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { bg: 'blue', fg: 'white', bold: true },
      tags: true,
    })

    this.contentBox = blessed.box({
      parent: screen,
      top: 1,
      left: 0,
      width: '100%',
      height: (screen.height as number) - 1,
      scrollable: true,
      alwaysScroll: true,
      tags: false,
    })
  }

  attach(session: AgentSession): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
    }

    this.currentSession = session
    this.contentBox.setContent('')

    const buf = session.logBuffer.join('')
    this.contentBox.setContent(buf)
    this.contentBox.setScrollPerc(100)

    this.dataListener = (data: string) => {
      this.contentBox.pushLine(data)
      this.contentBox.setScrollPerc(100)
      this.screen.render()
    }
    session.on('data', this.dataListener)

    this.headerBox.setContent(
      ` mav — {bold}${session.id}{/bold}  {grey-fg}[← to back]{/grey-fg} `
    )

    this.screen.render()
  }

  detach(): void {
    if (this.currentSession && this.dataListener) {
      this.currentSession.off('data', this.dataListener)
    }
    this.currentSession = null
    this.dataListener = null
  }

  forwardKey(keyName: string, ch: string): void {
    if (!this.currentSession) return

    if (keyName === 'return') {
      this.currentSession.write('\r')
    } else if (keyName === 'backspace') {
      this.currentSession.write('\x7f')
    } else if (keyName === 'C-c') {
      this.currentSession.write('\x03')
    } else if (keyName === 'C-d') {
      this.currentSession.write('\x04')
    } else if (keyName === 'C-b') {
      // ← の代替（カーソル左移動）
      this.currentSession.write('\x1b[D')
    } else if (ch) {
      this.currentSession.write(ch)
    }
  }

  resize(cols: number, rows: number): void {
    this.contentBox.height = rows - 1
    this.currentSession?.resize(cols, rows - 1)
  }

  show(): void {
    this.headerBox.show()
    this.contentBox.show()
    this.screen.render()
  }

  hide(): void {
    this.headerBox.hide()
    this.contentBox.hide()
  }
}
