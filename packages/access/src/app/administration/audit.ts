/**
 * The audit of the administration (spec §10.15).
 *
 * The audit is read, and it is not changed: it is the trail of the
 * changes, and the endpoint that reads it is the only one of the
 * administration that leaves the platform in a file.
 */

import type { Context } from 'hono'
import type { AuditRecord } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, authenticate, failure } from './support'

/** The row of the audit, as it is published. */
function auditBody(record: AuditRecord): Record<string, unknown> {
  return {
    id: record.id,
    at: record.at.toISOString(),
    action: record.action,
    targetId: record.targetId,
    tenant: record.tenant,
    operator: record.operator,
    address: record.address,
    requestId: record.requestId,
  }
}

/** The columns of the export of the audit, in the order of the file. */
const AUDIT_COLUMNS = [
  'id',
  'at',
  'action',
  'targetId',
  'tenant',
  'operator',
  'address',
  'requestId',
]

/**
 * Escapes a value of a cell of the export.
 *
 * A value that carries a comma, a quote or a line break is quoted, and
 * the quotes of the value are doubled: the file is read by a
 * spreadsheet, and a value that breaks it is a value that is lost.
 *
 * A value that begins with the character of a formula is quoted as well:
 * a spreadsheet reads `=A1` as a formula, and the export must carry a
 * value, not a formula.
 */
function csvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * The export of the audit, in CSV.
 *
 * The header is the name of the columns, and every row is a line: the
 * file is read by a spreadsheet and by a script.
 */
function auditCsv(records: ReturnType<typeof auditBody>[]): string {
  const lines = [AUDIT_COLUMNS.join(',')]
  for (const record of records) {
    lines.push(
      AUDIT_COLUMNS.map((column) => {
        const value = record[column]
        return csvCell(value === null || value === undefined ? '' : String(value))
      }).join(',')
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * The export of the audit, in JSON Lines.
 *
 * One object per line: the format that a script reads line by line,
 * without holding the whole file in the memory.
 */
function auditJsonl(records: ReturnType<typeof auditBody>[]): string {
  return (
    records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '')
  )
}

/** The name of the file of an export of the audit. */
function auditFilename(format: string): string {
  return `access-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`
}

/**
 * `GET /v1/admin/audit`: the audit of the administration.
 *
 * It is the one endpoint of the administration that reads and that does
 * not change: it is the trail of the changes, and it is read only.
 */
export async function auditHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/audit'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listAudit(scope, {
      tenant: query.tenant ?? null,
      action: query.action ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
      format: query.format ?? null,
    })

    // The exports leave the platform: the rows are in a file that a
    // spreadsheet or a script reads (spec §10.15).
    if (page.format !== 'json') {
      const records = page.records.map(auditBody)
      const body = page.format === 'csv' ? auditCsv(records) : auditJsonl(records)
      return new Response(body, {
        headers: {
          'content-type':
            page.format === 'csv'
              ? 'text/csv; charset=utf-8'
              : 'application/x-ndjson; charset=utf-8',
          'content-disposition': `attachment; filename="${auditFilename(page.format)}"`,
        },
      })
    }

    return answer(context, dependencies, scope, endpoint, 200, {
      records: page.records.map(auditBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}
