import { PgError } from '@platform/pg-client/wire.ts'

export function commandOf(text: string): string {
  const words = text
    .replace(/--[^\n]*\n/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.toUpperCase())
  if (['CREATE', 'ALTER', 'DROP'].includes(words[0] ?? '')) return words.slice(0, 2).join(' ')
  return words[0] ?? ''
}

export function asPgError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error))
  const found = error as Error & Record<string, unknown>
  if (typeof found.code !== 'string') return error
  const fields = new Map<string, string>([
    ['M', found.message],
    ['C', found.code],
    ['S', String(found.severity ?? 'ERROR')],
  ])
  for (const [key, name] of [
    ['D', 'detail'],
    ['H', 'hint'],
    ['P', 'position'],
    ['s', 'schema'],
    ['t', 'table'],
    ['c', 'column'],
    ['n', 'constraint'],
  ] as const)
    if (found[name] !== undefined && found[name] !== null) fields.set(key, String(found[name]))
  return new PgError(fields)
}
