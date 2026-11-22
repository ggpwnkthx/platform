import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { presentationOf, tablesIn } from '@platform/data'
import { useRunner } from '../access/runner.tsx'
import { Page } from '../shell/page.tsx'
import { useWorkspace } from '../workspace/view.ts'
import { href } from '../url.ts'
import { Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Field, Input } from '../ui/form.tsx'
import { CollectionIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx'
import { useSession } from '../session.tsx'
import { collectionStatements, emptyField, type FieldDraft, typeLabel } from './statements.ts'
import { FieldEditor } from './field/editor.tsx'
import { usePreview } from './preview.ts'

/** A new collection: its name, its note, and the fields it starts with. */
export function NewCollection() {
  const { catalog, presentations } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [fields, setFields] = useState<FieldDraft[]>([
    { ...emptyField(), name: 'title', required: true },
  ])
  const runner = useRunner()
  const preview = usePreview(
    async () =>
      name
        ? collectionStatements(
            ws,
            name,
            note,
            fields.filter((f) => f.name)
          )
        : [],
    [ws, name, note, JSON.stringify(fields)]
  )
  const others = [...tablesIn(catalog, ws).map((t) => t.name), ...(name ? [name] : [])]
  return (
    <Page
      title="New collection"
      icon={<CollectionIcon size={22} />}
      crumbs={[
        { label: 'Data model', href: href('/model', { ws }) },
        { label: shown.displayName ?? ws },
      ]}
      subtitle="A table made by platform.create_collection: id, timestamps, who changed it, a version, revisions and row security on."
      actions={
        <Action
          label="Create collection"
          icon={<PlusIcon size={22} />}
          busy={runner.busy}
          disabled={!name || !!preview.error || !schema?.can_create}
          onClick={async () => {
            if (await runner.runStatements(preview.statements, `Created ${name}`))
              location.route(href('/model/collection', { ws, c: name }))
          }}
        />
      }
    >
      {!schema?.can_create && (
        <Notice tone="warning" title={`The database gives you no CREATE on ${ws}`}>
          Ask its owner, {schema?.owner}, for it.
        </Notice>
      )}
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <section class="panel">
        <div class="form">
          <Field label="Name" id="new-name" required hint="The table's name in this workspace.">
            <Input
              id="new-name"
              mono
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="articles"
            />
          </Field>
          <Field label="Note" id="new-note">
            <Input
              id="new-note"
              value={note}
              onInput={(e) => setNote(e.currentTarget.value)}
              placeholder="What a record of it is"
            />
          </Field>
        </div>
      </section>
      {fields.map((field, index) => (
        <section key={index} class="panel">
          <header class="panel-head">
            <div>
              <h2>{field.name || `Field ${index + 1}`}</h2>
              <p>{typeLabel(field.type)}</p>
            </div>
            <Button
              tone="ghost"
              icon={<TrashIcon size={16} />}
              onClick={() => setFields(fields.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </header>
          <FieldEditor
            field={field}
            prefix={`f${index}`}
            collections={others}
            onChange={(next) => setFields(fields.map((f, i) => (i === index ? next : f)))}
          />
        </section>
      ))}
      <div class="row-actions row-start">
        <Button icon={<PlusIcon size={16} />} onClick={() => setFields([...fields, emptyField()])}>
          Add another field
        </Button>
      </div>
      {name &&
        (preview.error ? (
          <Notice tone="warning" title={preview.error} />
        ) : (
          <Statement
            sql={preview.statements.join('\n')}
            label="Creating runs these as you, in one transaction"
          />
        ))}
    </Page>
  )
}
