import type pg from 'pg'
import { type ApplyResult, applyManifest, parseManifest } from './apply.ts'

/**
 * An example: a folder under `examples/` that says what a database holds, in the files its
 * `platform.json` says it applies (see `config.ts`, which reads them). They are named here
 * as the newsroom names them.
 *
 * `models.json` is the schema, as a manifest: the groups, the people, the workspaces with
 * their collections, grants and row policies. `migration.sql` is what a manifest cannot say:
 * the edge cases, written to be run again. `demo.sql` is the records and the history they
 * would have, written once.
 *
 * The same three are applied wherever the example runs: beside a deployment's PostgreSQL,
 * in the page of a development build, and in the tests. Nothing here reads a file, so that
 * a page may apply an example it was built with.
 */
export type Example = {
  /** The manifest: `models.json`, parsed. */
  models: unknown
  /** `migration.sql`, when the example has one. */
  migration?: string
  /** `demo.sql`, when the example has one. */
  demo?: string
}

/** The name an example's files give their administrator. A deployment reads it as its own. */
export const exampleAdministrator = 'admin@example.com'

/**
 * The administrator of the deployment the tools run in: the one it names, or `admin` on its
 * domain. Without either there is no deployment to speak of, and the name is the example's.
 */
export function exampleAdmin(env: Record<string, string | undefined> = process.env): string {
  if (env.PLATFORM_ADMIN) return env.PLATFORM_ADMIN
  return env.PLATFORM_DOMAIN ? `admin@${env.PLATFORM_DOMAIN}` : exampleAdministrator
}

/**
 * The manifest of a deployment that chose no example: its administrator, and nothing else.
 * A role is named after the address the issuer reports, and this one is the account the
 * deployment's Dex keeps, so that there is somebody to sign in as.
 */
export function administratorManifest(admin: string = exampleAdmin()) {
  return { format: 1, users: [{ name: admin, admin: true }] }
}

/**
 * An example, with its administrator named as the deployment names its own. The name is
 * written into SQL as well as into the manifest, so it is an address and nothing else.
 */
export function namedFor(example: Example, admin: string): Example {
  if (admin === exampleAdministrator) return example
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(admin))
    throw new Error(`The administrator of an example is an address: ${admin} is not one`)
  const named = (text: string) => text.replaceAll(exampleAdministrator, admin)
  return {
    models: JSON.parse(named(JSON.stringify(example.models))),
    migration: example.migration === undefined ? undefined : named(example.migration),
    demo: example.demo === undefined ? undefined : named(example.demo),
  }
}

/** What applying an example did, and what it left for somebody else to do. */
export type ExampleResult = ApplyResult & { notes: string[] }

/**
 * Brings a database to what an example describes, inside the caller's transaction.
 *
 * `models.json` is applied as any manifest is, with the caller's own rights. The two SQL
 * files are the server's own superuser's: they hand rows to the people who would have
 * written them and write the history a trigger would have. Anybody else applies the schema
 * and is told what was left.
 *
 * `migration.sql` runs every time. `demo.sql` runs once: when this run is the one that made
 * the example's workspaces. Records are never written into workspaces that were already there.
 */
export async function applyExample(
  q: pg.Client,
  example: Example,
  admin: string = exampleAdministrator
): Promise<ExampleResult> {
  const { models, migration, demo } = namedFor(example, admin)
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
      "migration.sql and demo.sql were not run: they are the server's own superuser's. Run the example beside the server, as `deploy local admin apply k8s --example` does."
    )
    return { ...result, notes }
  }
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
