import type pg from 'pg'
import { type ApplyResult, applyManifest, parseManifest } from './apply.ts'

/**
 * What a folder applies: any folder may say what a database holds, in the files its
 * `platform.json` says it applies (see `config.ts`, which reads them). They are named here
 * as the newsroom example names them.
 *
 * `models.ts` is the schema, as a manifest: the groups, the people, the workspaces with
 * their collections, grants and row policies. `migration.sql` is what a manifest cannot say:
 * the edge cases, written to be run again. `demo.sql` is the records and the history they
 * would have, written once.
 *
 * What a deployment says of itself is passed to all three as variables (`DeploymentVariables`),
 * and never written over their text: the models are a function of them, and the SQL reads
 * each as a setting, `current_setting('deployment.NAME')`.
 *
 * The same three are applied wherever the folder's site runs: beside a deployment's
 * PostgreSQL, in the page of a development build, and in the tests. Nothing here reads a
 * file, so that a page may apply the files it was built with.
 */
export type Applied = {
  /**
   * The manifest: what the models file exports. A module exports a function of the
   * variables that returns the manifest; a JSON file, which uses none, is the manifest.
   */
  models: unknown
  /** `migration.sql`, when the folder has one. */
  migration?: string
  /** `demo.sql`, when the folder has one. */
  demo?: string
}

/**
 * What a deployment says of itself to the files it applies: the same variables whichever
 * folder the files are from. Each is a plain string.
 */
export type DeploymentVariables = {
  /** The deployment's administrator: the address they sign in with. */
  admin: string
}

/** The administrator where there is no deployment to name one: a page, or a test. */
export const defaultAdmin = 'admin@example.com'

/**
 * The administrator of the deployment the tools run in: the one it names, or `admin` on its
 * domain. Without either there is no deployment to speak of, and the name is the default.
 */
export function deploymentAdmin(env: Record<string, string | undefined> = process.env): string {
  if (env.PLATFORM_ADMIN) return env.PLATFORM_ADMIN
  return env.PLATFORM_DOMAIN ? `admin@${env.PLATFORM_DOMAIN}` : defaultAdmin
}

/** The variables of the deployment the tools run in, read from its environment. */
export function deploymentVariables(
  env: Record<string, string | undefined> = process.env
): DeploymentVariables {
  return { admin: deploymentAdmin(env) }
}

/**
 * The manifest of a deployment whose site applies nothing: its administrator, and nothing else.
 * A role is named after the address the issuer reports, and this one is the account the
 * deployment's Dex keeps, so that there is somebody to sign in as.
 */
export function administratorManifest(admin: string = deploymentAdmin()) {
  return { format: 1, users: [{ name: admin, admin: true }] }
}

/** The manifest a folder applies, for a deployment that says these things of itself. */
export function manifestOf(
  applied: Applied,
  variables: DeploymentVariables = deploymentVariables({})
): unknown {
  return typeof applied.models === 'function' ? applied.models(variables) : applied.models
}

/** What applying a folder's files did, and what it left for somebody else to do. */
export type FolderResult = ApplyResult & { notes: string[] }

/**
 * Brings a database to what a folder's files describe, inside the caller's transaction.
 *
 * The manifest is applied as any manifest is, with the caller's own rights. The two SQL
 * files are the server's own superuser's: they hand rows to the people who would have
 * written them and write the history a trigger would have. Anybody else applies the schema
 * and is told what was left.
 *
 * The SQL files are given the variables as settings of the transaction, `deployment.admin`
 * and so on, which are gone when it ends.
 *
 * `migration.sql` runs every time. `demo.sql` runs once: when this run is the one that made
 * the folder's workspaces. Records are never written into workspaces that were already there.
 */
export async function applyFolder(
  q: pg.Client,
  applied: Applied,
  variables: DeploymentVariables = deploymentVariables({})
): Promise<FolderResult> {
  const { migration, demo } = applied
  const models = manifestOf(applied, variables)
  const workspaces = parseManifest(models).workspaces.map((workspace) => workspace.slug)
  const found: string[] = []
  for (const slug of workspaces) {
    const schema = await q.query('SELECT 1 AS found FROM pg_namespace WHERE nspname = $1', [slug])
    if (schema.rows.length) found.push(slug)
  }
  const result = await applyManifest(q, models)
  const notes: string[] = []
  if (migration === undefined && demo === undefined) return { ...result, notes }
  const superuser =
    (await q.query("SELECT current_setting('is_superuser') AS superuser")).rows[0]?.superuser ===
    'on'
  if (!superuser) {
    notes.push(
      "migration.sql and demo.sql were not run: they are the server's own superuser's. Run them beside the server, as `deploy local admin apply k8s --dir=DIR` does."
    )
    return { ...result, notes }
  }
  for (const [name, value] of Object.entries(variables))
    await q.query('SELECT set_config($1, $2, true)', [`deployment.${name}`, value])
  if (migration !== undefined) {
    await q.query(migration)
    notes.push('migration.sql was run.')
  }
  if (demo === undefined) return { ...result, notes }
  if (found.length)
    notes.push(
      `demo.sql was not run: ${found.join(' and ')} ${found.length > 1 ? 'were' : 'was'} already there, and records are written once.`
    )
  else {
    await q.query(demo)
    result.changes.push('write the records and the history of the demonstration')
  }
  return { ...result, notes }
}
