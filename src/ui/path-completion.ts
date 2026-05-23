import { readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

export interface CompletionResult {
  completed: string
  candidates: string[]
}

export function completePath(input: string): CompletionResult {
  const expanded = input.replace(/^~/, process.env.HOME ?? '~')
  const isAbsolute = expanded.startsWith('/')
  const dir = isAbsolute || expanded.includes('/')
    ? dirname(expanded)
    : process.cwd()
  const prefix = basename(expanded)

  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
      .map((e) => join(dir, e.name) + '/')
  } catch {
    return { completed: input, candidates: [] }
  }

  if (entries.length === 0) {
    return { completed: input, candidates: [] }
  }

  if (entries.length === 1) {
    return { completed: restoreHome(entries[0]!, input), candidates: [] }
  }

  const lcp = longestCommonPrefix(entries)
  return {
    completed: restoreHome(lcp, input),
    candidates: entries.map((e) => restoreHome(e, input)),
  }
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return ''
  let prefix = strs[0]!
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i]!.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') return ''
    }
  }
  return prefix
}

function restoreHome(path: string, original: string): string {
  const home = process.env.HOME
  if (home && original.startsWith('~') && path.startsWith(home)) {
    return '~' + path.slice(home.length)
  }
  return path
}
