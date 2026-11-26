import { Box, Typography } from '@mui/material'
import { type ActivityInfo, type PolicyInfo, tablePrivileges } from '@platform/core'
import { ReferenceManyCount, useGetList, useRecordContext } from 'react-admin'
import type { Column } from '../columns/types.ts'
import { minute } from '../columns/values.tsx'
import { Mono, Privilege, PrivilegeLegend, Tag } from '../kit/marks.tsx'
import { Role } from '../access/roles.tsx'
import { Statement } from '../kit/said.tsx'
import { Aside, AsideGroup } from '../kit/Page.tsx'
import { useTable } from './table.ts'

/** A privilege as the reader holds it: PostgreSQL's answer for the table, and for each column. */
function held(name: string, table: Record<string, unknown>, all: Column[]) {
  const key = `can_${name.toLowerCase()}`
  const columns = all.filter((f) => f.column)
  const some = columns.filter((f) => (f.column as unknown as Record<string, unknown>)[key])
  if (!(key in (columns[0]?.column ?? {}))) return { held: !!table[key] }
  return {
    held: some.length === columns.length ? 'all' : some.length ? 'some' : 'none',
    count: `${some.length}/${columns.length}`,
  } as const
}

/** What is known about the table in view: what it is, the reader's rights, the policies that apply. */
export function TableAside() {
  const { schema, table, columns, info } = useTable()
  const policies = useGetList<PolicyInfo & { id: string }>('policies', {
    filter: { schema, table },
  })
  if (!info) return null
  return (
    <Aside>
      <AsideGroup title="Table">
        <Mono>{`${schema}.${table}`}</Mono>
        {info.comment && <Typography variant="body2">{info.comment}</Typography>}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Owned by <Role name={info.owner} />
        </Typography>
      </AsideGroup>
      <AsideGroup title="Your privileges">
        {tablePrivileges.slice(0, 5).map((name) => (
          <Box key={name}>
            <Privilege name={name} {...held(name, info as never, columns)} />
          </Box>
        ))}
        <Box sx={{ mt: 2, opacity: 0.8 }}>
          <PrivilegeLegend />
        </Box>
      </AsideGroup>
      <AsideGroup title="Row security">
        <Tag color="info">
          {info.rls
            ? 'Enabled: rows are filtered by policies'
            : 'Disabled: table privileges alone decide'}
        </Tag>
        {policies.data
          ?.filter((p) => p.applies)
          .map((policy) => (
            <Box key={policy.id} sx={{ mt: 2 }}>
              <Statement
                caption={`${policy.name} · ${policy.command} · applies to you`}
                sql={[
                  policy.using && `USING (${policy.using})`,
                  policy.check && `WITH CHECK (${policy.check})`,
                ].filter((s): s is string => !!s)}
              />
            </Box>
          ))}
      </AsideGroup>
    </Aside>
  )
}

/** What is known about the row in view: who wrote it, what points at it, and its history. */
export function RowAside() {
  const { schema, table, columns } = useTable()
  const current = useRecordContext()
  const history = useGetList<ActivityInfo>(
    'revisions',
    { filter: { schema, table, row: current?.id } },
    { enabled: !!current }
  )
  if (!current) return null
  const children = columns.filter((f) => f.link?.kind === 'children')
  return (
    <Aside>
      <AsideGroup title="Row">
        {columns
          .filter((f) => f.system && current[f.name] != null)
          .map((f) => (
            <Typography
              key={f.name}
              variant="body2"
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
            >
              <span>{f.label}</span>
              <Mono title={String(current[f.name])}>
                {f.name === 'id' ? String(current.id).slice(0, 8) : minute(current[f.name])}
              </Mono>
            </Typography>
          ))}
      </AsideGroup>
      {children.length > 0 && (
        <AsideGroup title="Rows that reference this one">
          {children.map((f) => (
            <Typography
              key={f.name}
              variant="body2"
              sx={{ display: 'flex', justifyContent: 'space-between' }}
              data-children={f.name}
            >
              <span>{f.label}</span>
              <ReferenceManyCount
                reference={`${f.link!.path.schema}.${f.link!.path.table}`}
                target={f.link!.path.fk}
                link
              />
            </Typography>
          ))}
        </AsideGroup>
      )}
      <AsideGroup title="Revisions">
        {history.data?.length ? (
          history.data.map((revision) => (
            <Typography key={revision.id} variant="body2" data-revision>
              <Tag>{revision.operation}</Tag> <Mono>{minute(revision.at)}</Mono> {revision.actor}
            </Typography>
          ))
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            None that you may read: a schema's owners read its history.
          </Typography>
        )}
      </AsideGroup>
    </Aside>
  )
}
