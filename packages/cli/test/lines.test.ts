import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maxLines, overlong, sourceFiles } from '../src/lines.ts'

/** A folder of source files, written so the check may be tried on it. */
const folder = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'platform-lines-'))
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, name), text)
  }
  return root
}

describe('the files of the repository', () => {
  test('none of them is longer than a file may hold', () => {
    const over = overlong(join(import.meta.dir, '../..'))
    expect(over).toEqual([])
  })
  test('the source files are the ones of the language', () => {
    const found = sourceFiles(join(import.meta.dir, '../..')).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx')
    )
    expect(found.length).toBeGreaterThan(50)
  })
  test('a file that is too long is found, and one that is not is left alone', () => {
    const root = folder({
      'short.ts': 'export const one = 1\n',
      'long.ts': `${Array.from({ length: maxLines + 1 }, (_, at) => `const x${at} = ${at}`).join('\n')}\n`,
    })
    const over = overlong(root)
    expect(over.map((o) => o.file)).toEqual(['long.ts'])
    expect(over[0]?.lines).toBeGreaterThan(maxLines)
  })
})
