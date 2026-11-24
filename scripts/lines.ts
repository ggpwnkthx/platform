import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * How much of the repository is the platform's own, by area, and whether any file has grown
 * past what one file should hold. `bun run lines`. The cap is a guard, not a target: a file
 * that nears it says one thing too many, and is not to be met by cutting it in two.
 */
export const maxLines = 200
const SKIP = ['node_modules', '.dist', '.dist-published', 'test-results', '.git']
const SOURCE = /\.(ts|tsx)$/

export function sourceFiles(root: string, pattern = SOURCE): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.includes(entry.name)) return []
    const path = join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(path, pattern) : pattern.test(entry.name) ? [path] : []
  })
}
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').length - 1
export const overlong = (root: string, limit = maxLines) =>
  sourceFiles(root)
    .map((file) => ({ file: relative(root, file), lines: lines(file) }))
    .filter((one) => one.lines > limit)

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd()
  const areas: [string, string, RegExp?][] = [
    ['interface', 'packages/ui/src'],
    ['core', 'packages/core/src'],
    ['deployment CLI', 'packages/cli/src'],
    ['relay', 'packages/relay/src'],
    [
      'site build, example, scripts',
      '.',
      /^(packages\/ui\/vite\.ts|examples\/.*\.tsx?|scripts\/.*\.ts|playwright\.config\.ts)$/,
    ],
    ['tests', '.', /^(packages\/[^/]+\/test\/|e2e\/)/],
    ['SQL', '.', /\.sql$/],
  ]
  for (const [area, dir, only] of areas) {
    const files = sourceFiles(join(root, dir), only && area === 'SQL' ? /\.sql$/ : SOURCE).filter(
      (file) => !only || only.test(relative(root, file))
    )
    console.log(
      `${String(files.reduce((sum, file) => sum + lines(file), 0)).padStart(6)}  ${area} (${files.length} files)`
    )
  }
  const over = overlong(root)
  for (const { file, lines } of over)
    console.error(`${file}: ${lines} lines, over the ${maxLines} a file should hold`)
  if (over.length) process.exit(1)
  console.log(`Every file holds ${maxLines} lines or less.`)
}
