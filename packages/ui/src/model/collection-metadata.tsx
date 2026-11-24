import { Button, Text, Textarea } from '@mantine/core'
import { collectionTarget, commentCollectionStatement } from '@platform/core'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import { Section } from '../bits/page.tsx'
import { MetadataPanel } from '../metadata/panel.tsx'

/**
 * What a collection is for: the table's own comment, and the sayings its owner has made
 * of it. The comment is PostgreSQL's, and the sayings are the metadata the collection
 * carries.
 */
export function CollectionMetadata({
  schema,
  table,
  comment,
  canAlter,
}: {
  schema: string
  table: string
  comment: string | null
  canAlter: boolean
}) {
  const [note, setNote] = useState<string | null>(null)
  return (
    <>
      <Section
        title="What it is for"
        note="Kept as the table's comment."
        actions={
          canAlter && (
            <Button variant="default" onClick={() => setNote(comment ?? '')}>
              Change
            </Button>
          )
        }
      >
        <Text c={comment ? undefined : 'dimmed'}>{comment ?? 'Nothing said.'}</Text>
      </Section>
      <MetadataPanel target={collectionTarget(schema, table)} canEdit={canAlter} />
      <Change
        title="What it is for"
        opened={note !== null}
        onClose={() => setNote(null)}
        statements={() => [commentCollectionStatement(schema, table, note ?? '')]}
      >
        <Textarea autosize value={note ?? ''} onChange={(e) => setNote(e.currentTarget.value)} />
      </Change>
    </>
  )
}
