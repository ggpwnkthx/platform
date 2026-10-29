/**
 * A record: its values, its form, its history.
 *
 * A change of a record carries the validator of the record the caller
 * read: a record that changed in between is refused by Data,
 * and the caller reads it again before it changes it.
 */

import type { Context } from 'hono'
import type { Child } from 'hono/jsx'
import { createRoute } from 'honox/factory'
import { collectionAbility } from '../../../../../../../../domains/ability'
import {
  type CollectionMetadata,
  type DataClient,
  DataError,
  type Me,
  readValues,
  type RecordValue,
  type ValueProblem,
  type VersionEntry,
} from '../../../../../../../../domains/data'
import { isUuid } from '../../../../../../../../domains/operators'
import {
  Badge,
  KeyValues,
  Moment,
  Notice,
  PageHead,
  Refusal,
  type RefusalView,
  refusalOf,
} from '../../../../../../../components/page'
import {
  collectionPath,
  FieldInput,
  labelOf,
  recordPath,
  textOf,
  Value,
  workspaceCrumbs,
} from '../../../../../../../components/workspace'
import ConfirmButton from '../../../../../../../islands/confirm-button'
import CopyText from '../../../../../../../islands/copy-text'
import { formOf } from '../../../../../../../middleware/forms'
import { flash, sessionOf } from '../../../../../../../middleware/session'

interface Loaded {
  readonly workspace: string
  readonly key: string
  readonly id: string
  readonly client: DataClient
  readonly me: Me
  readonly collection: CollectionMetadata
}

async function load(c: Context): Promise<Loaded | null> {
  const workspace = c.req.param('workspace') ?? ''
  const key = c.req.param('collection') ?? ''
  const id = c.req.param('record') ?? ''
  if (!isUuid(workspace)) return null
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const [me, collection] = await Promise.all([client.me(), client.collection(key)])
  return { workspace, key, id, client, me, collection }
}

/** The history of a record, or null when the collection keeps none. */
async function historyOf(loaded: Loaded): Promise<readonly VersionEntry[] | null> {
  try {
    return await loaded.client.versions(loaded.key, loaded.id)
  } catch (error) {
    if (error instanceof DataError && error.status === 404) return null
    throw error
  }
}

