import type pg from 'pg'

/** Public package/database version. Keep aligned with package.json and the installation SQL. */
export const VERSION = '2.3.0'

/**
 * The version the installation holds, and the check that it is the one these tools know.
 * The database holds the truth about its own version; a schema of another version is not
 * one these tools know.
 */
export async function requireInstalledVersion(q: pg.Client): Promise<string> {
  const found = await q.query('SELECT version FROM platform.installation')
  const version = found.rows[0]?.version as string | undefined
  if (version !== VERSION)
    throw new Error(
      `This installation is at version ${version ?? 'none'}. Run \`bun run cli migrate\` first.`
    )
  return version
}
