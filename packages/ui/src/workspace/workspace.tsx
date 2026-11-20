import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { workspaceStatements, workspaceTarget } from '@platform/vocabulary'
import { roles as readRoles } from '@platform/data'
import { useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace } from '../shell.tsx'
import { presentationOf } from '@platform/data'
import { href } from '../url.ts'
import { Notice, Statement } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import { iconFor, PlusIcon, WorkspaceIcon } from '../ui/icons.tsx'
import { KeyEditorPanels, MetadataPanel } from '../metadata/metadata.tsx'
import { useRunner } from '../access/runner.tsx'
import { WorkspaceGrants } from '../access/workspace-access.tsx'

export function NewWorkspace() {
  const { identity } = useSession()
  const location = useLocation()
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const runner = useRunner()
  const roles = useLoad((db) => readRoles(db), [])
  let statements: string[] = []
  let invalid: string | null = null
  try {
    statements = name ? workspaceStatements(name, owner || null) : []
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
  return (
    <Page
      title="New workspace"
      icon={<WorkspaceIcon size={22} />}
      subtitle="A workspace is a PostgreSQL schema. Its owner administers its model."
      actions={
        <Action
          label="Create workspace"
          icon={<PlusIcon size={22} />}
          busy={runner.busy}
          disabled={!name || !!invalid || !identity?.can_create_workspace}
          onClick={async () => {
            if (await runner.runStatements(statements, `Created ${name}`))
              location.route(href('/content', { ws: name }))
          }}
        />
      }
    >
      {!identity?.can_create_workspace && (
        <Notice tone="warning" title="PostgreSQL gives you no CREATE on this database">
          Making a workspace needs it. An operator grants it with{' '}
          <span class="mono">GRANT CREATE ON DATABASE …</span>
        </Notice>
      )}
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <section class="panel">
        <div class="form">
          <Field label="Name" id="ws-name" required hint="The schema's name." error={invalid}>
            <Input
              id="ws-name"
              mono
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="newsroom"
            />
          </Field>
          <Field
            label="Owner"
            id="ws-owner"
            hint="A group owning it lets its members administer the model together. You must be a member of the role you choose."
          >
            <Select id="ws-owner" value={owner} onChange={(e) => setOwner(e.currentTarget.value)}>
              <option value="">You ({identity?.username})</option>
              {roles.data?.roles
                .filter((r) => r.name !== identity?.username && !r.name.startsWith('pg_'))
                .map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.login ? '' : ' (group)'}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </section>
      {statements.length > 0 && <Statement sql={statements.join('\n')} />}
    </Page>
  )
}

export function WorkspaceSettings() {
  const { catalog, presentations } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  const WorkspaceGlyph = iconFor(shown.icon) ?? WorkspaceIcon
  const roles = useLoad((db) => readRoles(db), [])
  const owner = Boolean(schema?.can_alter)
  if (!schema)
    return (
      <Page title="Workspace settings" icon={<WorkspaceIcon size={22} />}>
        <Notice tone="warning" title={`PostgreSQL shows you no workspace named ${ws}`} />
      </Page>
    )
  return (
    <Page
      title={`${shown.displayName ?? ws} settings`}
      icon={<WorkspaceGlyph size={22} />}
      presentation={shown}
      crumbs={[
        { label: 'Content', href: href('/content', { ws }) },
        { label: shown.displayName ?? ws },
      ]}
      subtitle={`Owned by ${schema.owner}.`}
    >
      <KeyEditorPanels target={workspaceTarget(ws)} owner={owner} />
      <MetadataPanel target={workspaceTarget(ws)} owner={owner} />
      <WorkspaceGrants schema={schema} roles={roles.data?.roles ?? []} more />
    </Page>
  )
}
