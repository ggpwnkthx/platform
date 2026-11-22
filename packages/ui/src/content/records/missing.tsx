import { href } from '../../url.ts'
import { Empty, Notice } from '../../ui/bits.tsx'
import { CollectionIcon } from '../../ui/icons.tsx'
import { Page } from '../../shell/page.tsx'

/** No collection is chosen: the reader is asked to choose one. */
export function NoCollection({ ws }: { ws: string }) {
  return (
    <Page
      title="Records"
      crumbs={[{ label: 'Content', href: href('/content', { ws }) }]}
      icon={<CollectionIcon size={22} />}
    >
      <Empty icon={<CollectionIcon size={28} />} title="Choose a collection">
        Pick one from the list to read its records.
      </Empty>
    </Page>
  )
}

/** The collection the address names is one the database does not show this reader. */
export function NoTable({ ws, table }: { ws: string; table: string }) {
  return (
    <Page
      title={table}
      crumbs={[{ label: 'Content', href: href('/content', { ws }) }, { label: ws }]}
      icon={<CollectionIcon size={22} />}
    >
      <Notice tone="warning" title={`The database shows you no collection named ${ws}.${table}`}>
        It does not exist, or your role holds no right on it. The catalog only lists what you may
        reach.
      </Notice>
    </Page>
  )
}

/** The reader may read no field of the collection, and may yet add rows to it. */
export function NoReadableFields({
  mayInsert,
}: {
  /** Whether the reader may add rows even though it may read none. */
  mayInsert: boolean
}) {
  return (
    <Notice tone="warning" title="You may not read any field of this collection">
      {mayInsert
        ? 'You may still add records: the database grants you INSERT without SELECT, so a write reports how many rows it touched and nothing more.'
        : 'The database grants your role no SELECT here.'}
    </Notice>
  )
}
