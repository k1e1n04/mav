import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, IpcServer } from '../src/ipc-server.js'
import { connect, Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('IpcServer', () => {
  const socketPath = join(tmpdir(), `mav-test-${process.pid}.sock`)
  let server: IpcServer

  beforeEach(() => {
    if (existsSync(socketPath)) unlinkSync(socketPath)
    server = createServer(socketPath)
  })

  afterEach(() => {
    server.close()
    if (existsSync(socketPath)) unlinkSync(socketPath)
  })

  it('socketファイルを作成してlistenする', async () => {
    await server.listen()
    expect(existsSync(socketPath)).toBe(true)
  })

  it('cwd メッセージを受信してハンドラーを呼ぶ', async () => {
    const received: Array<{ type: string; sessionId: string; path: string }> = []
    server.onMessage((msg) => received.push(msg))
    await server.listen()

    await new Promise<void>((resolve, reject) => {
      const client: Socket = connect(socketPath, () => {
        client.write(JSON.stringify({ type: 'cwd', sessionId: 'claude-code#1', path: '/new' }) + '\n')
        setTimeout(() => { client.destroy(); resolve() }, 50)
      })
      client.on('error', reject)
    })

    await new Promise((r) => setTimeout(r, 100))
    expect(received).toEqual([{ type: 'cwd', sessionId: 'claude-code#1', path: '/new' }])
  })

  it('不正なJSONは無視する', async () => {
    const received: unknown[] = []
    server.onMessage((msg) => received.push(msg))
    await server.listen()

    await new Promise<void>((resolve, reject) => {
      const client: Socket = connect(socketPath, () => {
        client.write('not-json\n')
        setTimeout(() => { client.destroy(); resolve() }, 50)
      })
      client.on('error', reject)
    })

    await new Promise((r) => setTimeout(r, 100))
    expect(received).toHaveLength(0)
  })
})
