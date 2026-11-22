import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { type Condition, type Filter, type Operator, valueless } from '@platform/data'
import { filterStart, filterValue } from '../../fields/edit.ts'
import { FilterLine } from '../../fields/inputs.tsx'
import type { Field } from '../../fields/field.ts'
import { Button } from '../../ui/button.tsx'
import { Select } from '../../ui/form.tsx'
import { FilterIcon } from '../../ui/icons.tsx'
import { Menu } from '../../ui/overlay.tsx'
import { operatorLabels } from '../labels.ts'

/** The filter the address carries, as the database reads it. */
export function readFilter(text: string | undefined): Filter {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Filter) : {}
  } catch {
    return {}
  }
}

/** What one condition of a filter says, in words. */
export function conditionText(
  condition: Condition,
  draw?: (value: unknown) => ComponentChildren
): ComponentChildren {
  const label = operatorLabels[condition.op]
  if (valueless.includes(condition.op)) return label
  const raw = Array.isArray(condition.value) ? condition.value.join(', ') : condition.value
  if (!draw) return `${label} ${String(raw)}`
  return (
    <>
      {label} {draw(raw)}
    </>
  )
}

/** The form that adds one condition: a field, an operator its type offers, and a value. */
export function FilterBuilder({
  fields,
  onAdd,
}: {
  /** The fields that may be filtered on: those the reader reads and the owner offers. */
  fields: Field[]
  onAdd: (column: string, condition: Condition) => void
}) {
  const [open, setOpen] = useState(false)
  const [column, setColumn] = useState(fields[0]?.name ?? '')
  const field = fields.find((one) => one.name === column) ?? fields[0]
  const ops = field?.type.filter.operators ?? []
  const [op, setOp] = useState<Operator>(ops[0] ?? 'eq')
  const [value, setValue] = useState(field ? filterStart(field) : '')
  // Another field is another type: its own operators, and its own first value.
  useEffect(() => {
    if (!ops.includes(op)) setOp(ops[0] ?? 'eq')
    setValue(field ? filterStart(field) : '')
  }, [column])
  const apply = (event: Event) => {
    event.preventDefault()
    if (!field) return
    onAdd(field.name, { op, value: filterValue(field, op, value) })
    setOpen(false)
    setValue(filterStart(field))
  }
  const ValueInput = field?.type.filter.Input ?? FilterLine
  return (
    <div class="menu-anchor">
      <Button icon={<FilterIcon size={16} />} aria-expanded={open} onClick={() => setOpen(!open)}>
        Filter
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} align="start">
        <form class="filter-form" onSubmit={apply}>
          <p class="menu-label">Show rows where</p>
          <Select
            value={column}
            onChange={(e) => setColumn(e.currentTarget.value)}
            aria-label="Field"
          >
            {fields.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name}
              </option>
            ))}
          </Select>
          <Select
            value={op}
            onChange={(e) => setOp(e.currentTarget.value as Operator)}
            aria-label="Operator"
          >
            {ops.map((o) => (
              <option key={o} value={o}>
                {operatorLabels[o]}
              </option>
            ))}
          </Select>
          {field && !valueless.includes(op) && (
            <ValueInput field={field} op={op} text={value} onChange={setValue} />
          )}
          <Button tone="primary" type="submit">
            Add filter
          </Button>
        </form>
      </Menu>
    </div>
  )
}
