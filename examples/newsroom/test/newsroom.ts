import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { findConfig, readExample } from '../../../packages/cli/src/config.ts'
import { install as installExample } from '../../../packages/cli/src/in-page.ts'

/**
 * The newsroom, as the tests ask for it: the files its `platform.json` says it applies, read
 * as the operator's tools read them, and installed in a PostgreSQL that runs in the test.
 */
export const example = readExample(findConfig(join(import.meta.dir, '..'))!)

/** Installs the platform and the newsroom. The newsroom is all there, or none of it is. */
export const install = (db: PGlite): Promise<void> => installExample(db, example)
