import { Box, Typography } from '@mui/material'
import { type ActivityInfo, type PolicyInfo, tablePrivileges } from '@platform/core'
import { ReferenceManyCount, useGetList, useRecordContext } from 'react-admin'
import type { Field } from '../fields/types.ts'
import { minute } from '../fields/values.tsx'
import { Mono, Privilege, PrivilegeLegend, Tag } from '../kit/marks.tsx'
import { Role } from '../access/roles.tsx'
import { Statement } from '../kit/said.tsx'
import { Aside, AsideGroup } from '../kit/Page.tsx'
import { useCollection } from './collection.ts'
import { operationWord } from '../kit/words.ts'

/** A privilege as the reader holds it: PostgreSQL's answer for the table, and for each field. */
function held(name: string, table: Record<string, unknown>, fields: Field[]) {
  const key = `can_${name.toLowerCase()}`
  const columns = fields.filter((f) => f.column)
  const some = columns.filter((f) => (f.column as unknown as Record<string, unknown>)[key])
  if (!(key in (columns[0]?.column ?? {}))) return { held: !!table[key] }
  return {
    held: some.length === columns.length ? 'all' : some.length ? 'some' : 'none',
    count: `${some.length}/${columns.length}`,
  } as const
}

/** What is known about the collection in view: what it is, the reader's rights, the policies that apply. */
export function CollectionAside() {
  const { schema, table, fields, info } = useCollection()
  const policies = useGetList<PolicyInfo & { id: string }>('policies', {
    filter: { schema, table },
  })
  if (!info) return null
  return (
    <Aside>
      <AsideGroup title="Collection">
        <Mono>{`${schema}.${table}`}</Mono>
        {info.comment && <Typography variant="body2">{info.comment}</Typography>}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Owned by <Role name={info.owner} />
        </Typography>
      </AsideGroup>
      <AsideGroup title="Your rights">
        {tablePrivileges.slice(0, 5).map((name) => (
          <Box key={name}>
            <Privilege name={name} {...held(name, info as never, fields)} />
          </Box>
        ))}
        <Box sx={{ mt: 2, opacity: 0.8 }}>
          <PrivilegeLegend />
        </Box>
      </AsideGroup>
      <AsideGroup title="Row security">
        <Tag color="info">
          {info.rls ? 'Rows are filtered by policies' : 'Off: grants alone decide'}
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

/** What is known about the record in view: who wrote it, what points at it, and its history. */
export function RecordAside() {
  const { schema, table, fields } = useCollection()
  const record = useRecordContext()
  const history = useGetList<ActivityInfo>(
    'revisions',
    { filter: { schema, table, row: record?.id } },
    { enabled: !!record }
  )
  if (!record) return null
  const children = fields.filter((f) => f.link?.kind === 'children')
  return (
    <Aside>
      <AsideGroup title="Record">
        {fields
          .filter((f) => f.system && record[f.name] != null)
          .map((f) => (
            <Typography
              key={f.name}
              variant="body2"
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
            >
              <span>{f.label}</span>
              <Mono title={String(record[f.name])}>
                {f.name === 'id' ? String(record.id).slice(0, 8) : minute(record[f.name])}
              </Mono>
            </Typography>
          ))}
      </AsideGroup>
      {children.length > 0 && (
        <AsideGroup title="Records that point at this one">
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
              <span title={revision.operation}>
                <Tag>{operationWord(revision.operation)}</Tag>
              </span>{' '}
              <Mono>{minute(revision.at)}</Mono> {revision.actor}
            </Typography>
          ))
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            None that you may read: a workspace's owners read its history.
          </Typography>
        )}
      </AsideGroup>
    </Aside>
  )
}
