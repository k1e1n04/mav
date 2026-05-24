import { createServer as netCreateServer, Server, Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'

export interface IpcMessage {
  type: string
  sessionId: string
  path: string
}

type MessageHandler = (msg: IpcMessage) => void

export interface IpcServer {
  listen(): Promise<void>
  onMessage(handler: MessageHandler): void
  close(): void
}

export function createServer(socketPath: string): IpcServer {
  const handlers: MessageHandler[] = []
  let server: Server | null = null

  return {
    onMessage(handler) {
      handlers.push(handler)
    },

    listen() {
      return new Promise((resolve, reject) => {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath)
        }

        server = netCreateServer((socket: Socket) => {
          let buf = ''
          socket.on('error', () => {}) // absorb socket errors (e.g. ECONNRESET)
          socket.on('data', (chunk) => {
            buf += chunk.toString()
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const msg = JSON.parse(line) as IpcMessage
                if (msg.type && msg.sessionId && typeof msg.path === 'string') {
                  handlers.forEach((h) => h(msg))
                }
              } catch {
                // ignore
              }
            }
          })
        })

        server.once('error', reject)
        server.listen(socketPath, () => {
          server!.removeListener('error', reject)
          server!.on('error', () => {}) // absorb post-bind server errors
          resolve()
        })
      })
    },

    close() {
      const closingServer = server
      server = null
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath) } catch { /* ignore */ }
      }
      closingServer?.close()
    },
  }
}
