/**
 * One version of a record, beside the record as it is now, and its
 * rollback.
 *
 * A rollback is a write like any other: it restores the fields that
 * changed, the record takes the next version, and the policies of the
 * deployment authorize it.
 */

import { createRoute } from 'honox/factory'
import { collectionAbility } from '../../../../../../../../../domains/ability'
import { DataError } from '../../../../../../../../../domains/data'
import { isUuid } from '../../../../../../../../../domains/operators'
import { Notice, PageHead } from '../../../../../../../../components/page'
import {
  collectionPath,
  labelOf,
  recordPath,
  Value,
  workspaceCrumbs,
} from '../../../../../../../../components/workspace'
import ConfirmButton from '../../../../../../../../islands/confirm-button'
import { sessionOf } from '../../../../../../../../middleware/session'

export default createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  const key = c.req.param('collection') ?? ''
  const id = c.req.param('record') ?? ''
  const version = Number(c.req.param('version'))
  if (!isUuid(workspace) || !Number.isInteger(version) || version < 1) return c.notFound()
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const [me, collection, past] = await Promise.all([
    client.me(),
    client.collection(key),
    client.version(key, id, version),
  ])
  let current: Awaited<ReturnType<typeof client.get>> | null = null
  try {
    current = await client.get(key, id)
  } catch (error) {
    if (!(error instanceof DataError) || error.status !== 404) throw error
  }
  const ability = collectionAbility(collection)
  const fields = collection.fields.filter((field) => ability.can('read', key, field.name))
  const differs = (name: string) =>
    current !== null &&
    JSON.stringify(current.record[name] ?? null) !== JSON.stringify(past[name] ?? null)
  const changed = fields.filter((field) => differs(field.name)).length
  const canRollBack = current !== null && ability.can('update', key) && changed > 0

  return c.render(
    <>
      <PageHead
        title={`Version ${version}`}
        eyebrow={`${collection.label} · ${id.slice(0, 8)}`}
        lede={
          current
            ? `${changed} of the fields you may read differ from the record as it is now (version ${current.record.version}).`
            : 'The record does not exist any more: it was deleted.'
        }
        actions={
          canRollBack && current ? (
            <form method="post" action={recordPath(workspace, key, id)}>
              <input type="hidden" name="_action" value="rollback" />
              <input type="hidden" name="_etag" value={current.etag} />
              <input type="hidden" name="version" value={String(version)} />
              <ConfirmButton
                tone="primary"
                label={`Roll back to version ${version}`}
                message={`Restore the values of version ${version}? The record takes a new version: its history keeps the current one.`}
              />
            </form>
          ) : null
        }
      />
      {!current ? (
        <Notice tone="warn" title="Deleted">
          The history of a deleted record is kept with its tombstone.
        </Notice>
      ) : null}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Version {version}</th>
              <th>Now{current ? ` (version ${current.record.version})` : ''}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr>
                <td>
                  {labelOf(field)}
                  {differs(field.name) ? <div class="small muted">changed</div> : null}
                </td>
                <td class={differs(field.name) ? 'diff-removed' : ''}>
                  <Value value={past[field.name]} long />
                </td>
                <td class={differs(field.name) ? 'diff-added' : ''}>
                  {current ? (
                    <Value value={current.record[field.name]} long />
                  ) : (
                    <span class="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>,
    {
      title: `Version ${version}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(
        workspace,
        me,
        { label: collection.label, href: collectionPath(workspace, key) },
        { label: id.slice(0, 8), href: recordPath(workspace, key, id) },
        { label: `Version ${version}` }
      ),
    }
  )
})
