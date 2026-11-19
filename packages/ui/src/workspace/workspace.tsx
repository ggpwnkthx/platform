import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { schemaPrivileges, workspaceTarget } from '@platform/vocabulary'
import { schemaGrantStatement, workspaceStatements } from '@platform/vocabulary'
import { roles as readRoles, schemaGrants } from '@platform/data'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace } from '../shell.tsx'
import { presentationOf } from '@platform/data'
import { href } from '../url.ts'
import { Badge, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select } from '../ui/form.tsx'
import { GrantIcon, iconFor, PlusIcon, TrashIcon, WorkspaceIcon } from '../ui/icons.tsx'
import { Confirm, Drawer } from '../ui/overlay.tsx'
import { KeyEditorPanels, MetadataPanel } from '../metadata/metadata.tsx'
import { useRunner } from '../access/runner.tsx'

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
  const grants = useLoad(ws ? (db) => schemaGrants(db, ws) : null, [ws, catalog])
  const roles = useLoad((db) => readRoles(db), [])
  const runner = useRunner()
  const [composing, setComposing] = useState(false)
  const [grantee, setGrantee] = useState('')
  const [chosen, setChosen] = useState<string[]>(['USAGE'])
  const [revoking, setRevoking] = useState<{ grantee: string; privilege: string } | null>(null)
  const owner = Boolean(schema?.can_alter)
  if (!schema)
    return (
      <Page title="Workspace settings" icon={<WorkspaceIcon size={22} />}>
        <Notice tone="warning" title={`PostgreSQL shows you no workspace named ${ws}`} />
      </Page>
    )
  let statement = ''
  let invalid: string | null = null
  try {
    statement = schemaGrantStatement(ws, chosen, grantee)
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
  const byGrantee = new Map<string, string[]>()
  for (const g of grants.data ?? [])
    byGrantee.set(g.grantee, [...(byGrantee.get(g.grantee) ?? []), g.privilege])
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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <KeyEditorPanels target={workspaceTarget(ws)} owner={owner} />
      <MetadataPanel target={workspaceTarget(ws)} owner={owner} />
      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>Who may use this workspace</h2>
            <p>
              USAGE lets a role reach the collections inside, subject to their own grants. CREATE
              lets it make collections here.
            </p>
          </div>
          {owner && (
            <Button icon={<GrantIcon size={16} />} onClick={() => setComposing(true)}>
              Grant
            </Button>
          )}
        </header>
        {grants.error ? (
          <Notice tone="danger" title={describe(grants.error).title} />
        ) : !grants.data ? (
          <Loading />
        ) : (
          <table class="grid grid-plain">
            <thead>
              <tr>
                <th>Role</th>
                <th>Privileges</th>
                {owner && (
                  <th class="grid-actions">
                    <span class="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {[...byGrantee].map(([who, privileges]) => (
                <tr key={who}>
                  <td class="mono">
                    {who}
                    {who === schema.owner && <Badge tone="outline">owner</Badge>}
                  </td>
                  <td>
                    {privileges.map((p) => (
                      <Badge key={p} tone="primary">
                        {p}
                      </Badge>
                    ))}
                  </td>
                  {owner && (
                    <td class="grid-actions">
                      {who !== schema.owner &&
                        privileges.map((p) => (
                          <button
                            key={p}
                            type="button"
                            class="icon-button"
                            aria-label={`Revoke ${p} from ${who}`}
                            title={`Revoke ${p}`}
                            onClick={() => setRevoking({ grantee: who, privilege: p })}
                          >
                            <TrashIcon size={16} />
                          </button>
                        ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Drawer
        open={composing}
        onClose={() => setComposing(false)}
        title={`Grant on ${ws}`}
        footer={
          <>
            <Button onClick={() => setComposing(false)}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!!invalid}
              onClick={async () => {
                if (await runner.runStatements([statement], 'Granted')) {
                  setComposing(false)
                  grants.reload()
                }
              }}
            >
              Grant
            </Button>
          </>
        }
      >
        <div class="form">
          <Field label="To" id="sg-role" wide required>
            <Select
              id="sg-role"
              value={grantee}
              onChange={(e) => setGrantee(e.currentTarget.value)}
            >
              <option value="">Choose a role</option>
              <option value="PUBLIC">PUBLIC (everyone)</option>
              {roles.data?.roles
                .filter((r) => !r.name.startsWith('pg_'))
                .map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div class="field field-wide checks">
            {schemaPrivileges.map((p) => (
              <Checkbox
                key={p}
                label={p}
                checked={chosen.includes(p)}
                onChange={(on) => setChosen(on ? [...chosen, p] : chosen.filter((x) => x !== p))}
              />
            ))}
          </div>
        </div>
        {statement && <Statement sql={statement} />}
      </Drawer>
      <Confirm
        open={revoking !== null}
        title="Revoke this privilege?"
        confirm="Revoke"
        busy={runner.busy}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return
          if (
            await runner.runStatements(
              [schemaGrantStatement(ws, [revoking.privilege], revoking.grantee, true)],
              'Revoked'
            )
          ) {
            setRevoking(null)
            grants.reload()
          }
        }}
      >
        {revoking && (
          <Statement sql={schemaGrantStatement(ws, [revoking.privilege], revoking.grantee, true)} />
        )}
      </Confirm>
    </Page>
  )
}
