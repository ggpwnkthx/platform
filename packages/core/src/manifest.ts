import { z } from 'zod'
import { type Db, requireInstalledVersion, script, transaction } from './db.ts'
import { Run, type ApplyResult } from './manifest/run.ts'
import { applyGroup, applyUser, dropRole } from './manifest/apply.ts'
import { applyWorkspace } from './manifest/workspace.ts'
import { applyCollections } from './manifest/collections.ts'
import { collectionSchema, parseManifest, relationSchema } from './manifest/schema.ts'
import { ident } from './sql/kit.ts'
/** Applies a manifest inside the caller's transaction, as the caller. */
export async function applyManifest(db: Db, raw: unknown, run = new Run(db)): Promise<ApplyResult> {
  const manifest = parseManifest(raw)
  const database = ident((await run.one<{ d: string }>('SELECT current_database() AS d'))!.d)
  const present = <T extends { state: string }>(all: T[]) =>
    all.filter((x) => x.state === 'present')
  const absent = <T extends { state: string }>(all: T[]) => all.filter((x) => x.state === 'absent')
  for (const group of present(manifest.groups)) await applyGroup(run, group.name)
  for (const user of present(manifest.users)) await applyUser(run, user, database)
  for (const workspace of manifest.workspaces) await applyWorkspace(run, workspace)
  for (const user of absent(manifest.users)) await dropRole(run, 'user', user.name)
  for (const group of absent(manifest.groups)) await dropRole(run, 'group', group.name)
  return run
}

// --------------------------------------------------------------------------- a site folder

/** What a folder's platform.json says it applies: the schema, and the two SQL files beside it. */
export interface Applied {
  models: unknown
  migration?: string
  demo?: string
}
export interface DeploymentVariables {
  admin: string
}
export const deploymentVariables = (
  env: Record<string, string | undefined> = {}
): DeploymentVariables => ({
  admin:
    env.PLATFORM_ADMIN ||
    (env.PLATFORM_DOMAIN ? `admin@${env.PLATFORM_DOMAIN}` : 'admin@example.com'),
})
export const administratorManifest = (admin: string) => ({
  format: 1,
  users: [{ name: admin, admin: true }],
})
export const manifestOf = (applied: Applied, variables = deploymentVariables()): unknown =>
  typeof applied.models === 'function' ? applied.models(variables) : applied.models

/**
 * models (the schema) every time; migration.sql (what a manifest cannot say) every time, and
 * demo.sql (records and their history) the first time — both only beside the server, as its
 * own superuser, with the deployment's variables in `deployment.*` settings.
 */
export async function applyFolder(
  db: Db,
  applied: Applied,
  variables = deploymentVariables()
): Promise<ApplyResult> {
  const models = manifestOf(applied, variables)
  const run = new Run(db)
  const found: string[] = []
  for (const { slug } of parseManifest(models).workspaces)
    if (await run.one('SELECT 1 FROM pg_namespace WHERE nspname = $1', [slug])) found.push(slug)
  await applyManifest(db, models, run)
  if (applied.migration === undefined && applied.demo === undefined) return run
  const me = await run.one<{ superuser: string }>(
    "SELECT current_setting('is_superuser') AS superuser"
  )
  if (me?.superuser !== 'on') {
    run.notes.push(
      "migration.sql and demo.sql were not run: they are the server's own superuser's. Run them beside the server, as `deploy local admin apply k8s --dir=DIR` does."
    )
    return run
  }
  for (const [key, value] of Object.entries(variables))
    await db.query('SELECT set_config($1, $2, true)', [`deployment.${key}`, value])
  if (applied.migration !== undefined) {
    await script(db, applied.migration)
    run.notes.push('migration.sql was run.')
  }
  if (applied.demo === undefined) return run
  if (found.length)
    run.notes.push(
      `demo.sql was not run: ${found.join(' and ')} ${found.length > 1 ? 'were' : 'was'} already there, and records are written once.`
    )
  else {
    await script(db, applied.demo)
    run.changed('write the records and the history of the demonstration')
  }
  return run
}

/** An additive JSON model, applied with the caller's own DDL rights. */
export async function applyModel(db: Db, raw: unknown) {
  const model = z
    .object({
      workspace: z.object({ slug: z.string().min(1) }),
      collections: z.array(collectionSchema),
      relations: z.array(relationSchema).default([]),
    })
    .parse(raw)
  const schema = model.workspace.slug
  await requireInstalledVersion(db)
  return transaction(db, async () => {
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`)
    await applyCollections(new Run(db), schema, model.collections, model.relations)
    return { schema, collections: model.collections.length }
  })
}
