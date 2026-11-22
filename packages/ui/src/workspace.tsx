import { Button, Select, Stack, Text, TextInput } from '@mantine/core'
import { metadataStatement, roles, schemaStatement, workspaceTarget } from '@platform/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SchemaAccess } from './access.tsx'
import { Empty, ItemMark, Page, Problem, Statements } from './bits.tsx'
import { MetadataPanel } from './metadata.tsx'
import { useDb, usePlace, useSession } from './session.tsx'
import { useNames } from './shell.tsx'

/** A new workspace: a schema, owned by the reader or by a group that owns it for its members. */
export function NewWorkspace() {
  const { identity, run } = useSession()
  const navigate = useNavigate()
  const known = useDb(['roles'], roles)
  const [name, setName] = useState('')
  const [display, setDisplay] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<unknown>(null)
  let statements: string[] = []
  try {
    statements = [
      schemaStatement(name.trim(), owner),
      ...(display.trim()
        ? [metadataStatement(workspaceTarget(name.trim()), 'display_name', display.trim())]
        : []),
    ]
  } catch {
    statements = []
  }
  const groups = (known.data?.memberships ?? [])
    .filter((m) => m.member === identity.username)
    .map((m) => m.role)
  return (
    <Page
      title="New workspace"
      crumbs={['Workspace']}
      actions={
        <Button
          disabled={!statements.length}
          onClick={() =>
            run(statements).then(
              () => navigate(`/model?ws=${encodeURIComponent(name.trim())}`),
              setRefusal
            )
          }
        >
          Create
        </Button>
      }
    >
      <Stack maw={560}>
        <TextInput
          label="Name"
          description="The schema's name in PostgreSQL"
          className="mono"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label="Display name"
          description="The name people read"
          value={display}
          onChange={(e) => setDisplay(e.currentTarget.value)}
        />
        <Select
          label="Owner"
          description="A group that owns a workspace owns it for its members, and can be taken from one of them."
          placeholder={`${identity.username} (you)`}
          clearable
          className="mono"
          data={groups.filter((g) => !/^(pg_|platform_)/.test(g))}
          value={owner}
          onChange={setOwner}
        />
        <Text fz="sm" c="dimmed">
          The owner administers the model inside the workspace. PostgreSQL refuses the statement if
          you may not create a schema in this database.
        </Text>
        <Statements sql={statements} />
        <Problem error={refusal} />
      </Stack>
    </Page>
  )
}

/** The workspace in view: how it presents itself, what it says of itself, and who may use it. */
export function WorkspaceSettings() {
  const place = usePlace()
  const names = useNames()
  if (!place.schema)
    return (
      <Page title="Workspace">
        <Empty>The database gives you USAGE on no workspace yet.</Empty>
      </Page>
    )
  const said = names(place.ws)
  return (
    <Page
      title={said.name}
      crumbs={[
        'Workspace',
        <span key="n" className="mono">
          {place.ws}
        </span>,
      ]}
      mark={<ItemMark {...said} size={44} />}
    >
      <Text fz="sm" c="dimmed">
        Owned by <span className="mono">{place.schema.owner}</span>
        {place.schema.kind === 'system'
          ? '. The platform’s own workspace: its model is changed by migrations, never from here.'
          : '.'}
      </Text>
      <MetadataPanel target={workspaceTarget(place.ws)} canEdit={place.schema.can_alter} />
      <SchemaAccess schema={place.ws} />
    </Page>
  )
}
