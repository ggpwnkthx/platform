import { Button, Group, Tabs, Text, Textarea, TextInput } from '@mantine/core'
import {
  type FieldSpec,
  collectionTarget,
  commentCollectionStatement,
  dropCollectionStatement,
  dropFieldStatement,
  fieldStatements,
  fieldTarget,
  fieldsViewsStatement,
  tablesIn,
} from '@platform/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Change } from '../bits/change.tsx'
import { NoCollection } from '../bits/empty.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Page, Section } from '../bits/page.tsx'
import { useFields } from '../fields/resolve.ts'
import type { Field } from '../fields/types.ts'
import { MetadataPanel } from '../metadata/panel.tsx'
import { FieldSayings } from '../metadata/sayings.tsx'
import { usePlace } from '../session/hooks.ts'
import { useSession } from '../session/context.ts'
import { useNames } from '../shell/names.ts'
import { CollectionAccess } from '../access/collection.tsx'
import { emptyField, FieldForm, fieldOf } from './field-form.tsx'
import { FieldTable } from './field-table.tsx'
import { ManyToMany } from './many.tsx'

/** One collection: its fields, its metadata, and its access. */
export function CollectionModel() {
  const place = usePlace()
  const { catalog } = useSession()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields } = useFields(place.ws, place.c)
  const [adding, setAdding] = useState<FieldSpec | null>(null)
  const [saying, setSaying] = useState<Field | null>(null)
  const [dropping, setDropping] = useState<string | null>(null)
  const [dropAll, setDropAll] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [mending, setMending] = useState(false)
  if (!info)
    return (
      <Page title="Collection">
        <NoCollection name={place.c} />
      </Page>
    )
  const said = names(place.ws, place.c)
  const unsaid = fields.filter((f) => !f.hasViews)
  return (
    <Page
      title={said.name}
      crumbs={[
        <Link key="m" to={place.to('/data/model')}>
          Data model
        </Link>,
        <span key="c" className="mono">
          {place.ws}.{place.c}
        </span>,
      ]}
      mark={<ItemMark {...said} size={44} table />}
      actions={
        <Button variant="default" component={Link} to={place.to('/data/records', { c: place.c })}>
          Records
        </Button>
      }
    >
      <Tabs
        value={place.params.get('tab') ?? 'fields'}
        onChange={(tab) => place.set({ tab })}
        keepMounted={false}
      >
        <Tabs.List mb="lg">
          <Tabs.Tab value="fields">Fields</Tabs.Tab>
          <Tabs.Tab value="metadata">Metadata</Tabs.Tab>
          <Tabs.Tab value="access">Access</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="fields">
          <Group justify="flex-end" mb="sm">
            {info.can_alter && unsaid.length > 0 && (
              <Button variant="subtle" onClick={() => setMending(true)}>
                Give {unsaid.length} field{unsaid.length === 1 ? '' : 's'} the saying they lack
              </Button>
            )}
            {info.can_alter && (
              <Button leftSection={<Plus size={16} />} onClick={() => setAdding(emptyField)}>
                Add field
              </Button>
            )}
            {info.can_alter && (
              <ManyToMany schema={place.ws} table={place.c} tables={tablesIn(catalog, place.ws)} />
            )}
          </Group>
          <FieldTable
            fields={fields}
            canAlter={info.can_alter}
            onSay={setSaying}
            onDrop={(f) => setDropping(f.name)}
          />
          {info.can_alter && (
            <Section title="Drop the collection" note="Every record goes with it.">
              <Button color="red" variant="light" onClick={() => setDropAll('')}>
                Drop {place.c}
              </Button>
            </Section>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="metadata">
          <Section
            title="What it is for"
            note="Kept as the table's comment."
            actions={
              info.can_alter && (
                <Button variant="default" onClick={() => setNote(info.comment ?? '')}>
                  Change
                </Button>
              )
            }
          >
            <Text c={info.comment ? undefined : 'dimmed'}>{info.comment ?? 'Nothing said.'}</Text>
          </Section>
          <MetadataPanel target={collectionTarget(place.ws, place.c)} canEdit={info.can_alter} />
        </Tabs.Panel>
        <Tabs.Panel value="access">
          <CollectionAccess schema={place.ws} table={place.c} fields={fields} />
        </Tabs.Panel>
      </Tabs>

      <Change
        title="Add field"
        opened={!!adding}
        onClose={() => setAdding(null)}
        statements={() => fieldStatements(place.ws, place.c, fieldOf(adding ?? emptyField))}
      >
        {adding && <FieldForm field={adding} onChange={setAdding} />}
      </Change>
      {saying && (
        <FieldSayings
          field={saying}
          target={fieldTarget(place.ws, place.c, saying.name)}
          onClose={() => setSaying(null)}
        />
      )}
      <Change
        title="Where the fields appear"
        opened={mending}
        onClose={() => setMending(false)}
        statements={() => [
          fieldsViewsStatement(unsaid.map((f) => fieldTarget(place.ws, place.c, f.name))),
        ]}
      >
        <Text fz="sm" c="dimmed">
          These fields were made before every field carried its own saying. This writes the default
          — shown everywhere — on each of them.
        </Text>
      </Change>
      <Change
        title={`Drop ${dropping}`}
        danger
        label="Drop"
        opened={!!dropping}
        onClose={() => setDropping(null)}
        statements={() => [dropFieldStatement(place.ws, place.c, dropping ?? '')]}
      >
        <Text fz="sm" c="dimmed">
          The column and every value in it are gone when this runs.
        </Text>
      </Change>
      <Change
        title="What it is for"
        opened={note !== null}
        onClose={() => setNote(null)}
        statements={() => [commentCollectionStatement(place.ws, place.c, note ?? '')]}
      >
        <Textarea autosize value={note ?? ''} onChange={(e) => setNote(e.currentTarget.value)} />
      </Change>
      <Change
        title={`Drop ${place.c}`}
        danger
        label="Drop"
        opened={dropAll !== null}
        ready={dropAll === place.c}
        onClose={() => setDropAll(null)}
        done={() => navigate(place.to('/data/model'))}
        statements={() => [dropCollectionStatement(place.ws, place.c)]}
      >
        <TextInput
          label="Every record goes with it. Type the collection's name to confirm."
          className="mono"
          value={dropAll ?? ''}
          onChange={(e) => setDropAll(e.currentTarget.value)}
        />
      </Change>
    </Page>
  )
}
