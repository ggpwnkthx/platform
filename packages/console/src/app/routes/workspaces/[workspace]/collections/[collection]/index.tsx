/**
 * The records of a collection: searched, filtered, sorted and paged by
 * Data, with the policies of the caller.
 */

import { createRoute } from 'honox/factory'
import { collectionAbility } from '../../../../../../domains/ability'
import {
  DataError,
  type FieldMetadata,
  nextSortOf,
  PAGE_SIZES,
  type Page,
  pageUrl,
  readPageQuery,
  sortOf,
} from '../../../../../../domains/data'
import { isUuid } from '../../../../../../domains/operators'
import { Empty, Notice, PageHead, Refusal, refusalOf } from '../../../../../components/page'
import {
  collectionPath,
  labelOf,
  recordPath,
  Value,
  workspaceCrumbs,
} from '../../../../../components/workspace'
import FilterBuilder from '../../../../../islands/filter-builder'
import { sessionOf } from '../../../../../middleware/session'

/** The columns a table shows at most, besides the identifier. */
const COLUMNS = 6

export default createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  const key = c.req.param('collection') ?? ''
  if (!isUuid(workspace)) return c.notFound()
  const session = sessionOf(c)
  const client = c.get('services').data(workspace, session.accessToken)
  const [me, collection] = await Promise.all([client.me(), client.collection(key)])

  const query = readPageQuery(new URL(c.req.url).searchParams)
  const path = collectionPath(workspace, key)
  const ability = collectionAbility(collection)
  let page: Page | null = null
  let refusal = null
  if (!query.problem && ability.can('read', key)) {
    try {
      page = await client.list(key, query.list)
    } catch (error) {
      if (!(error instanceof DataError) || error.status >= 500) throw error
      refusal = refusalOf(error)
    }
  }

  const readable = collection.fields.filter((field) => ability.can('read', key, field.name))
  const columns: FieldMetadata[] = readable.slice(0, COLUMNS)
  const sortable = new Set(collection.filterableFields)
  const filterFields = collection.fields
    .filter((field) => sortable.has(field.name))
    .map((field) => ({
      name: field.name,
      label: labelOf(field),
      type: field.type,
      ...(field.enum ? { enum: field.enum } : {}),
    }))

  return c.render(
    <>
      <PageHead
        title={collection.label}
        eyebrow="Collection"
        lede={collection.description}
        actions={
          <>
            <a class="button quiet" href={`${path}/aggregate`}>
              Aggregate
            </a>
            {ability.can('create', key) ? (
              <a class="button" href={`${path}/new`}>
                New record
              </a>
            ) : null}
          </>
        }
      />
      <form method="get" action={path} class="card form">
        <div class="toolbar">
          <label class="field">
            <span>Search</span>
            <input type="search" name="q" value={query.search} placeholder="Text of the record" />
          </label>
          <label class="field narrow">
            <span>Sort</span>
            <select name="sort">
              <option value="">identifier</option>
              {filterFields.flatMap((field) => [
                <option value={field.name} selected={query.sort === field.name}>
                  {field.label} ↑
                </option>,
                <option value={`-${field.name}`} selected={query.sort === `-${field.name}`}>
                  {field.label} ↓
                </option>,
              ])}
            </select>
          </label>
          <label class="field narrow">
            <span>Per page</span>
            <select name="limit">
              {PAGE_SIZES.map((size) => (
                <option value={String(size)} selected={size === query.limit}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label class="check small">
            <input type="checkbox" name="count" value="1" checked={query.count} /> count
          </label>
          <button type="submit" class="button">
            Apply
          </button>
          <a class="button quiet" href={path}>
            Reset
          </a>
        </div>
        <fieldset class="field" style="border: 0; padding: 0; margin: 0">
          <legend>Filter</legend>
          <FilterBuilder fields={filterFields} initial={query.filterText} name="filter" />
        </fieldset>
      </form>

      {query.problem ? (
        <Notice tone="error" title="The query is not understood">
          {query.problem}
        </Notice>
      ) : null}
      {refusal ? <Refusal refusal={refusal} /> : null}
      {!ability.can('read', key) ? (
        <Notice tone="warn" title="This collection is write only for you">
          The policies of the deployment let you create its records, and not read them.
        </Notice>
      ) : null}

      {page ? (
        page.data.length === 0 ? (
          <Empty>No record matches.</Empty>
        ) : (
          <>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    {columns.map((field) => {
                      const direction = sortOf(query, field.name)
                      const label = `${labelOf(field)}${direction === 'asc' ? ' ↑' : direction === 'desc' ? ' ↓' : ''}`
                      return (
                        <th
                          aria-sort={
                            direction === 'asc'
                              ? 'ascending'
                              : direction === 'desc'
                                ? 'descending'
                                : undefined
                          }
                        >
                          {sortable.has(field.name) ? (
                            <a
                              class="sort-link"
                              href={pageUrl(path, query, { sort: nextSortOf(query, field.name) })}
                            >
                              {label}
                            </a>
                          ) : (
                            label
                          )}
                        </th>
                      )
                    })}
                    <th class="num">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((record) => (
                    <tr>
                      <td>
                        <a class="mono" href={recordPath(workspace, key, record.id)}>
                          {record.id.slice(0, 8)}
                        </a>
                      </td>
                      {columns.map((field) => (
                        <td>
                          <span class="cell">
                            <Value value={record[field.name]} />
                          </span>
                        </td>
                      ))}
                      <td class="num">{record.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div class="pager">
              <span class="muted">
                {page.data.length} records on this page
                {page.meta.count !== undefined ? ` · ${page.meta.count} in all` : ''}
                {readable.length > COLUMNS
                  ? ` · ${readable.length - COLUMNS} more fields on the record`
                  : ''}
              </span>
              <span class="row">
                {query.cursor ? (
                  <a class="button quiet small" href={pageUrl(path, query, {})}>
                    First page
                  </a>
                ) : null}
                {page.meta.nextCursor ? (
                  <a
                    class="button quiet small"
                    href={pageUrl(path, query, { cursor: page.meta.nextCursor })}
                  >
                    Next page
                  </a>
                ) : null}
              </span>
            </div>
          </>
        )
      ) : null}
    </>,
    {
      title: collection.label,
      section: 'workspaces',
      crumbs: workspaceCrumbs(workspace, me, { label: collection.label }),
    }
  )
})
