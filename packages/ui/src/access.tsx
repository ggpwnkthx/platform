import {
  ActionIcon,
  Autocomplete,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import {
  columnPrivileges,
  createRoleStatements,
  dropPolicyStatement,
  dropRoleStatement,
  type GrantInfo,
  grantChangeStatements,
  grants as readGrants,
  grantStatement,
  type Held,
  type Hold,
  membershipStatement,
  policies as readPolicies,
  type PolicyCommand,
  policyChecks,
  policyCommands,
  type PolicyDraft,
  type PolicyInfo,
  policyReads,
  policyStatement,
  reach as readReach,
  type ReachInfo,
  reservedRole,
  roles as readRoles,
  rowSecurityStatement,
  schemaPrivileges,
  schemaReach,
  tablePrivileges,
  tablesIn,
  type Wanted,
} from '@platform/core'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Change,
  Empty,
  Page,
  Privilege,
  PrivilegeLegend,
  Problem,
  Remove,
  RoleName,
  Section,
  Tag,
} from './bits.tsx'
import type { Field } from './fields.tsx'
import { useDb, usePlace, useSession } from './session.tsx'
import { useNames } from './shell.tsx'

/**
 * Access is one thing — PostgreSQL's ACLs, memberships and row policies — read from four
 * places and drawn the same way in each. Nothing here is the interface's own answer: the
 * editors compose statements, and PostgreSQL says whether the reader may run them.
 */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const useRoles = () => useDb(['roles'], readRoles)
const useGrants = (schema: string) =>
  useDb(['grants', schema], (db) => readGrants(db, schema), !!schema)
/** A role, with what the reader may know of it: a group is drawn as one. */
function Role({ name, link }: { name: string; link?: string }) {
  const known = useRoles().data?.roles.find((r) => r.name === name)
  return <RoleName name={name} group={known ? !known.login : undefined} link={link} />
}
const reachOf = (row: ReachInfo, privilege: string) =>
  row[privilege.toLowerCase() as 'select'] as Hold | boolean
const holdsAny = (row: ReachInfo) =>
  tablePrivileges.some((p) => ![false, 'none'].includes(reachOf(row, p)))

/** What a role holds by name on a collection, as its ACL and its fields' ACLs record it. */
function heldBy(grants: GrantInfo[], table: string, role: string): Record<string, Held> {
  const held: Record<string, Held> = {}
  for (const g of grants) {
    if (g.table !== table || !same(g.grantee, role)) continue
    held[g.privilege] ??= { whole: false, columns: [] }
    const one = held[g.privilege]!
    if (g.column) one.columns.push(g.column)
    else one.whole = true
  }
  return held
}

// ---------------------------------------------------------------------------- the grant

/**
 * One role on one collection: each privilege not held, held on the whole collection, or held
 * on chosen fields. What runs is the difference between what the ACL records and what is asked.
 */
