/**
 * The creation of a record.
 *
 * The form carries the key of its idempotency: a form that is sent twice
 * — a double click, a reload of the answer — creates one record, and the
 * data service answers the receipt of the first one.
 */

import type { Context } from 'hono'
import { createRoute } from 'honox/factory'
import { collectionAbility } from '../../../../../../domains/ability'
import {
  type CollectionMetadata,
  DataError,
  type Me,
  readValues,
  type ValueProblem,
} from '../../../../../../domains/data'
import { isUuid } from '../../../../../../domains/operators'
import { newIdentifier } from '../../../../../../domains/session'
import {
  Notice,
  PageHead,
  Refusal,
  type RefusalView,
  refusalOf,
} from '../../../../../components/page'
import {
  collectionPath,
  FieldInput,
  recordPath,
  workspaceCrumbs,
} from '../../../../../components/workspace'
import { formOf } from '../../../../../middleware/forms'
import { flash, sessionOf } from '../../../../../middleware/session'

function render(
  c: Context,
  options: {
    workspace: string
    me: Me
    collection: CollectionMetadata
    values: Readonly<Record<string, string>>
    idempotencyKey: string
    problems?: readonly ValueProblem[]
    refusal?: RefusalView | null
  }
) {
  const { workspace, collection } = options
  const ability = collectionAbility(collection)
  const writable = collection.fields.filter((field) =>
    ability.can('create', collection.key, field.name)
  )
  const problemOf = (name: string) =>
    options.problems?.find((problem) => problem.field === name)?.message ??
    options.refusal?.details.find((detail) => detail.field === name)?.code
  return c.render(
    <>
      <PageHead
        title={`New ${collection.label.replace(/s$/, '').toLowerCase()}`}
        eyebrow={collection.label}
        lede="Fields you leave empty get the data service's default, or are refused if required."
      />
      {options.refusal ? <Refusal refusal={options.refusal} /> : null}
      {options.problems && options.problems.length > 0 ? (
        <Notice tone="error" title="Some values could not be read">
          Nothing was sent: correct the fields below.
        </Notice>
      ) : null}
      <form method="post" class="card form">
        <input type="hidden" name="_idempotency" value={options.idempotencyKey} />
        <div class="form-grid">
          {writable.map((field) => (
            <FieldInput
              field={field}
              value={options.values[field.name] ?? ''}
              problem={problemOf(field.name)}
              creating
            />
          ))}
        </div>
        <div class="row">
          <button type="submit" class="button">
            Create
          </button>
          <a class="button quiet" href={collectionPath(workspace, collection.key)}>
            Cancel
          </a>
        </div>
      </form>
    </>,
    {
      title: `New record of ${collection.label}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(
        workspace,
        options.me,
        { label: collection.label, href: collectionPath(workspace, collection.key) },
        { label: 'New' }
      ),
    }
  )
}

async function load(c: Context) {
  const workspace = c.req.param('workspace') ?? ''
  const key = c.req.param('collection') ?? ''
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const [me, collection] = await Promise.all([client.me(), client.collection(key)])
  return { workspace, key, client, me, collection }
}

export const POST = createRoute(async (c) => {
  if (!isUuid(c.req.param('workspace') ?? '')) return c.notFound()
  const { workspace, key, client, me, collection } = await load(c)
  const form = await formOf(c)
  const idempotencyKey = /^[A-Za-z0-9._-]{1,128}$/.test(form.get('_idempotency'))
    ? form.get('_idempotency')
    : newIdentifier()
  const read = readValues({
    fields: collection.fields,
    writable: collection.writableFields,
    form: form.fields,
  })
  if (read.problems.length > 0) {
    c.status(422)
    return render(c, {
      workspace,
      me,
      collection,
      values: form.fields,
      idempotencyKey,
      problems: read.problems,
    })
  }
  try {
    const receipt = await client.create(key, read.values, idempotencyKey)
    flash(c, {
      kind: 'ok',
      text: receipt.replayed
        ? 'The record had already been created by this form: nothing new was created.'
        : 'The record was created.',
    })
    return c.redirect(
      collectionAbility(collection).can('read', key)
        ? recordPath(workspace, key, receipt.id)
        : collectionPath(workspace, key)
    )
  } catch (error) {
    if (!(error instanceof DataError) || error.status === 401) throw error
    c.status(error.status === 422 || error.status === 400 || error.status === 409 ? 422 : 400)
    return render(c, {
      workspace,
      me,
      collection,
      values: form.fields,
      // A refused creation leaves no receipt: the next attempt is a new
      // operation, unless the first one is still running.
      idempotencyKey: error.status === 409 ? idempotencyKey : newIdentifier(),
      refusal: refusalOf(error),
    })
  }
})

export default createRoute(async (c) => {
  if (!isUuid(c.req.param('workspace') ?? '')) return c.notFound()
  const { workspace, me, collection } = await load(c)
  return render(c, { workspace, me, collection, values: {}, idempotencyKey: newIdentifier() })
})
