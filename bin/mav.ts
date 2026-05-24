#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
) as { version: string }

const program = new Command()

program
  .name('mav')
  .description(
    'Multi-agent view — manage multiple AI CLI sessions in one terminal'
  )
  .version(pkg.version)
  .option('--agent <type>', 'Start only the specified agent type')
  .option('--config <path>', 'Path to config file')
  .action((options: { agent?: string; config?: string }) => {
    start({
      agentType: options.agent,
      configPath: options.config,
    })
  })

const report = program.command('report')
  .description('Report runtime state back to the mav TUI process')

report
  .command('cwd <path>')
  .description('Report current working directory change to mav')
  .action((path: string) => {
    const socketPath = process.env.MAV_SOCKET
    const sessionId = process.env.MAV_SESSION_ID

    if (!socketPath || !sessionId) {
      // Called outside mav — silently exit
      process.exit(0)
    }

    const msg = JSON.stringify({ type: 'cwd', sessionId, path }) + '\n'
    const client = connect(socketPath, () => {
      client.write(msg, () => {
        client.destroy()
        process.exit(0)
      })
    })
    client.on('error', () => {
      // Connection failed (mav already exited, etc.) — silently exit
      process.exit(0)
    })
    // 3s timeout in case connection hangs
    setTimeout(() => process.exit(0), 3000).unref()
  })

program.parse()
