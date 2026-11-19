import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { defaultViews, viewsKey } from '@platform/sql'

/**
 * The seed is what the example manifest and the CRM model leave behind. It says where the
 * fields of the seeded collections appear, and it must say what the platform says by
 * default: the default is written in one place, and the seed follows it.
 */
const seed = readFileSync(new URL('../src/dev/seed.sql', import.meta.url), 'utf8')

describe('the seed of the development build', () => {
  test('every field of the seed carries the platform’s default views', () => {
    const rows = seed.split('\n').filter((line) => line.includes(`'${viewsKey}'`))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toContain(JSON.stringify(defaultViews))
  })

  test('every field of every seeded collection says where it appears', () => {
    const said = new Set(
      seed
        .split('\n')
        .filter((line) => line.includes(`'${viewsKey}'`))
        .map((line) => {
          const found = /'field', '([^']+)', '([^']+)', '([^']+)'/.exec(line)
          return found ? `${found[1]}.${found[2]}.${found[3]}` : ''
        })
    )
    for (const collection of [
      'newsroom.sections',
      'newsroom.articles',
      'newsroom.corrections',
      'crm.accounts',
      'crm.contacts',
      'crm.deals',
    ])
      expect([...said].some((one) => one.startsWith(`${collection}.`))).toBe(true)
  })
})