async function render(
  c: Context,
  loaded: Loaded,
  options: {
    record: RecordValue
    etag: string
    form?: Readonly<Record<string, string>>
    problems?: readonly ValueProblem[]
    refusal?: RefusalView | null
  }
) {
  const { workspace, key, collection, me } = loaded
  const { record } = options
  const history = await historyOf(loaded)
  const ability = collectionAbility(collection)
  const readable = collection.fields.filter((field) => ability.can('read', key, field.name))
  const writable = collection.fields.filter((field) => ability.can('update', key, field.name))
  const canUpdate = ability.can('update', key) && writable.length > 0
  const canDelete = ability.can('delete', key)
  const relations = collection.relations.filter((relation) => relation.name in record)
  const problemOf = (name: string) =>
    options.problems?.find((problem) => problem.field === name)?.message ??
    options.refusal?.details.find((detail) => detail.field === name)?.code
  const path = recordPath(workspace, key, record.id)

  return c.render(
    <>
      <PageHead
        title={String(record[readable[0]?.name ?? 'id'] ?? record.id)}
        eyebrow={
          <>
            {collection.label} · version {record.version}
          </>
        }
        actions={
          canDelete ? (
            <form method="post" action={path}>
              <input type="hidden" name="_action" value="delete" />
              <input type="hidden" name="_etag" value={options.etag} />
              <ConfirmButton
                label="Delete"
                message="Delete this record? Data keeps its tombstone when the collection keeps a history."
              />
            </form>
          ) : null
        }
      />
      {options.refusal ? <Refusal refusal={options.refusal} /> : null}
      <div class="split">
        <div class="stack">
          <section class="card">
            <h2>Values</h2>
            <KeyValues
              rows={[
                ['Identifier', <CopyText text={record.id} />],
                ...readable.map((field): [Child, Child] => [
                  labelOf(field),
                  <Value value={record[field.name]} long />,
                ]),
                ...relations.map((relation): [Child, Child] => [
                  relation.label ?? relation.name,
                  <Value value={record[relation.name]} long />,
                ]),
              ]}
            />
          </section>
          {canUpdate ? (
            <section class="card">
              <h2>Change</h2>
              {options.problems && options.problems.length > 0 ? (
                <Notice tone="error" title="Some values could not be read">
                  Nothing was sent: correct the fields below.
                </Notice>
              ) : null}
              <form method="post" action={path} class="form">
                <input type="hidden" name="_action" value="update" />
                <input type="hidden" name="_etag" value={options.etag} />
                <div class="form-grid">
                  {writable.map((field) => (
                    <FieldInput
                      field={field}
                      value={options.form?.[field.name] ?? textOf(field, record[field.name])}
                      problem={problemOf(field.name)}
                      creating={false}
                    />
                  ))}
                </div>
                <div class="row">
                  <button type="submit" class="button">
                    Save
                  </button>
                  <span class="small muted">Only the fields you change are sent.</span>
                </div>
              </form>
            </section>
          ) : null}
        </div>
        <aside class="stack">
          <section class="card">
            <h2>Record</h2>
            <KeyValues
              rows={[
                ['Collection', <a href={collectionPath(workspace, key)}>{collection.label}</a>],
                ['Version', String(record.version)],
                ['Validator', <code class="small">{options.etag.slice(0, 22)}…</code>],
                ['Created', <Moment at={record.created_at as string | undefined} />],
                ['Updated', <Moment at={record.updated_at as string | undefined} />],
              ]}
            />
          </section>
          <section class="card">
            <h2>History</h2>
            {history === null ? (
              <p class="small muted">This collection keeps no history of its records.</p>
            ) : history.length === 0 ? (
              <p class="small muted">The record has no earlier version.</p>
            ) : (
              <ol class="stack" style="padding: 0; list-style: none; margin: 0">
                {history.map((entry) => (
                  <li class="row spread">
                    <span>
                      <a href={`${path}/versions/${entry.version}`}>version {entry.version}</a>{' '}
                      <Badge tone={entry.operation === 'delete' ? 'error' : 'neutral'} plain>
                        {entry.operation}
                      </Badge>
                      <div class="small muted">
                        {entry.changedFields.join(', ') || 'no field'} ·{' '}
                        <Moment at={entry.supersededAt} />
                      </div>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </>,
    {
      title: `${collection.label} ${record.id.slice(0, 8)}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(
        workspace,
        me,
        { label: collection.label, href: collectionPath(workspace, key) },
        { label: record.id.slice(0, 8) }
      ),
    }
  )
}

export const POST = createRoute(async (c) => {
  const loaded = await load(c)
  if (!loaded) return c.notFound()
  const { workspace, key, id, client, collection } = loaded
  const form = await formOf(c)
  const action = form.get('_action')
  const etag = form.get('_etag')
  const path = recordPath(workspace, key, id)

  const refused = async (error: unknown) => {
    if (!(error instanceof DataError) || error.status === 401 || error.status >= 500) throw error
    // The page is read again: the caller sees the record as it is now,
    // and the refusal of what it tried.
    const current = await client.get(key, id)
    c.status(error.status === 412 || error.status === 409 ? 409 : 422)
    return render(c, loaded, {
      record: current.record,
      etag: current.etag,
      form: action === 'update' && error.status !== 412 ? form.fields : undefined,
      refusal: refusalOf(error),
    })
  }

  try {
    if (action === 'delete') {
      await client.remove(key, id, etag)
      flash(c, { kind: 'ok', text: 'The record was deleted.' })
      return c.redirect(collectionPath(workspace, key))
    }
    if (action === 'rollback') {
      const version = Number(form.get('version'))
      const result = await client.rollback(key, id, version, etag)
      flash(c, {
        kind: 'ok',
        text: `The record holds the values of version ${version} again, as version ${result.record.version}.`,
      })
      return c.redirect(path)
    }
    if (action === 'update') {
      const current = await client.get(key, id)
      const read = readValues({
        fields: collection.fields,
        writable: collection.writableFields,
        form: form.fields,
        original: current.record,
      })
      if (read.problems.length > 0) {
        c.status(422)
        return render(c, loaded, { ...current, form: form.fields, problems: read.problems })
      }
      if (Object.keys(read.values).length === 0) {
        flash(c, { kind: 'ok', text: 'Nothing changed: nothing was sent.' })
        return c.redirect(path)
      }
      const result = await client.update(key, id, read.values, etag)
      flash(c, { kind: 'ok', text: `The record was saved as version ${result.record.version}.` })
      return c.redirect(path)
    }
    return c.text('the form names no action', 400)
  } catch (error) {
    return await refused(error)
  }
})

export default createRoute(async (c) => {
  const loaded = await load(c)
  if (!loaded) return c.notFound()
  const current = await loaded.client.get(loaded.key, loaded.id)
  return await render(c, loaded, current)
})
