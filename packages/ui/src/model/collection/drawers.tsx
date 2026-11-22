import { useLocation } from 'preact-iso'
import { dropCollectionStatement, dropFieldStatement, type FieldDraft } from '../statements.ts'
import type { Runner } from '../../access/runner.tsx'
import { Notice, Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Input } from '../../ui/form.tsx'
import { Confirm, Drawer } from '../../ui/overlay.tsx'
import { href } from '../../url.ts'
import { FieldEditor } from '../field/editor.tsx'

/** The drawer that adds a field to the collection. */
export function AddFieldDrawer({
  table,
  adding,
  setAdding,
  collections,
  preview,
  runner,
  onDone,
}: {
  table: string
  /** The field being written, or null while the drawer is closed. */
  adding: FieldDraft | null
  setAdding: (field: FieldDraft | null) => void
  collections: string[]
  /** The statements the field would make, and what would stop them. */
  preview: { statements: string[]; error: string | null }
  runner: Runner
  onDone: () => void
}) {
  return (
    <Drawer
      open={adding !== null}
      onClose={() => setAdding(null)}
      title={`Add a field to ${table}`}
      subtitle="The field is a new column, with the constraints you choose."
      wide
      footer={
        <>
          <Button onClick={() => setAdding(null)}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!adding?.name || !!preview.error}
            onClick={async () => {
              if (await runner.runStatements(preview.statements, `Added ${adding?.name}`)) {
                setAdding(null)
                onDone()
              }
            }}
          >
            Add field
          </Button>
        </>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {adding && (
        <FieldEditor field={adding} onChange={setAdding} collections={collections} prefix="add" />
      )}
      {adding?.name &&
        (preview.error ? (
          <Notice tone="warning" title={preview.error} />
        ) : (
          <Statement sql={preview.statements.join('\n')} label="Runs as you, in one transaction" />
        ))}
    </Drawer>
  )
}

/** The confirmation that a field is dropped, and the statement it runs. */
export function DropFieldConfirm({
  ws,
  table,
  dropping,
  setDropping,
  runner,
}: {
  ws: string
  table: string
  /** The field being dropped, or null while the confirmation is closed. */
  dropping: string | null
  setDropping: (name: string | null) => void
  runner: Runner
}) {
  return (
    <Confirm
      open={dropping !== null}
      title={`Drop ${dropping}?`}
      confirm="Drop field"
      busy={runner.busy}
      onClose={() => setDropping(null)}
      onConfirm={async () => {
        if (
          dropping &&
          (await runner.runStatements(
            [dropFieldStatement(ws, table, dropping)],
            `Dropped ${dropping}`
          ))
        )
          setDropping(null)
      }}
    >
      <p>Every value it holds goes with it. Revisions already recorded keep their copy.</p>
      {dropping && <Statement sql={dropFieldStatement(ws, table, dropping)} />}
    </Confirm>
  )
}

/** The confirmation that a collection is deleted: its name is asked for again. */
export function DeleteCollectionConfirm({
  ws,
  table,
  deleting,
  setDeleting,
  confirmName,
  setConfirmName,
  runner,
}: {
  ws: string
  table: string
  deleting: boolean
  setDeleting: (on: boolean) => void
  confirmName: string
  setConfirmName: (name: string) => void
  runner: Runner
}) {
  const location = useLocation()
  return (
    <Confirm
      open={deleting}
      title={`Delete ${table}?`}
      confirm="Delete collection"
      busy={runner.busy}
      onClose={() => {
        setDeleting(false)
        setConfirmName('')
      }}
      onConfirm={async () => {
        if (confirmName !== table) return
        if (await runner.runStatements([dropCollectionStatement(ws, table)], `Deleted ${table}`))
          location.route(href('/model', { ws }))
      }}
    >
      <p>Every record goes with it. Type the collection's name to confirm.</p>
      <Input
        value={confirmName}
        onInput={(e) => setConfirmName(e.currentTarget.value)}
        mono
        aria-label="Collection name"
      />
      <Statement sql={dropCollectionStatement(ws, table)} />
    </Confirm>
  )
}