function GrantEditor({
  schema,
  table,
  role: given,
  onClose,
}: {
  schema: string
  table: string
  role?: string
  onClose(): void
}) {
  const { catalog } = useSession()
  const [role, setRole] = useState(given ?? '')
  const [edits, setEdits] = useState<Record<string, Wanted>>({})
  const [usage, setUsage] = useState(true)
  const known = useRoles()
  const grants = useGrants(schema)
  const reached = useDb(['schemaReach', schema], (db) => schemaReach(db, schema))
  const columns = catalog.columns
    .filter((c) => c.schema === schema && c.table === table)
    .map((c) => c.name)
  const held = heldBy(grants.data ?? [], table, role)
  const wanted = (p: string): Wanted =>
    edits[p] ?? (held[p]?.whole ? 'all' : held[p]?.columns.length ? held[p]!.columns : 'none')
  const owner = catalog.schemas.find((s) => s.name === schema)?.can_alter
  // A grant on a collection is of no use without USAGE on the workspace.
  const lacksUsage = !!role && !reached.data?.find((r) => same(r.role, role))?.usage
  return (
    <Change
      title={`Grant on ${table}`}
      opened
      onClose={onClose}
      statements={() => {
        if (!role.trim()) throw new Error('Choose the role the grant is for.')
        const statements = grantChangeStatements({
          schema,
          table,
          grantee: role,
          held,
          wanted: edits,
        })
        const grantsSomething = statements.some((s) => s.startsWith('GRANT'))
        return [
          ...(lacksUsage && owner && usage && grantsSomething
            ? [grantStatement({ schema, table: null, privileges: ['USAGE'], grantee: role })]
            : []),
          ...statements,
        ]
      }}
    >
      <Autocomplete
        label="Role"
        description="The roles you may see are offered; any other may be typed."
        className="mono"
        disabled={!!given}
        data={[
          ...(known.data?.roles ?? []).map((r) => r.name).filter((name) => !reservedRole(name)),
          'public',
        ]}
        value={role}
        onChange={(next) => {
          setRole(next)
          setEdits({})
        }}
      />
      <PrivilegeLegend />
      {tablePrivileges.map((p) => {
        const want = wanted(p)
        const narrowable = (columnPrivileges as readonly string[]).includes(p)
        return (
          <Stack key={p} gap={6}>
            <Group justify="space-between">
              <Privilege
                name={p}
                held={want === 'all' ? 'all' : want === 'none' ? 'none' : 'some'}
                count={Array.isArray(want) ? `${want.length}/${columns.length}` : undefined}
              />
              <SegmentedControl
                size="xs"
                value={Array.isArray(want) ? 'fields' : want}
                data={[
                  { value: 'none', label: 'Not held' },
                  { value: 'all', label: 'Whole collection' },
                  ...(narrowable ? [{ value: 'fields', label: 'Chosen fields' }] : []),
                ]}
                onChange={(next) =>
                  setEdits({
                    ...edits,
                    [p]:
                      next === 'fields'
                        ? held[p]?.columns.length
                          ? held[p]!.columns
                          : columns
                        : (next as Wanted),
                  })
                }
              />
            </Group>
            {Array.isArray(want) && (
              <MultiSelect
                data={columns}
                value={want}
                onChange={(next) => setEdits({ ...edits, [p]: next })}
                className="mono"
                description={
                  held[p]?.whole
                    ? 'A field added later will not be among the ones named.'
                    : undefined
                }
              />
            )}
          </Stack>
        )
      })}
      {lacksUsage &&
        (owner ? (
          <Checkbox
            label={`Also GRANT USAGE on ${schema}: without it the grant is of no use`}
            checked={usage}
            onChange={(e) => setUsage(e.currentTarget.checked)}
          />
        ) : (
          <Text fz="sm" c="dimmed">
            {role} holds no USAGE on {schema}; its owner grants that.
          </Text>
        ))}
    </Change>
  )
}

