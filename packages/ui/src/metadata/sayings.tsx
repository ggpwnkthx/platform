import { Button, Group, Text, TextInput } from '@mantine/core'
import {
  type MetadataTarget,
  type ViewMode,
  isCustomView,
  metadataStatements,
  renderersKey,
  renderersValue,
  situations,
  validViewName,
  viewsKey,
} from '@platform/core'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import type { Field } from '../fields/types.ts'
import { RendererChoice } from './renderer.tsx'
import { changed } from './shared.ts'
import { CustomViews, ViewModes } from './views.tsx'

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
      <ViewModes views={views} computed={field.computed} onChange={setViews} />
      <CustomViews views={views} onChange={setViews} />
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
      {[...situations, ...Object.keys(views).filter(isCustomView)].map((situation) => (
        <RendererChoice
          key={situation}
          field={field}
          situation={situation}
          choice={renderers[situation]}
          onChange={(next) => setRenderers({ ...renderers, [situation]: next })}
        />
      ))}
    </Change>
  )
}
