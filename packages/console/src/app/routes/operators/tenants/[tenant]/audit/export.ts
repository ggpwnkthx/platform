/**
 * The export of the audit of a tenant: the file Access
 * answers, handed to the browser as a download.
 */

import { createRoute } from 'honox/factory'
import { adminFor } from '../../../../../components/operators'

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const format = c.req.query('format') === 'jsonl' ? 'jsonl' : 'csv'
  const action = c.req.query('action')
  const body = await access.admin.exportAudit({
    tenant: slug,
    format,
    ...(action ? { action } : {}),
  })
  const stamp = new Date().toISOString().slice(0, 10)
  return c.body(body, 200, {
    'content-type':
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    'content-disposition': `attachment; filename="${slug}-audit-${stamp}.${format}"`,
    'cache-control': 'no-store',
  })
})
