import type { Renderer, RendererOption } from '../../fields/renderers/renderers.tsx'
import { Field, Input } from '../../ui/form.tsx'
import { iconFor } from '../../ui/icons.tsx'
import { familyOf } from '../color.ts'
import { ColourPicker, IconPicker } from './pickers.tsx'

/**
 * The options one renderer takes, and how they are given: a text and a number are typed, an
 * icon and a colour are picked from the platform's own set and its own palette. Whichever it
 * is, the option is kept the same way — a name and a value in the saying — and an option
 * that is emptied is not kept at all.
 */
export function RendererOptions({
  renderer,
  values,
  disabled,
  group,
  onChange,
}: {
  renderer: Renderer
  values: Record<string, unknown>
  disabled: boolean
  group: string
  onChange: (options: Record<string, unknown>) => void
}) {
  if (!renderer.options?.length) return null
  const give = (option: RendererOption, value: unknown) => {
    const next = { ...values }
    if (value === '') delete next[option.name]
    else next[option.name] = value
    onChange(next)
  }
  return (
    <fieldset class="field field-wide renderer-options">
      <legend class="field-label">{renderer.label}</legend>
      {renderer.options.map((option) => {
        const id = `${group}-${option.name}`
        const given = values[option.name]
        if (option.type === 'icon' || option.type === 'colour')
          return (
            <fieldset key={option.name} class="field field-wide types">
              <legend class="field-label">{option.label}</legend>
              {option.type === 'icon' ? (
                <IconPicker
                  name={id}
                  value={iconFor(typeof given === 'string' ? given : null) ? String(given) : ''}
                  disabled={disabled}
                  noneTitle="No icon"
                  onChoose={(icon) => give(option, icon)}
                />
              ) : (
                <ColourPicker
                  name={id}
                  chosen={familyOf(given)}
                  disabled={disabled}
                  onChoose={(colour) => give(option, colour)}
                />
              )}
            </fieldset>
          )
        return (
          <Field
            key={option.name}
            label={option.label}
            id={id}
            hint={option.placeholder ? `For example: ${option.placeholder}` : undefined}
          >
            <Input
              id={id}
              mono={option.type === 'number'}
              value={given === undefined ? '' : String(given)}
              disabled={disabled}
              placeholder={option.placeholder}
              onInput={(e) => {
                const raw = e.currentTarget.value
                give(option, raw !== '' && option.type === 'number' ? Number(raw) : raw)
              }}
            />
          </Field>
        )
      })}
    </fieldset>
  )
}
