import { collectionTarget } from '@platform/vocabulary'
import { KeyEditorPanels, MetadataPanel } from '../../metadata/panel.tsx'
import { Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Field, TextArea } from '../../ui/form.tsx'
import { href } from '../../url.ts'
import { commentStatement } from '../statements.ts'

/** What the collection says of itself: its note, its keys, and its own metadata. */
export function CollectionAbout({
  ws,
  table,
  owner,
  comment,
  note,
  setNote,
  saving,
  onSave,
}: {
  ws: string
  table: string
  owner: boolean
  /** The note the collection holds now. */
  comment: string | null
  /** The note the reader is writing, or null when they are not writing one. */
  note: string | null
  setNote: (text: string) => void
  saving: boolean
  onSave: () => void
}) {
  return (
    <>
      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>Note</h2>
            <p>
              The table's comment: psql and every client show it, to every connected user. Who
              reaches the collection, its fields and its rows is under{' '}
              <a href={href('/model/collection', { ws, c: table, tab: 'access' })}>Access</a>.
            </p>
          </div>
        </header>
        <div class="form">
          <Field label="Note" id="table-note" wide>
            <TextArea
              id="table-note"
              rows={2}
              disabled={!owner}
              value={note ?? comment ?? ''}
              onInput={(e) => setNote(e.currentTarget.value)}
            />
          </Field>
          {owner && note !== null && note !== (comment ?? '') && (
            <div class="field field-wide">
              <Statement sql={commentStatement(ws, table, note)} />
              <div class="row-actions">
                <Button tone="primary" busy={saving} onClick={onSave}>
                  Save note
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
      <KeyEditorPanels target={collectionTarget(ws, table)} owner={owner} />
      <MetadataPanel target={collectionTarget(ws, table)} owner={owner} />
    </>
  )
}
