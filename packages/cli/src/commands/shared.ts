import type { Db } from '@platform/core'
import { type ArgsDef, type CommandDef, defineCommand } from 'citty'
import { ZodError, z } from 'zod'
import { localDatabase } from '../deploy/settings.ts'
import { open } from '../database/open.ts'
/** A command of the operator's tools, and how a refusal in it is said. */
export const command = <T extends ArgsDef>(
  description: string,
  args: T,
  run: NonNullable<CommandDef<T>['run']>
) =>
  defineCommand({
    meta: { description },
    args,
    run: (context) =>
      Promise.resolve()
        .then(() => run(context))
        .catch((error) => {
          // A manifest that does not parse says where, in words.
          console.error(
            error instanceof ZodError ? z.prettifyError(error) : (error.message ?? error)
          )
          process.exit(1)
        }),
  })

/** A deployment's database: the local stack's published port, or the one the environment names. */
export const target = (deployment: string | undefined) => {
  if (deployment === 'local') return localDatabase()
  if (deployment === undefined || deployment === 'k8s' || deployment === 'kubernetes') return {}
  throw new Error(`Unknown deployment: ${deployment}. Supported deployments: local, k8s.`)
}
export async function withDb<T>(
  deployment: string | undefined,
  work: (db: Db) => Promise<T>
): Promise<T> {
  const db = await open(target(deployment))
  try {
    return await work(db)
  } finally {
    await db.end()
  }
}
