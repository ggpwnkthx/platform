import { NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { type RendererOption, renderersFor } from '../fields/renderers.tsx'
import type { Field } from '../fields/types.ts'
import { textOf } from '../fields/values.tsx'
import { ColourPicker, IconPicker } from './pickers.tsx'
import { situationWords } from './shared.ts'

/** One option of a renderer: the value it takes, drawn the way it takes it. */
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

/** How a field's value is drawn in one place: the renderer, and the options it takes. */
export function RendererChoice({
  field,
  situation,
  choice,
  onChange,
}: {
  field: Field
  situation: string
  choice: { renderer: string; options: Record<string, unknown> } | undefined
  onChange(next: { renderer: string; options: Record<string, unknown> } | undefined): void
}) {
  const offered = renderersFor(field)
  const renderer = offered.find((r) => r.name === choice?.renderer)
  const options = (next: Record<string, unknown>) =>
    onChange({
      renderer: choice!.renderer,
      options: Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== undefined && v !== '')
      ),
    })
  return (
    <Stack gap={6}>
      <Select
        label={situationWords[situation as 'list'] ?? situation}
        data={[
          { value: 'default', label: "The platform's own way" },
          ...offered.map((r) => ({ value: r.name, label: r.label })),
        ]}
        value={choice?.renderer ?? 'default'}
        allowDeselect={false}
        onChange={(next) =>
          onChange(!next || next === 'default' ? undefined : { renderer: next, options: {} })
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
}
