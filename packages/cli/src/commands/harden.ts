import { requireInstalledVersion, script, transaction } from '@platform/core'
import { hardenSql } from '../database/doctor.ts'
import { guardSql, unguardSql } from '../database/guard.ts'
import { command, withDb } from './shared.ts'

export const harden = command(
  'harden <local|k8s>: hide the role catalogs from ordinary connections. Needs the cluster superuser.',
  {
    'keep-names': {
      type: 'boolean',
      description: 'Leave role names readable, so pg_dump and GRANT keep working for everyone',
    },
    events: {
      type: 'boolean',
      description:
        'Also refuse the DDL that would turn a collection out of row security, or drop the triggers that write its history',
    },
    restore: { type: 'boolean', description: 'Put PostgreSQL’s default back' },
  },
  ({ args }) => {
    if (!['local', 'k8s', 'kubernetes'].includes(args._[0] ?? ''))
      throw new Error('harden needs a deployment: local or k8s')
    const mode = args['keep-names'] ? 'keep-names' : args.restore ? 'restore' : 'strict'
    return withDb(args._[0], async (db) => {
      if (
        (await db.query<{ on: string }>("SELECT current_setting('is_superuser') AS on")).rows[0]
          ?.on !== 'on'
      )
        throw new Error(
          'The role catalogs belong to the cluster superuser. Run harden as the cluster superuser.'
        )
      await requireInstalledVersion(db)
      await transaction(db, async () => {
        await script(db, hardenSql(mode))
        // The guard is installed with the catalogs, and taken away with them.
        if (args.restore) await script(db, unguardSql())
        else if (args.events) await script(db, guardSql())
      })
      if (args.restore)
        console.log(
          "Restored PostgreSQL's default access to the role catalogs, and took the guard away."
        )
      else if (args.events)
        console.log(
          'Hid the role catalogs from ordinary connections, and installed the guard: an ordinary role may not turn a collection out of row security, nor drop the triggers that write its history. psql \\du and pg_dump need a platform operator or superuser from now on. The interface shows each caller their own roles and memberships, as before.'
        )
      else
        console.log(
          'Hid the role catalogs from ordinary connections: psql \\du and pg_dump need a platform operator or superuser from now on. The interface shows each caller their own roles and memberships, as before.'
        )
    })
  }
)
