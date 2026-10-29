/**
 * The route table of the gateway, and the sessions of the callers.
 *
 * The route table is written through the control plane, and a write is
 * a compare-and-swap: the revision the caller believes is active is the
 * one it names, and the write is refused when the pointer moved. The
 * CLI reads the active revision first, and it says which revision it
 * replaces.
 */

import { readFile } from 'node:fs/promises'
import type { GroupSpec } from '../../app/commands'
import { numberOf, stringOf } from '../../app/commands'
import { CliFailure } from '../../domains/failure'
import {
  activeConfiguration,
  auditTrail,
  configurationHistory,
  purgeDecisions,
  replicas,
  revokeSessions,
  rollbackConfiguration,
  validateConfiguration,
  writeConfiguration,
} from '../../domains/gateway'
import { confirm } from '../../app/prompt'
import { controlCall } from './calls'

/**
 * Reads a table of the routes from a file.
 *
 * @param path the path of the file.
 */
async function readTable(path: string): Promise<unknown> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    throw new CliFailure(`the file ${path} cannot be read`, 4, 'not_found')
  }
  try {
    return JSON.parse(content)
  } catch {
    throw new CliFailure(`the file ${path} does not hold a table of the routes`, 8, 'invalid_file')
  }
}

/**
 * The lines of a list of the control plane.
 *
 * @param body the answer of the control plane.
 * @param key the name of the list in the answer.
 * @param columns the columns of the table.
 */
function linesOf(body: unknown, key: string, columns: readonly string[]): string[] {
  if (typeof body !== 'object' || body === null) return []
  const list = (body as Record<string, unknown>)[key]
  if (!Array.isArray(list) || list.length === 0) return ['there is nothing']
  const rows = list as Record<string, unknown>[]
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length))
  )
  return [
    columns
      .map((column, index) => column.padEnd(widths[index]!))
      .join('  ')
      .trimEnd(),
    ...rows.map((row) =>
      columns
        .map((column, index) => String(row[column] ?? '').padEnd(widths[index]!))
        .join('  ')
        .trimEnd()
    ),
  ]
}

