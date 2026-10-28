/**
 * The aggregate of a collection: its records grouped, counted and
 * measured by the data service, over the rows the caller may read.
 */

import { createRoute } from 'honox/factory'
import { type Aggregate, DataError } from '../../../../../../domains/data'
import { isUuid } from '../../../../../../domains/operators'
import { Empty, Notice, PageHead, Refusal, refusalOf } from '../../../../../components/page'
import {
  collectionPath,
  labelOf,
  Value,
  workspaceCrumbs,
} from '../../../../../components/workspace'
import FilterBuilder from '../../../../../islands/filter-builder'
import { listOf } from '../../../../../middleware/forms'
import { sessionOf } from '../../../../../middleware/session'

const FUNCTIONS = ['sum', 'avg', 'min', 'max'] as const

export default createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  const key = c.req.param('collection') ?? ''
  if (!isUuid(workspace)) return c.notFound()
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const [me, collection] = await Promise.all([client.me(), client.collection(key)])
  const params = new URL(c.req.url).searchParams
  const groupBy = params
    .getAll('group')
    .filter((field) => field.length > 0)
    .slice(0, 3)
  const metrics = listOf(params.get('metrics') ?? '').slice(0, 10)
  const filterText = (params.get('filter') ?? '').trim()
  const search = (params.get('q') ?? '').trim()

  const fields = collection.fields.filter((field) =>
    collection.filterableFields.includes(field.name)
  )
  const numeric = fields.filter((field) => field.type === 'integer' || field.type === 'decimal')

  let result: Aggregate | null = null
  let refusal = null
  let problem: string | null = null
  if (params.has('run')) {
    let filter: unknown
    if (filterText) {
      try {
        filter = JSON.parse(filterText)
      } catch {
        problem = 'the filter is not json'
      }
    }
    if (!problem) {
      try {
        result = await client.aggregate(key, {
          groupBy,
          metrics,
          ...(filter !== undefined ? { filter } : {}),
          ...(search ? { search } : {}),
          limit: 200,
        })
      } catch (error) {
        if (!(error instanceof DataError) || error.status >= 500) throw error
        refusal = refusalOf(error)
      }
    }
  }
  const largest = result ? Math.max(1, ...result.data.map((group) => group.count)) : 1
  const metricColumns = metrics
    .map((metric) => metric.split(':'))
    .filter((parts): parts is [string, string] => parts.length === 2)

  return c.render(
    <>
      <PageHead
        title={`Aggregate ${collection.label.toLowerCase()}`}
        eyebrow={collection.label}
        lede="Group the records you can read by up to three fields, then count and summarize them."
      />
      <form method="get" class="card form">
        <input type="hidden" name="run" value="1" />
        <div class="form-grid">
          {[0, 1, 2].map((index) => (
            <label class="field">
              <span>Group by {index === 0 ? '' : `(then ${index + 1})`}</span>
              <select name="group">
                <option value="">—</option>
                {fields.map((field) => (
                  <option value={field.name} selected={groupBy[index] === field.name}>
                    {labelOf(field)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label class="field">
            <span>Metrics</span>
            <input
              name="metrics"
              value={metrics.join(', ')}
              placeholder={
                numeric[0] ? `sum:${numeric[0].name}, avg:${numeric[0].name}` : 'sum:field'
              }
            />
            <span class="hint">
              {FUNCTIONS.join(', ')} of a field
              {numeric.length > 0 ? `: ${numeric.map((field) => field.name).join(', ')}` : ''}
            </span>
          </label>
          <label class="field">
            <span>Search</span>
            <input type="search" name="q" value={search} />
          </label>
        </div>
        <fieldset class="field" style="border: 0; padding: 0; margin: 0">
          <legend>Filter</legend>
          <FilterBuilder
            fields={fields.map((field) => ({
              name: field.name,
              label: labelOf(field),
              type: field.type,
              ...(field.enum ? { enum: field.enum } : {}),
            }))}
            initial={filterText}
            name="filter"
          />
        </fieldset>
        <div class="row">
          <button type="submit" class="button">
            Aggregate
          </button>
          <a class="button quiet" href={collectionPath(workspace, key)}>
            Back to the records
          </a>
        </div>
      </form>
      {problem ? (
        <Notice tone="error" title="The query is not understood">
          {problem}
        </Notice>
      ) : null}
      {refusal ? <Refusal refusal={refusal} /> : null}
      {result ? (
        result.data.length === 0 ? (
          <Empty>No record matches.</Empty>
        ) : (
          <>
            {result.meta.truncated ? (
              <Notice tone="warn" title="The answer holds the first groups only">
                The data service answered {result.meta.groups} groups and there are more: narrow the
                filter.
              </Notice>
            ) : null}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    {groupBy.map((field) => (
                      <th>
                        {labelOf(
                          collection.fields.find((entry) => entry.name === field) ?? { name: field }
                        )}
                      </th>
                    ))}
                    <th class="num">Count</th>
                    <th style="width: 30%">
                      <span class="visually-hidden">Share</span>
                    </th>
                    {metricColumns.map(([fn, field]) => (
                      <th class="num">
                        {fn} of {field}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((group) => (
                    <tr>
                      {groupBy.map((field) => (
                        <td>
                          <Value value={group.group[field]} />
                        </td>
                      ))}
                      <td class="num">{group.count}</td>
                      <td>
                        <div
                          style={`height: 0.6rem; border-radius: 3px; background: var(--accent); width: ${Math.max(1, (group.count / largest) * 100).toFixed(1)}%`}
                          aria-hidden="true"
                        />
                      </td>
                      {metricColumns.map(([fn, field]) => (
                        <td class="num">
                          <Value
                            value={
                              (
                                group[fn as (typeof FUNCTIONS)[number]] as
                                  | Record<string, unknown>
                                  | undefined
                              )?.[field]
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </>,
    {
      title: `${collection.label}: aggregate`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(
        workspace,
        me,
        { label: collection.label, href: collectionPath(workspace, key) },
        { label: 'Aggregate' }
      ),
    }
  )
})
