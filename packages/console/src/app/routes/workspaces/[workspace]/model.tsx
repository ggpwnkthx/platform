/**
 * The data model of a workspace.
 *
 * The deployment holds the tables; the workspace holds its own logical
 * model above them: the labels, the constraints, the relations and the
 * fields it serves. A change of the model is the change of the schema of
 * the workspace for every request that follows it. The model never
 * creates a table and never alters one: a field of the model is a column
 * of the table of its collection.
 */

import { createRoute } from 'honox/factory'
import {
  DataError,
  type FieldAttributes,
  type ModelCollection,
  type ModelField,
} from '../../../../domains/data'
import { isUuid } from '../../../../domains/operators'
import { Badge, Empty, Notice, PageHead } from '../../../components/page'
import {
  collectionPath,
  WorkspaceTabs,
  workspaceCrumbs,
  workspaceName,
  workspacePath,
} from '../../../components/workspace'
import ConfirmButton from '../../../islands/confirm-button'
import { formOf, listOf, type SentForm } from '../../../middleware/forms'
import { flash, sessionOf } from '../../../middleware/session'

const TYPES = [
  'string',
  'text',
  'boolean',
  'integer',
  'decimal',
  'uuid',
  'timestamp',
  'json',
  'enum',
]

/** The attributes of a field, as its form carries them. */
function attributesOf(form: SentForm, type: string): FieldAttributes {
  const attributes: Record<string, unknown> = {}
  for (const name of ['label', 'description']) {
    if (form.has(name)) attributes[name] = form.get(name).trim()
  }
  for (const name of ['required', 'nullable']) {
    const value = form.get(name)
    if (value === 'true' || value === 'false') attributes[name] = value === 'true'
  }
  for (const name of ['minLength', 'maxLength', 'minimum', 'maximum']) {
    const value = form.get(name).trim()
    if (value !== '' && Number.isFinite(Number(value))) attributes[name] = Number(value)
  }
  if (type === 'enum' && form.get('enum').trim() !== '') attributes.enum = listOf(form.get('enum'))
  return attributes as FieldAttributes
}

function YesNo(props: { name: string; value: boolean; id: string }) {
  return (
    <select name={props.name} id={props.id}>
      <option value="true" selected={props.value}>
        yes
      </option>
      <option value="false" selected={!props.value}>
        no
      </option>
    </select>
  )
}

/** The form of the attributes of a field. */
function FieldForm(props: { collection: string; field: ModelField }) {
  const { field } = props
  const textual = field.type === 'string' || field.type === 'text'
  const numeric = field.type === 'integer' || field.type === 'decimal'
  return (
    <form method="post" class="form">
      <input type="hidden" name="_action" value="change-field" />
      <input type="hidden" name="collection" value={props.collection} />
      <input type="hidden" name="field" value={field.name} />
      <input type="hidden" name="type" value={field.type} />
      <div class="form-grid">
        <label class="field">
          <span>Label</span>
          <input name="label" value={field.label ?? ''} />
        </label>
        <label class="field">
          <span>Description</span>
          <input name="description" value={field.description ?? ''} />
        </label>
        <label class="field" for={`${props.collection}-${field.name}-required`}>
          <span>Required</span>
          <YesNo
            name="required"
            value={field.required}
            id={`${props.collection}-${field.name}-required`}
          />
        </label>
        <label class="field" for={`${props.collection}-${field.name}-nullable`}>
          <span>May be empty</span>
          <YesNo
            name="nullable"
            value={field.nullable}
            id={`${props.collection}-${field.name}-nullable`}
          />
        </label>
        {textual ? (
          <>
            <label class="field">
              <span>Shortest</span>
              <input
                name="minLength"
                type="number"
                min="0"
                value={field.minLength?.toString() ?? ''}
              />
            </label>
            <label class="field">
              <span>Longest</span>
              <input
                name="maxLength"
                type="number"
                min="1"
                value={field.maxLength?.toString() ?? ''}
              />
            </label>
          </>
        ) : null}
        {numeric ? (
          <>
            <label class="field">
              <span>Smallest</span>
              <input
                name="minimum"
                type="number"
                step="any"
                value={field.minimum?.toString() ?? ''}
              />
            </label>
            <label class="field">
              <span>Largest</span>
              <input
                name="maximum"
                type="number"
                step="any"
                value={field.maximum?.toString() ?? ''}
              />
            </label>
          </>
        ) : null}
        {field.type === 'enum' ? (
          <label class="field wide">
            <span>Values</span>
            <input name="enum" value={(field.enum ?? []).join(', ')} />
            <span class="hint">separated by commas</span>
          </label>
        ) : null}
      </div>
      <div class="row">
        <button type="submit" class="button small">
          Save the field
        </button>
      </div>
    </form>
  )
}

