import { ActionIcon, Button, Card, Code, Group, Stack, Text } from '@mantine/core'
import {
  type PolicyDraft,
  type PolicyInfo,
  dropPolicyStatement,
  policies as readPolicies,
  rowSecurityStatement,
  tablesIn,
} from '@platform/core'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { AddButton } from '../bits/add.tsx'
import { Change } from '../bits/change.tsx'
import { Problem, Remove, Section, Tag } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { useDb } from '../session/hooks.ts'
import { PolicyEditor } from './policy-editor.tsx'

export const draftOf = (schema: string, table: string, p?: PolicyInfo): PolicyDraft => ({
  schema,
  table,
  name: p?.name ?? '',
  permissive: p ? p.permissive === 'PERMISSIVE' : true,
  command: (p?.command ?? 'ALL') as PolicyDraft['command'],
  roles: p?.roles ?? [],
  using: p?.using ?? '',
  check: p?.check ?? '',
})

/** The row policies of a workspace's collections, or of one: read, written, changed and dropped. */
export function PolicyCards({ schema, table }: { schema: string; table?: string }) {
  const { catalog } = useSession()
  const rules = useDb(
    ['policies', schema, table ?? null],
    (db) => readPolicies(db, schema, table),
    !!schema
  )
  const [editing, setEditing] = useState<{ draft: PolicyDraft; was?: string } | null>(null)
  const [change, setChange] = useState<{
    title: string
    statements: string[]
    danger?: boolean
  } | null>(null)
  return (
    <>
      <Problem error={rules.error} />
      {tablesIn(catalog, schema)
        .filter((t) => t.kind !== 'v' && (!table || t.name === table))
        .map((t) => {
          const own = (rules.data ?? []).filter((p) => p.table === t.name)
          return (
            <Section
              key={t.name}
              title={<span className="mono">{t.name}</span>}
              note={
                t.rls
                  ? own.length
                    ? 'A row is reached when a policy that applies to the role allows it.'
                    : 'Row security is on and there is no policy: only the owner reaches a row.'
                  : 'Row security is off: grants alone decide which rows are reached.'
              }
              actions={
                t.can_alter && (
                  <>
                    <Button
                      variant="subtle"
                      onClick={() =>
                        setChange({
                          title: `Row security on ${t.name}`,
                          statements: [rowSecurityStatement(schema, t.name, !t.rls)],
                          danger: t.rls,
                        })
                      }
                    >
                      Turn row security {t.rls ? 'off' : 'on'}
                    </Button>
                    <AddButton onClick={() => setEditing({ draft: draftOf(schema, t.name) })}>
                      New policy
                    </AddButton>
                  </>
                )
              }
            >
              <Stack gap="sm">
                {own.map((p) => (
                  <Card key={p.name} withBorder radius="md" padding="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text className="mono" fw={600}>
                          {p.name}
                        </Text>
                        <Tag color="blue">{p.command}</Tag>
                        {p.permissive !== 'PERMISSIVE' && <Tag color="yellow">restrictive</Tag>}
                        {p.roles.map((r) => (
                          <Tag key={r}>
                            <span className="mono">{r}</span>
                          </Tag>
                        ))}
                        {p.applies && <Tag color="orange">applies to you</Tag>}
                      </Group>
                      {t.can_alter && (
                        <Group gap={4}>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`Change ${p.name}`}
                            onClick={() =>
                              setEditing({ draft: draftOf(schema, t.name, p), was: p.name })
                            }
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                          <Remove
                            label={`Drop ${p.name}`}
                            onClick={() =>
                              setChange({
                                title: `Drop ${p.name}`,
                                statements: [dropPolicyStatement(schema, t.name, p.name)],
                                danger: true,
                              })
                            }
                          />
                        </Group>
                      )}
                    </Group>
                    {p.using && (
                      <Code block mt={6} c="blue.9">
                        USING {p.using}
                      </Code>
                    )}
                    {p.check && (
                      <Code block mt={6} c="blue.9">
                        WITH CHECK {p.check}
                      </Code>
                    )}
                  </Card>
                ))}
              </Stack>
            </Section>
          )
        })}
      {change && (
        <Change
          title={change.title}
          opened
          danger={change.danger}
          onClose={() => setChange(null)}
          statements={() => change.statements}
        />
      )}
      <PolicyEditor
        schema={schema}
        editing={editing}
        onChange={setEditing}
        onClose={() => setEditing(null)}
      />
    </>
  )
}
