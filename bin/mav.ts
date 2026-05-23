#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
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

program.parse()
