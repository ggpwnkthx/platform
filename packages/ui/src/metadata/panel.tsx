import { Anchor, Button, Group, Table, Text, TextInput } from '@mantine/core'
import { type MetadataTarget, isReservedKey, metadata, metadataStatements } from '@platform/core'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Change } from '../bits/change.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Empty, Section } from '../bits/page.tsx'
import { textOf } from '../fields/values.tsx'
import { useDb } from '../session/hooks.ts'
import { ColourPicker, IconPicker } from './pickers.tsx'
import { changed } from './shared.ts'

const targetKey = (t: MetadataTarget) => ['metadata', t.scope, t.schema, t.table, t.column]

/**
 * What an item is, as opposed to what it holds. The three reserved keys — how the item
 * presents itself — have an editor here; every other key is a row of platform.item_metadata,
 * read and changed like any record.
 */
export function MetadataPanel({ target, canEdit }: { target: MetadataTarget; canEdit: boolean }) {
  const { pathname, search } = useLocation()
  const entries = useDb(targetKey(target), (db) => metadata(db, target))
  const [editing, setEditing] = useState(false)
  const held = Object.fromEntries((entries.data ?? []).map((e) => [e.key, e.value]))
  const [draft, setDraft] = useState({ display_name: '', icon: '', color: '' })
  const open = () => {
    setDraft({
      display_name: textOf(held.display_name),
      icon: textOf(held.icon),
      color: textOf(held.color),
    })
    setEditing(true)
  }
  const item = new URLSearchParams({ ws: 'platform', c: 'item_metadata', from: pathname + search })
  const filtered = new URLSearchParams({
    ws: 'platform',
    c: 'item_metadata',
    'f.scope': `eq.${target.scope}`,
    'f.schema_name': `eq.${target.schema}`,
  })
  for (const [column, value] of [
    ['scope', target.scope],
    ['schema_name', target.schema],
    ['table_name', target.table],
    ['column_name', target.column],
  ] as const)
    if (value) item.set(`v.${column}`, value)
  if (target.table) filtered.set('f.table_name', `eq.${target.table}`)
  const others = (entries.data ?? []).filter((e) => !isReservedKey(target.scope, e.key))
  return (
    <>
      <Section
        title="Presentation"
        note="The name people read, a mark and a colour. Whoever may reach the item reads them; only its owner changes them."
        actions={
          canEdit && (
            <Button variant="default" leftSection={<Pencil size={14} />} onClick={open}>
              Change
            </Button>
          )
        }
      >
        <Group>
          <ItemMark
            icon={textOf(held.icon)}
            color={textOf(held.color)}
            size={44}
            table={target.scope !== 'workspace'}
          />
          <div>
            <Text fw={650}>
              {textOf(held.display_name) || (
                <Text span c="dimmed">
                  No display name
                </Text>
              )}
            </Text>
            <Text fz="sm" className="mono">
              {[target.schema, target.table].filter(Boolean).join('.')}
            </Text>
          </div>
        </Group>
      </Section>
      <Section
        title="Metadata"
        note="Every other key is a row of the platform's own collection, drawn and changed like any record."
        actions={
          <>
            <Button variant="subtle" component={Link} to={`/content/records?${filtered}`}>
              Open as a collection
            </Button>
            {canEdit && (
              <Button variant="default" component={Link} to={`/content/item?${item}`}>
                Add key
              </Button>
            )}
          </>
        }
      >
        {!others.length && <Empty>No key of its own.</Empty>}
        <Table>
          <Table.Tbody>
            {others.map((e) => (
              <Table.Tr key={e.key}>
                <Table.Td w={220}>
                  <Anchor
                    component={Link}
                    className="mono"
                    to={`/content/item?${new URLSearchParams({ ws: 'platform', c: 'item_metadata', id: e.id, from: pathname + search })}`}
                  >
                    {e.key}
                  </Anchor>
                </Table.Td>
                <Table.Td className="mono">{textOf(e.value)}</Table.Td>
                <Table.Td c="dimmed" fz="sm" ta="right">
                  {e.updated_by}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>
      <Change
        title="Presentation"
        opened={editing}
        onClose={() => setEditing(false)}
        statements={() => {
          if (draft.display_name.length > 80)
            throw new Error('A display name is at most 80 characters.')
          return metadataStatements(
            target,
            Object.entries(draft)
              .filter(([key, value]) => changed(held[key] ?? '', value))
              .map(([key, value]) => ({ key, value: value.trim() || null }))
          )
        }}
      >
        <Group>
          <ItemMark
            icon={draft.icon}
            color={draft.color}
            size={44}
            table={target.scope !== 'workspace'}
          />
          <Text fw={650}>{draft.display_name || target.table || target.schema}</Text>
        </Group>
        <TextInput
          label="Display name"
          value={draft.display_name}
          onChange={(e) => setDraft({ ...draft, display_name: e.currentTarget.value })}
        />
        <div>
          <Text fz="sm" fw={500} mb={4}>
            Icon
          </Text>
          <IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
        </div>
        <div>
          <Text fz="sm" fw={500} mb={4}>
            Colour
          </Text>
          <ColourPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
        </div>
      </Change>
    </>
  )
}