/** Marks for a set of role × collection rows; a row opens the grant it draws. */
function ReachTable({
  rows,
  by,
  grants,
  edit,
  origin,
}: {
  rows: ReachInfo[]
  by: 'role' | 'table'
  grants: GrantInfo[]
  edit?: (row: ReachInfo) => void
  origin?: (row: ReachInfo) => string
}) {
  const { catalog } = useSession()
  const place = usePlace()
  if (!rows.length) return <Empty>Nobody is granted anything here that you may see.</Empty>
  return (
    <Table verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{by === 'role' ? 'Role' : 'Collection'}</Table.Th>
          <Table.Th>Privileges</Table.Th>
          {origin && <Table.Th>Comes from</Table.Th>}
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => {
          const total = catalog.columns.filter(
            (c) => c.schema === place.ws && c.table === row.table
          ).length
          const held = heldBy(grants, row.table, row.role)
          return (
            <Table.Tr key={`${row.role}/${row.table}`}>
              <Table.Td>
                {by === 'role' ? (
                  <Role name={row.role} link={place.to('/access/role', { r: row.role })} />
                ) : (
                  <span className="mono">{row.table}</span>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap="md">
                  {tablePrivileges.map((p) => (
                    <Privilege
                      key={p}
                      name={p}
                      held={reachOf(row, p)}
                      count={
                        held[p]?.columns.length ? `${held[p]!.columns.length}/${total}` : undefined
                      }
                    />
                  ))}
                </Group>
                {!row.usage && (
                  <Text fz="xs" c="yellow.9">
                    No USAGE on the workspace: none of this can be used yet.
                  </Text>
                )}
              </Table.Td>
              {origin && (
                <Table.Td fz="sm" c="dimmed">
                  {origin(row)}
                </Table.Td>
              )}
              <Table.Td ta="right">
                {edit && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Change this grant"
                    title="Change this grant"
                    onClick={() => edit(row)}
                  >
                    <Pencil size={16} />
                  </ActionIcon>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}

/** Who may use a workspace and who may make collections in it. */
export function SchemaAccess({ schema }: { schema: string }) {
  const { catalog } = useSession()
  const reached = useDb(['schemaReach', schema], (db) => schemaReach(db, schema), !!schema)
  const grants = useGrants(schema)
  const [editing, setEditing] = useState<{ role: string; wanted: string[]; fixed: boolean } | null>(
    null
  )
  const owner = catalog.schemas.find((s) => s.name === schema)?.can_alter
  const direct = (role: string) =>
    (grants.data ?? []).filter((g) => !g.table && same(g.grantee, role)).map((g) => g.privilege)
  return (
    <Section
      title="The workspace"
      note="USAGE lets a role reach the collections it is granted; CREATE lets it make collections of its own."
      actions={
        owner && (
          <Button
            variant="default"
            leftSection={<Plus size={14} />}
            onClick={() => setEditing({ role: '', wanted: ['USAGE'], fixed: false })}
          >
            Grant
          </Button>
        )
      }
    >
      <Problem error={reached.error} />
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {(reached.data ?? [])
            .filter((r) => r.usage || r.create)
            .map((r) => (
              <Table.Tr key={r.role}>
                <Table.Td>
                  <Role name={r.role} />
                </Table.Td>
                <Table.Td>
                  <Group gap="md">
                    <Privilege name="USAGE" held={r.usage} />
                    <Privilege name="CREATE" held={r.create} />
                  </Group>
                </Table.Td>
                <Table.Td ta="right">
                  {owner && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Change"
                      onClick={() =>
                        setEditing({ role: r.role, wanted: direct(r.role), fixed: true })
                      }
                    >
                      <Pencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      {editing && (
        <Change
          title={`Grant on ${schema}`}
          opened
          onClose={() => setEditing(null)}
          statements={() => {
            if (!editing.role.trim()) throw new Error('Choose the role.')
            const held = direct(editing.role)
            const draft = (privileges: string[]) => ({
              schema,
              table: null,
              privileges,
              grantee: editing.role,
            })
            const give = editing.wanted.filter((p) => !held.includes(p))
            const take = held.filter((p) => !editing.wanted.includes(p))
            return [
              ...(take.length ? [grantStatement(draft(take), true)] : []),
              ...(give.length ? [grantStatement(draft(give))] : []),
            ]
          }}
        >
          <TextInput
            label="Role"
            className="mono"
            disabled={editing.fixed}
            value={editing.role}
            onChange={(e) => setEditing({ ...editing, role: e.currentTarget.value })}
          />
          <Checkbox.Group
            label="Granted to it by name"
            description="A right it holds through a group or as PUBLIC is changed there."
            value={editing.wanted}
            onChange={(wanted) => setEditing({ ...editing, wanted })}
          >
            <Group mt="xs">
              {schemaPrivileges.map((p) => (
                <Checkbox key={p} value={p} label={<span className="mono">{p}</span>} />
              ))}
            </Group>
          </Checkbox.Group>
        </Change>
      )}
    </Section>
  )
}

// --------------------------------------------------------------------------- the policies

const draftOf = (schema: string, table: string, p?: PolicyInfo): PolicyDraft => ({
  schema,
  table,
  name: p?.name ?? '',
  permissive: p ? p.permissive === 'PERMISSIVE' : true,
  command: (p?.command ?? 'ALL') as PolicyCommand,
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
  const known = useRoles()
  const [editing, setEditing] = useState<{ draft: PolicyDraft; was?: string } | null>(null)
  const [change, setChange] = useState<{
    title: string
    statements: string[]
    danger?: boolean
  } | null>(null)
  const draft = editing?.draft
  const set = (changes: Partial<PolicyDraft>) =>
    editing && setEditing({ ...editing, draft: { ...editing.draft, ...changes } })
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
                    <Button
                      variant="default"
                      leftSection={<Plus size={14} />}
                      onClick={() => setEditing({ draft: draftOf(schema, t.name) })}
                    >
                      New policy
                    </Button>
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
      {draft && (
        // PostgreSQL alters a policy's roles and expressions in place but not what it is for:
        // a changed policy is dropped and made again, in the one transaction every change runs in.
        <Change
          title={editing.was ? `Policy ${editing.was}` : `New policy on ${draft.table}`}
          opened
          onClose={() => setEditing(null)}
          statements={() => {
            if (!draft.using.trim() && !draft.check.trim())
              throw new Error('A policy needs a USING or a WITH CHECK expression.')
            return [
              ...(editing.was ? [dropPolicyStatement(schema, draft.table, editing.was)] : []),
              policyStatement(draft),
            ]
          }}
        >
          <TextInput
            label="Name"
            className="mono"
            value={draft.name}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
          <Group grow>
            <Select
              label="For"
              allowDeselect={false}
              data={[...policyCommands]}
              value={draft.command}
              onChange={(command) => set({ command: command as PolicyCommand })}
            />
            <Switch
              label="Restrictive: narrows what other policies allow"
              checked={!draft.permissive}
              onChange={(e) => set({ permissive: !e.currentTarget.checked })}
              mt="lg"
            />
          </Group>
          <TagsInput
            label="Applies to"
            description="No role means PUBLIC: everyone."
            className="mono"
            data={[...(known.data?.roles ?? []).map((r) => r.name), 'public']}
            value={draft.roles}
            onChange={(roles) => set({ roles })}
          />
          {policyReads(draft.command) && (
            <Textarea
              label="USING"
              description="The rows the role may see or change"
              className="mono"
              autosize
              minRows={2}
              value={draft.using}
              onChange={(e) => set({ using: e.currentTarget.value })}
              placeholder="created_by = session_user"
            />
          )}
          {policyChecks(draft.command) && (
            <Textarea
              label="WITH CHECK"
              description="The rows the role may write"
              className="mono"
              autosize
              minRows={2}
              value={draft.check}
              onChange={(e) => set({ check: e.currentTarget.value })}
            />
          )}
        </Change>
      )}
    </>
  )
}

// ------------------------------------------------------------------------------ the pages

/** A collection's access: the roles its ACL names, who reads and writes each field, its row security. */
export function CollectionAccess({
  schema,
  table,
  fields,
}: {
  schema: string
  table: string
  fields: Field[]
}) {
  const { catalog } = useSession()
  const grants = useGrants(schema)
  const reached = useDb(['reach', schema, table], (db) => readReach(db, schema, { table }))
  const [editing, setEditing] = useState<string | null>(null)
  const owner = catalog.tables.find((t) => t.schema === schema && t.name === table)?.can_alter
  const acl = (grants.data ?? []).filter((g) => g.table === table)
  const named = (role: string) => acl.some((g) => same(g.grantee, role))
  const rows = (reached.data ?? []).filter(holdsAny)
  const holders = (column: string, privilege: string) =>
    acl.filter((g) => g.privilege === privilege && (!g.column || g.column === column))
  return (
    <>
      <Section
        title="Granted by name"
        note="The roles the collection's ACL names, and what each holds."
        actions={
          owner && (
            <Button
              variant="default"
              leftSection={<Plus size={14} />}
              onClick={() => setEditing('')}
            >
              Grant
            </Button>
          )
        }
      >
        <PrivilegeLegend />
        <Problem error={reached.error ?? grants.error} />
        <ReachTable
          rows={rows.filter((r) => named(r.role))}
          by="role"
          grants={acl}
          edit={owner ? (row) => setEditing(row.role) : undefined}
        />
      </Section>
      <Section
        title="Reaching it through another role"
        note="Roles that hold something here without being named: through a group, or as PUBLIC."
      >
        <ReachTable rows={rows.filter((r) => !named(r.role))} by="role" grants={acl} />
      </Section>
      <Section
        title="The fields"
        note="Who reads and writes each field: through the whole collection, or by name."
      >
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Field</Table.Th>
              {columnPrivileges.slice(0, 3).map((p) => (
                <Table.Th key={p} className="mono">
                  {p}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {fields.map((f) => (
              <Table.Tr key={f.name}>
                <Table.Td className="mono">{f.name}</Table.Td>
                {columnPrivileges.slice(0, 3).map((p) => (
                  <Table.Td key={p}>
                    <Group gap={4}>
                      {holders(f.name, p).map((g) => (
                        <Tag key={g.grantee + g.column} color={g.column ? 'orange' : 'gray'}>
                          <span className="mono">{g.grantee}</span>
                        </Tag>
                      ))}
                    </Group>
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text fz="xs" c="dimmed" mt="xs">
          A role granted the field by name is marked; one that holds the whole collection is
          quieter.
        </Text>
      </Section>
      <PolicyCards schema={schema} table={table} />
      {editing !== null && (
        <GrantEditor
          schema={schema}
          table={table}
          role={editing || undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** The workspace's permissions: who may use it, and every grant on its collections. */
export function Grants() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const grants = useGrants(place.ws)
  const reached = useDb(['reach', place.ws], (db) => readReach(db, place.ws), !!place.ws)
  const [editing, setEditing] = useState<{ table: string; role?: string } | null>(null)
  const named = (row: ReachInfo) =>
    (grants.data ?? []).some((g) => g.table === row.table && same(g.grantee, row.role))
  return (
    <Page title="Permissions" crumbs={['Access', names(place.ws).name]}>
      <SchemaAccess schema={place.ws} />
      <PrivilegeLegend />
      <Problem error={reached.error ?? grants.error} />
      {tablesIn(catalog, place.ws).map((t) => (
        <Section
          key={t.name}
          title={<span className="mono">{t.name}</span>}
          note={`Owned by ${t.owner}.`}
          actions={
            t.can_alter && (
              <Button
                variant="default"
                leftSection={<Plus size={14} />}
                onClick={() => setEditing({ table: t.name })}
              >
                Grant
              </Button>
            )
          }
        >
          <ReachTable
            rows={(reached.data ?? []).filter((r) => r.table === t.name && named(r))}
            by="role"
            grants={grants.data ?? []}
            edit={t.can_alter ? (row) => setEditing(row) : undefined}
          />
        </Section>
      ))}
      {editing && <GrantEditor schema={place.ws} {...editing} onClose={() => setEditing(null)} />}
    </Page>
  )
}

export function Policies() {
  const place = usePlace()
  const names = useNames()
  return (
    <Page title="Row policies" crumbs={['Access', names(place.ws).name]}>
      <PolicyCards schema={place.ws} />
    </Page>
  )
}

const attributes = (r: { superuser: boolean; create_role: boolean; bypass_rls: boolean }) => (
  <Group gap={4}>
    {r.superuser && <Tag color="red">superuser</Tag>}
    {r.create_role && <Tag color="blue">makes roles</Tag>}
    {r.bypass_rls && <Tag color="yellow">bypasses row security</Tag>}
  </Group>
)
/** The roles the reader may see — their own, or all of them for an operator — and a new one. */
export function Roles() {
  const { identity } = useSession()
  const place = usePlace()
  const found = useRoles()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<{ name: string; login: boolean } | null>(null)
  const all = (found.data?.roles ?? []).filter(
    (r) => !r.name.startsWith('pg_') && r.name.includes(search)
  )
  const me = found.data?.roles.find((r) => r.name === identity.username)
  const count = (role: string, side: 'role' | 'member') =>
    found.data?.memberships.filter((m) => m[side] === role).length ?? 0
  return (
    <Page
      title="Roles"
      crumbs={['Access', 'Users and groups']}
      actions={
        (me?.create_role || me?.superuser) && (
          <ActionIcon
            size={44}
            radius="xl"
            aria-label="New role"
            title="New role"
            onClick={() => setDraft({ name: '', login: true })}
          >
            <Plus />
          </ActionIcon>
        )
      }
    >
      <TextInput
        placeholder="Search roles"
        radius="xl"
        w={320}
        mb="sm"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Problem error={found.error} />
      <Text fz="sm" c="dimmed" mb="sm">
        A user is a PostgreSQL LOGIN role named after the address they sign in with; a group is a
        NOLOGIN role.{' '}
        {identity.is_operator ? '' : 'You see your own roles; an operator sees them all.'}
      </Text>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Role</Table.Th>
            <Table.Th>Kind</Table.Th>
            <Table.Th>Member of</Table.Th>
            <Table.Th>Members</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {all.map((r) => (
            <Table.Tr key={r.name}>
              <Table.Td>
                <RoleName
                  name={r.name}
                  group={!r.login}
                  link={place.to('/access/role', { r: r.name })}
                />
              </Table.Td>
              <Table.Td>
                {r.login ? 'User' : 'Group'}
                {reservedRole(r.name) && (
                  <Text span c="dimmed">
                    {' '}
                    · the platform’s own
                  </Text>
                )}
              </Table.Td>
              <Table.Td className="mono">{count(r.name, 'member') || ''}</Table.Td>
              <Table.Td className="mono">{count(r.name, 'role') || ''}</Table.Td>
              <Table.Td>{attributes(r)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {draft && (
        <Change
          title="New role"
          opened
          onClose={() => setDraft(null)}
          statements={() => createRoleStatements(draft)}
        >
          <TextInput
            label="Name"
            description={
              draft.login
                ? 'The address the person signs in with: the claim their token carries.'
                : 'A group: it holds rights for its members and cannot log in.'
            }
            className="mono"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
          />
          <SegmentedControl
            data={[
              { value: 'user', label: 'A user (LOGIN)' },
              { value: 'group', label: 'A group (NOLOGIN)' },
            ]}
            value={draft.login ? 'user' : 'group'}
            onChange={(kind) => setDraft({ ...draft, login: kind === 'user' })}
          />
        </Change>
      )}
    </Page>
  )
}

/** One role: its memberships, what it may do in the workspace in view, the policies that apply to it. */
export function RoleDetail() {
  const { identity, catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const name = place.params.get('r') ?? identity.username
  const found = useRoles()
  const grants = useGrants(place.ws)
  const reached = useDb(
    ['reach', place.ws, 'role', name],
    (db) => readReach(db, place.ws, { role: name }),
    !!place.ws
  )
  const usage = useDb(['schemaReach', place.ws], (db) => schemaReach(db, place.ws), !!place.ws)
  const rules = useDb(['policies', place.ws, null], (db) => readPolicies(db, place.ws), !!place.ws)
  const [change, setChange] = useState<{
    title: string
    statements: string[]
    danger?: boolean
    leave?: boolean
  } | null>(null)
  const [adding, setAdding] = useState<{
    side: 'role' | 'member'
    other: string
    admin: boolean
  } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const role = found.data?.roles.find((r) => r.name === name)
  const all = found.data?.roles ?? []
  const memberships = found.data?.memberships ?? []
  const me = all.find((r) => r.name === identity.username)
  const groups = memberships.filter((m) => m.member === name)
  const members = memberships.filter((m) => m.role === name)
  const through = [name, ...groups.map((g) => g.role), 'public']
  const admits = (group: string) => all.find((r) => r.name === group)?.admits
  const here = usage.data?.find((r) => same(r.role, name))
  // Where a right comes from: the role's own grants, or the groups it inherits from.
  const origin = (row: ReachInfo) => {
    const owner = catalog.tables.find((t) => t.schema === place.ws && t.name === row.table)?.owner
    const sources = [
      ...new Set((grants.data ?? []).filter((g) => g.table === row.table).map((g) => g.grantee)),
    ].filter((g) => through.some((t) => same(t, g)))
    return [
      ...(owner && through.includes(owner) ? [`owner${owner === name ? '' : ` (${owner})`}`] : []),
      ...sources.map((s) => (same(s, name) ? 'its own grants' : s)),
    ].join(', ')
  }
  const applying = (rules.data ?? []).filter((p) =>
    p.roles.some((r) => through.some((t) => same(t, r)))
  )
  if (found.isSuccess && !role)
    return (
      <Page title="Role">
        <Empty>There is no role {name} that you may see.</Empty>
      </Page>
    )
  return (
    <Page
      title={<span className="mono">{name}</span>}
      crumbs={['Access', role?.login ? 'User' : 'Group']}
      actions={role && attributes(role)}
    >
      <Section
        title="Member of"
        note="The groups it belongs to: it holds what they hold."
        actions={
          <Button
            variant="default"
            leftSection={<Plus size={14} />}
            onClick={() => setAdding({ side: 'role', other: '', admin: false })}
          >
            Add to a group
          </Button>
        }
      >
        {!groups.length && <Empty>No group you may see.</Empty>}
        <Table verticalSpacing="xs">
          <Table.Tbody>
            {groups.map((m) => (
              <Table.Tr key={m.role}>
                <Table.Td>
                  <RoleName name={m.role} group link={place.to('/access/role', { r: m.role })} />
                </Table.Td>
                <Table.Td>{m.admin_option && <Tag color="blue">may admit others</Tag>}</Table.Td>
                <Table.Td ta="right">
                  {admits(m.role) && (
                    <Remove
                      label={`Remove from ${m.role}`}
                      onClick={() =>
                        setChange({
                          title: `Remove from ${m.role}`,
                          danger: true,
                          statements: [membershipStatement({ role: m.role, member: name }, true)],
                        })
                      }
                    />
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>
      {role && !role.login && (
        <Section
          title="Members"
          note="The roles that belong to this group."
          actions={
            role.admits && (
              <Button
                variant="default"
                leftSection={<Plus size={14} />}
                onClick={() => setAdding({ side: 'member', other: '', admin: false })}
              >
                Add a member
              </Button>
            )
          }
        >
          {!members.length && <Empty>No member you may see.</Empty>}
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {members.map((m) => (
                <Table.Tr key={m.member}>
                  <Table.Td>
                    <RoleName name={m.member} link={place.to('/access/role', { r: m.member })} />
                  </Table.Td>
                  <Table.Td ta="right">
                    {role.admits && (
                      <Remove
                        label={`Remove ${m.member}`}
                        onClick={() =>
                          setChange({
                            title: `Remove ${m.member}`,
                            danger: true,
                            statements: [
                              membershipStatement({ role: name, member: m.member }, true),
                            ],
                          })
                        }
                      />
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      )}
      <Section
        title={`In ${names(place.ws).name}`}
        note="PostgreSQL's own answer for this role, so a right held through a group or as PUBLIC counts."
      >
        <Group gap="md" mb="sm">
          <Privilege name="USAGE" held={!!here?.usage} />
          <Privilege name="CREATE" held={!!here?.create} />
          <PrivilegeLegend />
        </Group>
        <Problem error={reached.error} />
        <ReachTable
          rows={(reached.data ?? []).filter(holdsAny)}
          by="table"
          grants={(grants.data ?? []).filter((g) => same(g.grantee, name))}
          origin={origin}
          edit={(row) =>
            catalog.tables.find((t) => t.schema === place.ws && t.name === row.table)?.can_alter &&
            setEditing(row.table)
          }
        />
      </Section>
      <Section
        title="Row policies"
        note="The ones that apply to it by name, through a group, or as PUBLIC."
      >
        {!applying.length && <Empty>No policy you may see applies to this role.</Empty>}
        {applying.map((p) => (
          <Text key={p.table + p.name} fz="sm" mb={4}>
            <span className="mono">
              {p.table}.{p.name}
            </span>{' '}
            <Tag color="blue">{p.command}</Tag>{' '}
            <Text span className="mono" c="blue.9">
              {p.using ?? p.check}
            </Text>
          </Text>
        ))}
      </Section>
      {(me?.create_role || me?.superuser) && name !== identity.username && !reservedRole(name) && (
        <Section
          title="Remove the role"
          note="PostgreSQL refuses while the role still owns or is granted something."
        >
          <Button
            color="red"
            variant="light"
            onClick={() =>
              setChange({
                title: `Drop ${name}`,
                danger: true,
                leave: true,
                statements: [dropRoleStatement(name)],
              })
            }
          >
            Drop {name}
          </Button>
        </Section>
      )}
      {change && (
        <Change
          title={change.title}
          opened
          danger={change.danger}
          onClose={() => setChange(null)}
          done={() => change.leave && navigate(place.to('/access'))}
          statements={() => change.statements}
        />
      )}
      {adding && (
        <Change
          title={adding.side === 'role' ? `Add ${name} to a group` : `Add a member to ${name}`}
          opened
          onClose={() => setAdding(null)}
          statements={() => [
            membershipStatement(
              adding.side === 'role'
                ? { role: adding.other, member: name, admin: adding.admin }
                : { role: name, member: adding.other, admin: adding.admin }
            ),
          ]}
        >
          <Autocomplete
            label={adding.side === 'role' ? 'Group' : 'Member'}
            className="mono"
            value={adding.other}
            onChange={(other) => setAdding({ ...adding, other })}
            data={all
              .filter(
                (r) =>
                  (adding.side === 'role' ? !r.login && r.admits : true) &&
                  r.name !== name &&
                  !r.name.startsWith('pg_')
              )
              .map((r) => r.name)}
          />
          <Checkbox
            label="WITH ADMIN OPTION: it may admit others"
            checked={adding.admin}
            onChange={(e) => setAdding({ ...adding, admin: e.currentTarget.checked })}
          />
        </Change>
      )}
      {editing && (
        <GrantEditor
          schema={place.ws}
          table={editing}
          role={name}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  )
}
