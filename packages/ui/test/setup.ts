import { mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

// The two modules a site's build provides: the design tokens, read from DESIGN.md as the
// build reads them, and a site with no extensions and no in-page PostgreSQL.
const design = readFileSync(new URL('../../../DESIGN.md', import.meta.url), 'utf8')
mock.module('virtual:design-tokens', () => ({ default: parse(design.split('---')[1]!) }))
mock.module('virtual:platform-site', () => ({ startInPage: null }))
