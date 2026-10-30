/**
 * What the caller may do in a workspace: a grid for each collection.
 *
 * The rows are the records of a collection and each of its fields; the
 * columns are reading, creating, changing and deleting. The grid is the
 * ability of the console, drawn from the metadata Data answered for the
 * caller, so it says what the buttons of the other pages say. A "no"
 * carries a note with its reason.
 *
 * Above the grids are the permissions Access gives the caller here: the
 * keys the policies of Data read. The grid is an upper bound: Data
 * checks every record too.
 */

import { createRoute } from 'honox/factory'
import {
  type Allowance,
  type CollectionAccess,
  collectionAccessOf,
} from '../../../../domains/ability'
import type { AccessContext } from '../../../../domains/access'
import { isUuid } from '../../../../domains/operators'
import { Empty, PageHead } from '../../../components/page'
import { ASK_AN_OPERATOR } from '../../../components/why'
import {
  collectionPath,
  WorkspaceTabs,
  workspaceCrumbs,
  workspaceName,
} from '../../../components/workspace'
import { sessionOf } from '../../../middleware/session'

/** The cell of a grid: yes, or no with the number of its note. */
function Cell(props: { allowance: Allowance; note: (reason: string) => number; prefix: string }) {
  if (props.allowance.allowed) return <span class="grant-yes">Yes</span>
  const number = props.note(props.allowance.reason ?? '')
  return (
    <span class="grant-no">
      No
      <a
        href={`#${props.prefix}-why-${number}`}
        class="note-ref"
        aria-label={`Why: note ${number}`}
      >
        <sup>{number}</sup>
      </a>
    </span>
  )
}

/** The grid of one collection. */
function Grid(props: {
  workspace: string
  collectionKey: string
  label: string
  access: CollectionAccess
}) {
  const { access } = props
  const prefix = `c-${props.collectionKey}`
  // The notes are numbered in the order of the cells, before the cells
  // are drawn: a component of the page is drawn when the page is.
  const notes: string[] = []
  const ordered: Allowance[] = [
    access.actions.read,
    access.actions.create,
    access.actions.update,
    access.actions.delete,
    ...access.fields.flatMap((field) => [field.read, field.create, field.update]),
  ]
  for (const allowance of ordered) {
    if (!allowance.allowed && !notes.includes(allowance.reason ?? '')) {
      notes.push(allowance.reason ?? '')
    }
  }
  const note = (reason: string) => notes.indexOf(reason) + 1
  const cell = (allowance: Allowance) => <Cell allowance={allowance} note={note} prefix={prefix} />
  const body = (
    <tbody>
      <tr class="grid-records">
        <th scope="row" class="grid-row-head">
          Records
        </th>
        <td class="grant-cell">{cell(access.actions.read)}</td>
        <td class="grant-cell">{cell(access.actions.create)}</td>
        <td class="grant-cell">{cell(access.actions.update)}</td>
        <td class="grant-cell">{cell(access.actions.delete)}</td>
      </tr>
      {access.fields.map((field) => (
        <tr>
          <th scope="row" class="grid-row-head">
            {field.label}
            {field.label !== field.name ? <div class="small muted mono">{field.name}</div> : null}
          </th>
          <td class="grant-cell">{cell(field.read)}</td>
          <td class="grant-cell">{cell(field.create)}</td>
          <td class="grant-cell">{cell(field.update)}</td>
          <td class="grant-cell">
            <span class="muted" title="Records are deleted whole">
              —
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  )
  return (
    <section class="card" id={props.collectionKey}>
      <header>
        <h2>{props.label}</h2>
        <a class="small" href={collectionPath(props.workspace, props.collectionKey)}>
          Open the collection
        </a>
      </header>
      <div class="table-wrap">
        <table class="access-grid">
          <caption class="sr-only">What you may do with {props.label}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span class="sr-only">Records and fields</span>
              </th>
              <th scope="col" class="grant-cell">
                Read
              </th>
              <th scope="col" class="grant-cell">
                Create
              </th>
              <th scope="col" class="grant-cell">
                Change
              </th>
              <th scope="col" class="grant-cell">
                Delete
              </th>
            </tr>
          </thead>
          {body}
        </table>
      </div>
      {notes.length > 0 ? (
        <ol class="small grid-notes">
          {notes.map((note, index) => (
            <li id={`${prefix}-why-${index + 1}`}>{note}</li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

export default createRoute(async (c) => {
  const id = c.req.param('workspace') ?? ''
  if (!isUuid(id)) return c.notFound()
  const session = sessionOf(c)
  const services = c.get('services')
  const client = services.data(id, session.accessToken)
  const [me, schema] = await Promise.all([client.me(), client.schema()])

  // The permissions Access gives the caller here: the keys Data's policies read.
  let context: AccessContext | null = null
  let unavailable: string | null = null
  if (!services.context) {
    unavailable = 'The console holds no access-context credential, so it cannot ask Access.'
  } else {
    try {
      const tenantId = await services.tenantId(session.principal.tenant)
      if (!tenantId) unavailable = 'The console could not read the identifier of your tenant.'
      else {
        context = await services.context.context({
          subject: session.principal.id,
          tenantId,
          workspaceId: id,
          routeId: me.routeId,
        })
      }
    } catch (error) {
      services.log.warn('the access context of the caller could not be read', {
        requestId: c.get('requestId'),
        error: (error as Error).message,
      })
      unavailable = 'Access did not answer the question just now.'
    }
  }

  return c.render(
    <>
      <PageHead
        title="Your access"
        eyebrow={workspaceName(me, id)}
        lede="What you may do with each collection of this workspace, field by field."
      />
      <WorkspaceTabs id={id} current="access" />
      <div class="split">
        <div class="stack">
          {schema.collections.length === 0 ? (
            <Empty>No collection of this workspace is open to you.</Empty>
          ) : (
            schema.collections.map((collection) => (
              <Grid
                workspace={id}
                collectionKey={collection.key}
                label={collection.label}
                access={collectionAccessOf(collection)}
              />
            ))
          )}
        </div>
        <aside class="stack">
          <section class="card">
            <h2>Your permissions here</h2>
            {context ? (
              context.permissionKeys.length === 0 ? (
                <p class="muted">Access gives you no permission on this workspace and route.</p>
              ) : (
                <div class="chips">
                  {context.permissionKeys.map((key) => (
                    <span class="chip">
                      <code>{key}</code>
                    </span>
                  ))}
                </div>
              )
            ) : (
              <p class="small muted">{unavailable}</p>
            )}
            <p class="small muted">
              Access gives these on route <code>{me.routeId}</code>. Data's policies (bundle{' '}
              <code>{schema.policyBundleVersion}</code>) decide what each one allows.
            </p>
          </section>
          <section class="card">
            <h2>Reading the grid</h2>
            <p class="small">
              A <strong>yes</strong> is the most you may do. Data checks each record as well, so a
              rule on one record can still refuse it.
            </p>
            <p class="small">
              A <strong>no</strong> has a numbered note with its reason. {ASK_AN_OPERATOR}
            </p>
            <p class="small muted">
              Collections that are closed to you entirely are not listed: Data does not name them.
            </p>
          </section>
        </aside>
      </div>
    </>,
    {
      title: `Your access · ${workspaceName(me, id)}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(id, me, { label: 'Your access' }),
    }
  )
})
