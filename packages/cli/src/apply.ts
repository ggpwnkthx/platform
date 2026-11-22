import type pg from 'pg'
import { ident } from '@platform/vocabulary'
import { applyGroup, applyUser, dropRole } from './apply/roles.ts'
import { applyWorkspace } from './apply/rights.ts'
import { Run } from './apply/run.ts'
import { type ApplyResult, type Manifest, manifestSchema } from './apply/schema.ts'

export { parseManifest } from './apply/schema.ts'
export type { ApplyResult } from './apply/schema.ts'

/**
 * Brings a database to what a manifest describes, with the caller's own rights and inside the
 * caller's transaction. It adds and adjusts; it removes only what is marked absent, and never
 * a workspace, a collection or a field.
 */
export async function applyManifest(q: pg.Client, raw: unknown): Promise<ApplyResult> {
  const manifest: Manifest = manifestSchema.parse(raw)
  const run = new Run(q)
  const database = ident((await q.query('SELECT current_database() AS d')).rows[0].d)
  const present = <T extends { state: string }>(all: T[]) =>
    all.filter((x) => x.state === 'present')
  const absent = <T extends { state: string }>(all: T[]) => all.filter((x) => x.state === 'absent')
  for (const group of present(manifest.groups)) await applyGroup(run, group)
  for (const user of present(manifest.users)) await applyUser(run, user, database)
  for (const workspace of manifest.workspaces) await applyWorkspace(run, workspace)
  // Last, once this manifest's own revocations have released what the role held.
  for (const user of absent(manifest.users)) await dropRole(run, 'user', user.name)
  for (const group of absent(manifest.groups)) await dropRole(run, 'group', group.name)
  return { changes: run.changes, unchanged: run.unchanged }
}
