import {
  ActionIcon,
  Anchor,
  Button,
  CheckIcon,
  ColorSwatch,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import {
  customModes,
  isCustomView,
  isReservedKey,
  metadata,
  type MetadataTarget,
  metadataStatements,
  renderersKey,
  renderersValue,
  situationModes,
  situations,
  validViewName,
  type ViewMode,
  viewsKey,
} from '@platform/core'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Change, Empty, ItemIcon, ItemMark, itemIcons, palette, Remove, Section } from './bits.tsx'
import { type Field, type RendererOption, renderersFor, textOf } from './fields.tsx'
import { useDb } from './session.tsx'

export function IconPicker({ value, onChange }: { value: string; onChange(name: string): void }) {
  return (
    <SimpleGrid cols={10} spacing={4}>
      {itemIcons.map((name) => (
        <ActionIcon
          key={name}
          variant={value === name ? 'filled' : 'default'}
          title={name}
          aria-label={name}
          onClick={() => onChange(value === name ? '' : name)}
        >
          <ItemIcon name={name} />
        </ActionIcon>
      ))}
    </SimpleGrid>
  )
}
/** The palette's families: the reserved ones first, the studio's own five last. */
export function ColourPicker({ value, onChange }: { value: string; onChange(name: string): void }) {
  return (
    <Group gap={6}>
      {Object.entries(palette).map(([name, [fill]]) => (
        <ColorSwatch
          key={name}
          component="button"
          color={fill}
          title={name}
          aria-label={name}
          onClick={() => onChange(value === name ? '' : name)}
          style={{ cursor: 'pointer', color: '#fff' }}
        >
          {value === name && <CheckIcon size={12} />}
        </ColorSwatch>
      ))}
    </Group>
  )
}

const targetKey = (t: MetadataTarget) => ['metadata', t.scope, t.schema, t.table, t.column]
const changed = (held: unknown, wanted: unknown) =>
  JSON.stringify(held ?? null) !== JSON.stringify(wanted ?? null)

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

const modeWords: Record<ViewMode, string> = {
  show: 'Shown',
  hide: 'Hidden',
  readonly: 'Shown and locked',
}
const situationWords = {
  list: 'In the records grid',
  record: 'In the record form',
  filter: 'In the filter builder',
}
function OptionInput({
  option,
  value,
  onChange,
}: {
  option: RendererOption
  value: unknown
  onChange(value: unknown): void
}) {
  if (option.type === 'icon')
    return (
      <div>
        <Text fz="sm" fw={500}>
          {option.label}
        </Text>
        <IconPicker value={textOf(value)} onChange={onChange} />
      </div>
    )
  if (option.type === 'colour')
    return (
      <div>
        <Text fz="sm" fw={500}>
          {option.label}
        </Text>
        <ColourPicker value={textOf(value)} onChange={onChange} />
      </div>
    )
  if (option.type === 'number')
    return (
      <NumberInput
        label={option.label}
        placeholder={option.placeholder}
        value={(value as number) ?? ''}
        onChange={(n) => onChange(n === '' ? undefined : n)}
      />
    )
  return (
    <TextInput
      label={option.label}
      placeholder={option.placeholder}
      value={textOf(value)}
      onChange={(e) => onChange(e.currentTarget.value || undefined)}
    />
  )
}

/**
 * What a field says of itself: its name, where it appears, and how its values are drawn in
 * each place. It is the field's own metadata, so PostgreSQL decides who reads the saying and
 * who changes it — and it narrows the interface without granting anything.
 */
