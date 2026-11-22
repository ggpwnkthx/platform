import { columnsOf, systemColumns, tablesIn } from '@platform/data'
import { Rights } from '../access/rights.tsx'
import { Page } from '../shell/page.tsx'
import { useWorkspaceView } from '../workspace/view.ts'
import { href } from '../url.ts'
import { Badge, Empty } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { Grid } from '../ui/grid.tsx'
import { CollectionIcon, ModelIcon, PlusIcon } from '../ui/icons.tsx'

/** The model of the workspace: every collection it holds, and what each one is. */
export function ModelHome() {
  const { ws, schema, shown, catalog } = useWorkspaceView()
  const tables = tablesIn(catalog, ws)
  return (
    <Page
      title="Data model"
      icon={<ModelIcon size={22} />}
      crumbs={[{ label: shown.displayName ?? ws }]}
      subtitle={schema ? `Collections are tables in ${ws}; fields are their columns.` : undefined}
      actions={
        schema?.can_create ? (
          <Action
            label="New collection"
            icon={<PlusIcon size={22} />}
            href={href('/model/new', { ws })}
          />
        ) : undefined
      }
    >
      {tables.length ? (
        <Grid
          head={[
            'Collection',
            'Fields',
            'Relations',
            'Owner',
            'Row security',
            'Your rights',
            'Note',
          ]}
        >
          {tables.map((t) => {
            const columns = columnsOf(catalog, ws, t.name)
            const relations = catalog.relations.filter((r) => r.schema === ws && r.table === t.name)
            return (
              <tr key={t.name}>
                <td>
                  <a class="grid-open strong" href={href('/model/collection', { ws, c: t.name })}>
                    <CollectionIcon size={16} aria-hidden="true" /> {t.name}
                  </a>
                </td>
                <td class="is-number mono">
                  {columns.filter((c) => !systemColumns.includes(c.name)).length}
                </td>
                <td class="cell-muted">{relations.map((r) => r.target_table).join(', ') || '—'}</td>
                <td class="mono">{t.owner}</td>
                <td>{t.rls ? <Badge tone="primary">On</Badge> : <Badge>Off</Badge>}</td>
                <td>
                  <Rights table={t} columns={columns} compact />
                </td>
                <td class="cell-muted">
                  <span class="clip clip-narrow" title={t.comment ?? undefined}>
                    {t.comment}
                  </span>
                </td>
              </tr>
            )
          })}
        </Grid>
      ) : (
        <Empty icon={<CollectionIcon size={28} />} title="No collection here yet">
          {schema?.can_create
            ? 'Start the model with a first collection.'
            : 'You may not create collections in this workspace.'}
        </Empty>
      )}
    </Page>
  )
}