/** One collection of the model. */
function CollectionModel(props: {
  workspace: string
  collection: ModelCollection
  writable: boolean
  served: readonly { key: string; label: string }[]
}) {
  const { collection, writable } = props
  const held = collection.fields.filter((field) => field.held)
  return (
    <section class="card" id={`collection-${collection.key}`}>
      <header>
        <div class="stack" style="gap: 0.15rem">
          <h2>
            <a href={collectionPath(props.workspace, collection.key)}>{collection.label}</a>
          </h2>
          <span class="small muted">
            <code>{collection.key}</code> · table <code>{collection.table}</code> · schema{' '}
            <code>{collection.schemaVersion}</code>
          </span>
        </div>
        {writable ? (
          <form method="post">
            <input type="hidden" name="_action" value="unregister" />
            <input type="hidden" name="collection" value={collection.key} />
            <ConfirmButton
              small
              label="Stop serving"
              message={`Stop serving ${collection.label} in this workspace? Its table and its rows stay: the workspace may serve it again.`}
            />
          </form>
        ) : null}
      </header>
      {collection.description ? <p class="muted">{collection.description}</p> : null}
      {writable ? (
        <details class="disclosure">
          <summary>Change the label and the description</summary>
          <form method="post" class="toolbar">
            <input type="hidden" name="_action" value="describe" />
            <input type="hidden" name="collection" value={collection.key} />
            <label class="field">
              <span>Label</span>
              <input name="label" value={collection.label} required />
            </label>
            <label class="field">
              <span>Description</span>
              <input name="description" value={collection.description ?? ''} />
            </label>
            <button type="submit" class="button">
              Save
            </button>
          </form>
        </details>
      ) : null}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Rules</th>
              <th>Origin</th>
              {writable ? <th>Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {collection.fields.map((field, index) => (
              <tr style={field.held ? undefined : 'opacity: 0.6'}>
                <td>
                  <strong>{field.label ?? field.name}</strong>
                  <div class="small muted mono">{field.name}</div>
                  {field.description ? <div class="small muted">{field.description}</div> : null}
                </td>
                <td>
                  <code>{field.type}</code>
                  {field.enum ? <div class="small muted">{field.enum.join(' · ')}</div> : null}
                </td>
                <td class="small">
                  {[
                    field.required ? 'required' : null,
                    field.nullable ? null : 'never empty',
                    field.minLength !== undefined ? `≥ ${field.minLength} chars` : null,
                    field.maxLength !== undefined ? `≤ ${field.maxLength} chars` : null,
                    field.minimum !== undefined ? `≥ ${field.minimum}` : null,
                    field.maximum !== undefined ? `≤ ${field.maximum}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || <span class="muted">—</span>}
                </td>
                <td>
                  {!field.held ? (
                    <Badge tone="warn" plain>
                      not served
                    </Badge>
                  ) : field.deployment ? (
                    <Badge plain>deployment</Badge>
                  ) : (
                    <Badge tone="accent" plain>
                      workspace
                    </Badge>
                  )}
                </td>
                {writable ? (
                  <td>
                    {field.held ? (
                      <div class="stack" style="gap: 0.4rem">
                        <div class="row">
                          <form method="post">
                            <input type="hidden" name="_action" value="move-field" />
                            <input type="hidden" name="collection" value={collection.key} />
                            <input type="hidden" name="field" value={field.name} />
                            <button
                              type="submit"
                              name="direction"
                              value="up"
                              class="button quiet small"
                              disabled={index === 0}
                              aria-label={`Move ${field.name} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="submit"
                              name="direction"
                              value="down"
                              class="button quiet small"
                              disabled={index === collection.fields.length - 1}
                              aria-label={`Move ${field.name} down`}
                            >
                              ↓
                            </button>
                          </form>
                          <form method="post">
                            <input type="hidden" name="_action" value="remove-field" />
                            <input type="hidden" name="collection" value={collection.key} />
                            <input type="hidden" name="field" value={field.name} />
                            <ConfirmButton
                              small
                              label="Stop serving"
                              message={`Stop serving the field ${field.name}? The column stays: the model may hold it again.`}
                            />
                          </form>
                        </div>
                        <details class="disclosure small">
                          <summary>Attributes</summary>
                          <FieldForm collection={collection.key} field={field} />
                        </details>
                      </div>
                    ) : (
                      <form method="post">
                        <input type="hidden" name="_action" value="hold-field" />
                        <input type="hidden" name="collection" value={collection.key} />
                        <input type="hidden" name="field" value={field.name} />
                        <button type="submit" class="button quiet small">
                          Serve again
                        </button>
                      </form>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {writable ? (
        <details class="disclosure">
          <summary>Serve another column of the table</summary>
          <form method="post" class="toolbar">
            <input type="hidden" name="_action" value="add-field" />
            <input type="hidden" name="collection" value={collection.key} />
            <label class="field">
              <span>Column</span>
              <input name="field" required pattern="[a-z][a-z0-9_]{0,62}" class="mono" />
            </label>
            <label class="field narrow">
              <span>Type</span>
              <select name="type">
                {TYPES.map((type) => (
                  <option value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Label</span>
              <input name="label" />
            </label>
            <button type="submit" class="button">
              Add
            </button>
          </form>
          <p class="small muted">
            The column has to exist in <code>{collection.table}</code>, with a type that the field
            type can hold: the model never alters a table.
          </p>
        </details>
      ) : null}

      <h3>Relations</h3>
      {collection.relations.length === 0 ? (
        <p class="small muted">No relation.</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Relation</th>
                <th>Kind</th>
                <th>Target</th>
                <th>Through</th>
                {writable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {collection.relations.map((relation) => (
                <tr>
                  <td>
                    {relation.label ?? relation.name}
                    <div class="small muted mono">{relation.name}</div>
                  </td>
                  <td>{relation.type}</td>
                  <td>
                    <code>{relation.target}</code>
                  </td>
                  <td>
                    <code>{relation.field}</code>
                  </td>
                  {writable ? (
                    <td>
                      {relation.deployment ? (
                        <span class="small muted">deployment</span>
                      ) : (
                        <form method="post">
                          <input type="hidden" name="_action" value="remove-relation" />
                          <input type="hidden" name="collection" value={collection.key} />
                          <input type="hidden" name="relation" value={relation.name} />
                          <ConfirmButton
                            small
                            label="Remove"
                            message={`Remove the relation ${relation.name}?`}
                          />
                        </form>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {writable ? (
        <details class="disclosure">
          <summary>Add a relation</summary>
          <form method="post" class="toolbar">
            <input type="hidden" name="_action" value="add-relation" />
            <input type="hidden" name="collection" value={collection.key} />
            <label class="field">
              <span>Name</span>
              <input name="relation" required class="mono" />
            </label>
            <label class="field narrow">
              <span>Kind</span>
              <select name="type">
                <option value="many-to-one">many-to-one</option>
                <option value="one-to-many">one-to-many</option>
              </select>
            </label>
            <label class="field narrow">
              <span>Target</span>
              <select name="target">
                {props.served.map((target) => (
                  <option value={target.key}>{target.label}</option>
                ))}
              </select>
            </label>
            <label class="field narrow">
              <span>Through the field</span>
              <select name="field">
                {held
                  .filter((field) => field.type === 'uuid')
                  .map((field) => (
                    <option value={field.name}>{field.name}</option>
                  ))}
              </select>
            </label>
            <label class="field">
              <span>Label</span>
              <input name="label" />
            </label>
            <button type="submit" class="button">
              Add
            </button>
          </form>
          <p class="small muted">
            A many-to-one relation goes through a uuid field of this collection; a one-to-many
            relation goes through a uuid field of the target.
          </p>
        </details>
      ) : null}
    </section>
  )
}

export const POST = createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  if (!isUuid(workspace)) return c.notFound()
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const form = await formOf(c)
  const collection = form.get('collection')
  const field = form.get('field')
  const back = `${workspacePath(workspace)}/model#collection-${collection}`
  const done: Record<string, string> = {
    describe: 'The collection was described.',
    'add-field': `The field ${field} is served.`,
    'hold-field': `The field ${field} is served again.`,
    'change-field': `The field ${field} was changed.`,
    'remove-field': `The field ${field} is not served any more. Its column stays.`,
    'move-field': `The field ${field} was moved.`,
    'add-relation': `The relation ${form.get('relation')} was added.`,
    'remove-relation': `The relation ${form.get('relation')} was removed.`,
    register: `The collection ${collection} is served.`,
    unregister: `The collection ${collection} is not served any more. Its table stays.`,
  }
  const action = form.get('_action')
  try {
    switch (action) {
      case 'describe':
        await client.describeCollection(collection, {
          label: form.get('label').trim(),
          description: form.get('description').trim(),
        })
        break
      case 'add-field': {
        const type = form.get('type')
        await client.addField(collection, field, { type, ...attributesOf(form, type) })
        break
      }
      case 'hold-field':
        await client.changeField(collection, field, {})
        break
      case 'change-field':
        await client.changeField(collection, field, attributesOf(form, form.get('type')))
        break
      case 'remove-field':
        await client.removeField(collection, field)
        break
      case 'move-field':
        await client.moveField(collection, field, form.get('direction') === 'down' ? 'down' : 'up')
        break
      case 'add-relation':
        await client.addRelation(collection, form.get('relation').trim(), {
          target: form.get('target'),
          type: form.get('type') === 'one-to-many' ? 'one-to-many' : 'many-to-one',
          field,
          ...(form.get('label').trim() ? { label: form.get('label').trim() } : {}),
        })
        break
      case 'remove-relation':
        await client.removeRelation(collection, form.get('relation'))
        break
      case 'register':
        await client.registerCollection(collection)
        break
      case 'unregister':
        await client.unregisterCollection(collection)
        break
      default:
        return c.text('the form names no action', 400)
    }
    flash(c, { kind: 'ok', text: done[action] ?? 'Done.' })
  } catch (error) {
    if (!(error instanceof DataError) || error.status === 401 || error.status >= 500) throw error
    flash(c, {
      kind: 'error',
      text: error.message,
      detail: `${error.status} ${error.code}${error.requestId ? ` · request ${error.requestId}` : ''}`,
    })
  }
  return c.redirect(back)
})

export default createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  if (!isUuid(workspace)) return c.notFound()
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const me = await client.me()
  let model = null
  let refused: DataError | null = null
  try {
    model = await client.model()
  } catch (error) {
    if (!(error instanceof DataError) || error.status !== 403) throw error
    refused = error
  }
  return c.render(
    <>
      <PageHead
        title={workspaceName(me, workspace)}
        eyebrow="Workspace"
        lede="The logical model of the workspace, above the tables of the deployment: what it serves, how it labels it and which rules hold. A change applies to every request that follows it."
      />
      <WorkspaceTabs id={workspace} current="model" />
      {refused ? (
        <Notice tone="warn" title="The model is not open to you">
          Reading the model requires the permission <code>data.model.read</code> or{' '}
          <code>data.model.write</code>.
        </Notice>
      ) : null}
      {model ? (
        <>
          <div class="row small muted">
            <span>
              version <strong>{model.version}</strong>
            </span>
            <span>·</span>
            <span>
              digest <code>{model.modelVersion.slice(0, 16)}</code>
            </span>
            <span>·</span>
            <span>
              schema <code>{model.schemaVersion}</code>
            </span>
            <span>·</span>
            {model.writable ? (
              <Badge tone="ok">you may change it</Badge>
            ) : (
              <Badge>read only: data.model.write is not yours</Badge>
            )}
          </div>
          {model.collections.length === 0 ? (
            <Empty>The workspace serves no collection.</Empty>
          ) : null}
          {model.collections.map((collection) => (
            <CollectionModel
              workspace={workspace}
              collection={collection}
              writable={model.writable}
              served={model.collections.map((entry) => ({ key: entry.key, label: entry.label }))}
            />
          ))}
          {model.available.length > 0 ? (
            <section class="card">
              <h2>Collections of the deployment this workspace does not serve</h2>
              <div class="table-wrap">
                <table>
                  <tbody>
                    {model.available.map((entry) => (
                      <tr>
                        <td>
                          {entry.label}
                          <div class="small muted">
                            <code>{entry.key}</code> · <code>{entry.table}</code>
                          </div>
                        </td>
                        <td class="num">
                          {model.writable ? (
                            <form method="post">
                              <input type="hidden" name="_action" value="register" />
                              <input type="hidden" name="collection" value={entry.key} />
                              <button type="submit" class="button quiet small">
                                Serve it
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>,
    {
      title: `Model of ${workspaceName(me, workspace)}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(workspace, me, { label: 'Data model' }),
    }
  )
})
