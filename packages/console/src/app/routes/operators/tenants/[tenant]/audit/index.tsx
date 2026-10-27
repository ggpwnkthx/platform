/**
 * The audit of the administration of a tenant: every change, who made it
 * and from where. The operator is the fingerprint of the credential, or
 * the name the deployment gave it.
 */

import { createRoute } from 'honox/factory'
import { AccessError } from '../../../../../../domains/access'
import {
  adminFor,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import {
  Badge,
  Empty,
  Moment,
  OffsetPager,
  Refusal,
  refusalOf,
} from '../../../../../components/page'
import CopyText from '../../../../../islands/copy-text'

const ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'principal.created',
  'principal.updated',
  'group.created',
  'group.updated',
  'grant.created',
  'grant.updated',
  'grant.revoked',
]

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const action = ACTIONS.includes(c.req.query('action') ?? '') ? (c.req.query('action') ?? '') : ''
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/audit`
  let page = null
  let refusal = null
  try {
    page = await access.admin.audit({ tenant: slug, ...(action ? { action } : {}), limit, offset })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ ...(action ? { action } : {}), ...extra })
    const suffix = params.toString()
    return suffix ? `?${suffix}` : ''
  }
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Audit"
        lede="Every change of the tenant, the latest first. The change and its row of the audit are committed together, or neither is."
      />
      <TenantTabs slug={slug} current="audit" />
      <div class="row spread">
        <form method="get" class="toolbar">
          <label class="field narrow" style="flex: 0 1 14rem">
            <span>Action</span>
            <select name="action">
              <option value="">every action</option>
              {ACTIONS.map((entry) => (
                <option value={entry} selected={entry === action}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" class="button quiet">
            Filter
          </button>
        </form>
        <span class="row">
          <a class="button quiet small" href={`${base}/export${query({ format: 'csv' })}`}>
            Export CSV
          </a>
          <a class="button quiet small" href={`${base}/export${query({ format: 'jsonl' })}`}>
            Export JSONL
          </a>
        </span>
      </div>
      {refusal ? <Refusal refusal={refusal} /> : null}
      {page && page.rows.length === 0 ? <Empty>Nothing was changed.</Empty> : null}
      {page && page.rows.length > 0 ? (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Operator</th>
                  <th>From</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((record) => (
                  <tr>
                    <td>
                      <Moment at={record.at} />
                    </td>
                    <td>
                      <Badge
                        tone={
                          record.action.endsWith('revoked')
                            ? 'error'
                            : record.action.endsWith('created')
                              ? 'accent'
                              : 'warn'
                        }
                        plain
                      >
                        {record.action}
                      </Badge>
                    </td>
                    <td>
                      <CopyText text={record.targetId} short />
                    </td>
                    <td class="mono small">{record.operator}</td>
                    <td class="mono small">{record.address ?? '—'}</td>
                    <td class="mono small">{record.requestId?.slice(0, 13) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <OffsetPager
            total={page.total}
            limit={limit}
            offset={offset}
            href={(next) => `${base}${query(next > 0 ? { offset: String(next) } : {})}`}
          />
        </>
      ) : null}
    </>,
    {
      title: `Audit of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Audit' }),
    }
  )
})
