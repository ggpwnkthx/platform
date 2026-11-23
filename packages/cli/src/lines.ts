import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The most lines a file may hold: a file that says one thing, says it in one screen. */
export const maxLines = 200
const SKIP = ['node_modules', 'dist', '.dist', '.pg', '.tofu', '.fallow']
const SOURCE = /\.(ts|tsx)$/

/** Every source file of the repository, in the order they are read. */
export function sourceFiles(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP.includes(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (SOURCE.test(entry.name)) found.push(path)
  }
  return found
}

/** The files that hold more lines than they may: the ones to split. */
export function overlong(root: string, limit = maxLines): { file: string; lines: number }[] {
  const over: { file: string; lines: number }[] = []
  for (const file of sourceFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n').length
    if (lines > limit) over.push({ file: relative(root, file), lines })
  }
  return over
}

/** Checks the repository, and says what is too long. */
export function check(root = process.cwd()): boolean {
  const over = overlong(root)
  for (const { file, lines } of over)
    console.error(`${file}: ${lines} lines, over the ${maxLines} a file may hold`)
  return over.length === 0
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd()
  if (!check(root)) {
    console.error('Split them: one file, one thing.')
    process.exit(1)
  }
  console.log(`Every file holds ${maxLines} lines or less.`)
}