export function FieldSayings({
  field,
  target,
  onClose,
}: {
  field: Field
  target: MetadataTarget
  onClose(): void
}) {
  const [name, setName] = useState(field.label === field.name ? '' : field.label)
  const [views, setViews] = useState<Record<string, ViewMode | undefined>>(field.views)
  const [renderers, setRenderers] = useState(field.renderers)
  const [custom, setCustom] = useState('')
  const offered = renderersFor(field)
  return (
    <Change
      title={`Field ${field.name}`}
      opened
      onClose={onClose}
      statements={() => {
        const changes: { key: string; value: unknown }[] = []
        if (name.length > 80) throw new Error('A display name is at most 80 characters.')
        if (changed(field.label === field.name ? '' : field.label, name.trim()))
          changes.push({ key: 'display_name', value: name.trim() || null })
        if (changed(field.views, views) || !field.hasViews)
          changes.push({ key: viewsKey, value: views })
        if (changed(renderersValue(field.renderers), renderersValue(renderers)))
          changes.push({ key: renderersKey, value: renderersValue(renderers) })
        return metadataStatements(target, changes)
      }}
    >
      <TextInput
        label="Display name"
        description="The label the interface shows for the column; the column keeps its own name."
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Text fw={650}>Where it appears</Text>
      {situations.map((situation) => (
        <Group key={situation} justify="space-between">
          <Text fz="sm">{situationWords[situation]}</Text>
          {field.computed && situation === 'record' ? (
            <Text fz="sm" c="dimmed">
              Shown and locked: PostgreSQL computes it
            </Text>
          ) : (
            <SegmentedControl
              size="xs"
              data={situationModes[situation].map((mode) => ({
                value: mode,
                label: modeWords[mode],
              }))}
              value={views[situation]}
              onChange={(mode) => setViews({ ...views, [situation]: mode as ViewMode })}
            />
          )}
        </Group>
      ))}
      {Object.keys(views)
        .filter(isCustomView)
        .map((view) => (
          <Group key={view} justify="space-between">
            <Text fz="sm" className="mono">
              {view}
            </Text>
            <Group gap="xs">
              <SegmentedControl
                size="xs"
                data={customModes.map((mode) => ({ value: mode, label: modeWords[mode] }))}
                value={views[view]}
                onChange={(mode) => setViews({ ...views, [view]: mode as ViewMode })}
              />
              <Remove
                label={`Forget the view ${view}`}
                onClick={() =>
                  setViews(
                    Object.fromEntries(Object.entries(views).filter(([key]) => key !== view))
                  )
                }
              />
            </Group>
          </Group>
        ))}
      <Group align="end">
        <TextInput
          label="A view of your own"
          placeholder="export"
          value={custom}
          onChange={(e) => setCustom(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="default"
          disabled={!validViewName(custom) || custom.trim() in views}
          onClick={() => {
            setViews({ ...views, [custom.trim()]: 'show' })
            setCustom('')
          }}
        >
          Add
        </Button>
      </Group>
      <Text fw={650}>How it is drawn</Text>
      {[...situations, ...Object.keys(views).filter(isCustomView)].map((situation) => {
        const choice = renderers[situation]
        const renderer = offered.find((r) => r.name === choice?.renderer)
        const options = (next: Record<string, unknown>) =>
          setRenderers({
            ...renderers,
            [situation]: {
              renderer: choice!.renderer,
              options: Object.fromEntries(
                Object.entries(next).filter(([, v]) => v !== undefined && v !== '')
              ),
            },
          })
        return (
          <Stack key={situation} gap={6}>
            <Select
              label={situationWords[situation as 'list'] ?? situation}
              data={[
                { value: 'default', label: "The platform's own way" },
                ...offered.map((r) => ({ value: r.name, label: r.label })),
              ]}
              value={choice?.renderer ?? 'default'}
              allowDeselect={false}
              onChange={(next) =>
                setRenderers({
                  ...renderers,
                  [situation]:
                    !next || next === 'default' ? undefined : { renderer: next, options: {} },
                })
              }
            />
            {renderer?.options?.map((option) => (
              <OptionInput
                key={option.name}
                option={option}
                value={choice?.options[option.name]}
                onChange={(value) => options({ ...choice?.options, [option.name]: value })}
              />
            ))}
          </Stack>
        )
      })}
    </Change>
  )
}
