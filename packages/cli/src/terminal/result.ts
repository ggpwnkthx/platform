import { log, note as box } from '@clack/prompts'
import { styleText } from 'node:util'
import { common, drawn, output } from './run.ts'

/**
 * What a command leaves behind: a few names and what they are, set apart, and what to do
 * next under them.
 */
export function result(title: string, rows: [string, string][], next: string[]) {
  const width = Math.max(...rows.map(([name]) => name.length))
  box(rows.map(([name, value]) => `${name.padEnd(width)}  ${value}`).join('\n'), title, {
    ...common(),
    format: (line) => line,
  })
  if (next.length)
    log.message(
      next.map((line) => `${styleText('dim', '•')} ${line}`),
      common()
    )
}

/** What something said, shown under a title: the log of a service that did not start. */
export function report(title: string, lines: string[]) {
  if (!drawn()) {
    console.error([title, ...lines].join('\n'))
    return
  }
  // Always with its mark and its rule: it is read apart from what surrounds it.
  log.warn(title, { output, withGuide: true })
  log.message(lines.length ? lines.join('\n') : '(nothing)', { output, withGuide: true })
}
