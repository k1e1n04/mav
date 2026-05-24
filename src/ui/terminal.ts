import { EventEmitter } from 'node:events'
import { emitKeypressEvents } from 'node:readline'

export interface KeyInfo {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  sequence?: string
}

type KeypressHandler = (str: string, key: KeyInfo) => void
type DataHandler = (chunk: string | Buffer) => void
type ResizeHandler = () => void

export class TerminalUI {
  readonly input: NodeJS.ReadStream
  readonly output: NodeJS.WriteStream
  private resizeEmitter = new EventEmitter()

  constructor(
    input: NodeJS.ReadStream = process.stdin,
    output: NodeJS.WriteStream = process.stdout
  ) {
    this.input = input
    this.output = output

    emitKeypressEvents(this.input)
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(true)
    }
    this.input.resume()

    if ('on' in this.output) {
      this.output.on('resize', () => {
        this.resizeEmitter.emit('resize')
      })
    }

    this.write('\x1b]0;mav\x07')
  }

  get cols(): number {
    return ('columns' in this.output && typeof this.output.columns === 'number')
      ? this.output.columns
      : 80
  }

  get rows(): number {
    return ('rows' in this.output && typeof this.output.rows === 'number')
      ? this.output.rows
      : 24
  }

  onKeypress(handler: KeypressHandler): () => void {
    const wrapped = (str: string, key: KeyInfo) => handler(str, key)
    this.input.on('keypress', wrapped)
    return () => {
      this.input.off('keypress', wrapped)
    }
  }

  onData(handler: DataHandler): () => void {
    this.input.on('data', handler)
    return () => {
      this.input.off('data', handler)
    }
  }

  onResize(handler: ResizeHandler): () => void {
    this.resizeEmitter.on('resize', handler)
    return () => {
      this.resizeEmitter.off('resize', handler)
    }
  }

  write(data: string): void {
    this.output.write(data)
  }

  clearScreen(): void {
    this.write('\x1b[H\x1b[2J')
  }

  render(content: string): void {
    this.clearScreen()
    this.write(content)
  }

  enterAlternateScreen(): void {
    this.write('\x1b[?1049h')
  }

  exitAlternateScreen(): void {
    this.write('\x1b[?1049l')
  }

  destroy(): void {
    this.exitAlternateScreen()
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(false)
    }
  }
}
