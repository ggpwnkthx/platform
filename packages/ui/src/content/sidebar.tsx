import clsx from 'clsx'
import { columnsOf, tableOf, tablePolicies } from '@platform/data'
import { Legend, Rights } from '../access/rights.tsx'
import { describe, useLoad, useSession } from '../session.tsx'
import { SideGroup } from '../shell/page.tsx'
import { href } from '../url.ts'
import { Badge } from '../ui/bits.tsx'
import { HiddenIcon, InfoIcon, LockIcon, PolicyIcon } from '../ui/icons.tsx'

/** What the page shows beside a collection: what it is, what the reader may do, its policies. */
export function CollectionSidebar({
  schema,
  table,
  extra,
}: {
  schema: string
  table: string
  extra?: preact.ComponentChildren
}) {
  const { catalog } = useSession()
  const info = tableOf(catalog, schema, table)
  const columns = columnsOf(catalog, schema, table)
  const policies = useLoad((db) => tablePolicies(db, schema, table), [schema, table])
  if (!info) return null
  const hidden = columns.filter((c) => !c.can_select)
  const writable = columns.filter((c) => c.can_update)
  return (
    <>
      {extra}
      <SideGroup title="Information" icon={<InfoIcon size={16} />}>
        <dl class="facts">
          <dt>Collection</dt>
          <dd class="mono">{`${schema}.${table}`}</dd>
          <dt>Owner</dt>
          <dd class="mono">{info.owner}</dd>
          <dt>Kind</dt>
          <dd>{info.kind === 'v' ? 'View' : info.kind === 'p' ? 'Partitioned table' : 'Table'}</dd>
          <dt>Row security</dt>
          <dd>
            {info.rls ? (
              <Badge tone="info">{info.force_rls ? 'On, forced' : 'On'}</Badge>
            ) : (
              <Badge>Off</Badge>
            )}
          </dd>
        </dl>
        {info.comment && <p class="side-note">{info.comment}</p>}
      </SideGroup>
      <SideGroup title="Your rights" icon={<LockIcon size={16} />}>
        <Rights table={info} columns={columns} />
        <Legend />
        <p class="side-note">
          You read {columns.length - hidden.length} of {columns.length} fields and may change{' '}
          {writable.length}. The database decides each one.
        </p>
        {hidden.length > 0 && (
          <ul class="side-list">
            {hidden.map((c) => (
              <li key={c.name}>
                <HiddenIcon size={14} aria-hidden="true" />
                <span class="mono">{c.name}</span>
                <span class="side-muted">no SELECT</span>
              </li>
            ))}
          </ul>
        )}
        <a
          class="side-link"
          href={href('/model/collection', { ws: schema, c: table, tab: 'access' })}
        >
          {info.can_alter
            ? 'Manage who reaches this collection'
            : 'Who else reaches this collection'}
        </a>
      </SideGroup>
      <SideGroup title="Row policies" icon={<PolicyIcon size={16} />} count={policies.data?.length}>
        {!info.rls ? (
          <p class="side-note">Row security is off: grants alone decide which rows you reach.</p>
        ) : policies.data && !policies.data.length ? (
          <p class="side-note">
            Row security is on and there is no policy: nobody but the owner reaches a row.
          </p>
        ) : null}
        {policies.data?.map((p) => (
          <div key={p.name} class={clsx('policy', p.applies && 'is-yours')}>
            <div class="policy-head">
              <strong class="mono">{p.name}</strong>
              <Badge tone={p.applies ? 'primary' : 'neutral'}>
                {p.applies ? 'applies to you' : 'others'}
              </Badge>
            </div>
            <p class="policy-meta">
              {p.command} · {p.permissive.toLowerCase()} · {p.roles.join(', ')}
            </p>
            {p.using && <code class="policy-expr">USING {p.using}</code>}
            {p.check && <code class="policy-expr">WITH CHECK {p.check}</code>}
          </div>
        ))}
        {policies.error ? <p class="side-note">{describe(policies.error).title}</p> : null}
      </SideGroup>
    </>
  )
}