/** The group of the route table. */
export const routesGroup: GroupSpec = {
  name: 'routes',
  summary: 'the route table of the gateway',
  description:
    'The gateway has no administrative endpoint: the route table is written through the control plane, which is a process of its own.',
  commands: [
    {
      name: 'get',
      summary: 'show the route table that is active',
      async run(input) {
        const active = await activeConfiguration(controlCall(input))
        return {
          value: {
            revision: active.revision,
            author: active.author ?? '',
            createdAt: active.createdAt ?? '',
            warnings: active.warnings,
            table: active.table,
          },
          lines: [
            `revision ${active.revision}`,
            ...active.warnings.map((warning) => `warning: ${warning}`),
          ],
        }
      },
    },
    {
      name: 'history',
      summary: 'show the history of the route table',
      options: [
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '20' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await configurationHistory(
          controlCall(input),
          numberOf(input.options, 'limit') ?? 20,
          numberOf(input.options, 'offset') ?? 0
        )
        return {
          value: body,
          lines: linesOf(body, 'entries', ['revision', 'author', 'createdAt']),
        }
      },
    },
    {
      name: 'validate',
      summary: 'check a route table without writing it',
      arguments: [{ name: 'file', summary: 'the file of the table', required: true }],
      examples: ['platformctl routes validate ./routes.json'],
      async run(input) {
        const path = input.args[0]
        if (!path) {
          throw new CliFailure('the file of the table is needed', 2, 'missing_argument')
        }
        const table = await readTable(path)
        const validation = await validateConfiguration(controlCall(input), table)
        return {
          value: validation,
          lines: [
            ...validation.errors.map((error) => `error: ${error}`),
            ...validation.conflicts.map((conflict) => `conflict: ${conflict}`),
            ...validation.warnings.map((warning) => `warning: ${warning}`),
          ],
          exit: validation.ok ? 0 : 8,
        }
      },
    },
    {
      name: 'apply',
      summary: 'write a route table as a new revision',
      description:
        'The write replaces the revision the CLI read, and it is refused when the revision moved. Pass --revision to name the revision yourself.',
      arguments: [{ name: 'file', summary: 'the file of the table', required: true }],
      options: [
        { name: 'revision', kind: 'string', summary: 'the revision the write replaces' },
        {
          name: 'skip-validate',
          kind: 'boolean',
          summary: 'write without checking the table first',
        },
      ],
      examples: ['platformctl routes apply ./routes.json'],
      async run(input) {
        const path = input.args[0]
        if (!path) {
          throw new CliFailure('the file of the table is needed', 2, 'missing_argument')
        }
        const table = await readTable(path)
        const call = controlCall(input)
        if (input.options['skip-validate'] !== true) {
          const validation = await validateConfiguration(call, table)
          if (!validation.ok) {
            throw new CliFailure(
              `the table is not valid: ${validation.errors.join(', ')}`,
              8,
              'invalid_configuration'
            )
          }
        }
        const revision = numberOf(input.options, 'revision')
        const active = await activeConfiguration(call)
        const expected = revision ?? active.revision
        await confirm(
          `the table replaces the revision ${expected} of the deployment?`,
          input.globals.yes
        )
        const written = await writeConfiguration(call, table, expected)
        return {
          value: { revision: written, replaced: expected },
          message: `the table is written as the revision ${written}`,
        }
      },
    },
    {
      name: 'rollback',
      summary: 'write an older revision again, as a new revision',
      arguments: [{ name: 'revision', summary: 'the revision to write again', required: true }],
      async run(input) {
        const revision = numberOf(input.options, 'revision') ?? Number(input.args[0])
        if (!Number.isFinite(revision)) {
          throw new CliFailure('the revision is needed', 2, 'missing_argument')
        }
        await confirm(
          `the revision ${revision} is written again as a new revision?`,
          input.globals.yes
        )
        const written = await rollbackConfiguration(controlCall(input), revision)
        return {
          value: { revision: written, rolledBack: revision },
          message: `the revision ${written} holds the table of the revision ${revision}`,
        }
      },
    },
    {
      name: 'replicas',
      summary: 'show the replicas that serve the route table',
      async run(input) {
        const body = await replicas(controlCall(input))
        return {
          value: body,
          lines: linesOf(body, 'replicas', ['replicaId', 'revision', 'lastError', 'at']),
        }
      },
    },
    {
      name: 'audit',
      summary: 'show the trail of the writes of the control plane',
      options: [
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '20' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await auditTrail(
          controlCall(input),
          numberOf(input.options, 'limit') ?? 20,
          numberOf(input.options, 'offset') ?? 0
        )
        return {
          value: body,
          lines: linesOf(body, 'entries', ['action', 'target', 'operator', 'scope', 'at']),
        }
      },
    },
  ],
}

/** The group of the sessions. */
export const sessionsGroup: GroupSpec = {
  name: 'sessions',
  summary: 'the sessions of the callers and the decisions they wait for',
  commands: [
    {
      name: 'revoke',
      summary: 'end the sessions of a caller',
      description:
        'The sessions of a compromised account are ended without logging every other caller out.',
      options: [{ name: 'subject', kind: 'string', summary: 'the subject of the caller' }],
      examples: ['platformctl sessions revoke --subject alice@gateway.test'],
      async run(input) {
        const subject = stringOf(input.options, 'subject')
        if (!subject) {
          throw new CliFailure('the subject of the caller is needed', 2, 'missing_argument')
        }
        await confirm(`the sessions of "${subject}" are ended?`, input.globals.yes)
        const revoked = await revokeSessions(controlCall(input), subject)
        return {
          value: { subject, revoked },
          message: `${revoked} sessions of "${subject}" are ended`,
        }
      },
    },
    {
      name: 'purge-decisions',
      summary: 'purge the decisions that are cached for a caller',
      options: [
        { name: 'subject', kind: 'string', summary: 'the subject of the caller' },
        { name: 'workspace', kind: 'string', summary: 'the workspace of the decisions' },
      ],
      async run(input) {
        const subject = stringOf(input.options, 'subject')
        const workspace = stringOf(input.options, 'workspace')
        if (!subject && !workspace) {
          throw new CliFailure(
            'a subject or a workspace is needed: pass --subject or --workspace',
            2,
            'missing_argument'
          )
        }
        const purged = await purgeDecisions(controlCall(input), subject, workspace)
        return {
          value: { subject: subject ?? '', workspace: workspace ?? '', purged },
          message: `${purged} cached decisions are purged`,
        }
      },
    },
  ],
}
