import { Button, Popover, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { type Condition, type Operator, valueless } from '@platform/core'
import { Filter as FilterIcon } from 'lucide-react'
import { useState } from 'react'
import { operatorWords } from '../fields/filters.ts'
import { reachOf, targetOf } from '../fields/reach.ts'
import { resolveFields } from '../fields/resolve.ts'
import type { Field } from '../fields/types.ts'
import { useSession } from '../session/context.ts'

/** One condition at a time: a field, one of the operators its type offers, and a value. */
export function FilterBuilder({
  fields,
  add,
}: {
  fields: Field[]
  add: (name: string, condition: Condition) => void
}) {
  const { catalog } = useSession()
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [op, setOp] = useState<Operator | null>(null)
  const [value, setValue] = useState<unknown>('')
  const [byThem, setByThem] = useState(false)
  const [theirField, setTheirField] = useState<string | null>(null)
  const [theirOp, setTheirOp] = useState<Operator | null>(null)
  const [theirValue, setTheirValue] = useState<unknown>('')
  const field = fields.find((f) => f.name === name)
  // The rows this field reaches: a condition may be on one of their own columns.
  const reach = field ? reachOf(catalog, field) : null
  const others = reach ? resolveFields(catalog, targetOf(reach).schema, targetOf(reach).table) : []
  const their = others.find((f) => f.name === theirField)
  const TheirInput = their?.type.Input
  const ready = byThem ? !!their && !!theirOp : !!name && !!op
  const close = () => {
    setOpened(false)
    setValue('')
    setByThem(false)
    setTheirField(null)
    setTheirOp(null)
    setTheirValue('')
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow>
      <Popover.Target>
        <Button
          variant="default"
          leftSection={<FilterIcon size={16} />}
          onClick={() => setOpened(!opened)}
        >
          Filter
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={280}>
          <Text fw={600} fz="sm">
            Show rows where
          </Text>
          <Select
            placeholder="Field"
            searchable
            data={fields.map((f) => ({ value: f.name, label: f.label }))}
            value={name}
            onChange={(next) => {
              setName(next)
              setOp(null)
              setByThem(false)
              setTheirField(null)
            }}
            comboboxProps={{ withinPortal: false }}
          />
          {reach && (
            <Switch
              size="sm"
              label="…by the rows it reaches"
              checked={byThem}
              onChange={(e) => setByThem(e.currentTarget.checked)}
            />
          )}
          {byThem ? (
            <>
              <Select
                placeholder="Their field"
                searchable
                data={others.map((f) => ({ value: f.name, label: f.label }))}
                value={theirField}
                onChange={(next) => {
                  setTheirField(next)
                  setTheirOp(null)
                }}
                comboboxProps={{ withinPortal: false }}
              />
              <Select
                placeholder="Condition"
                data={(their?.type.operators ?? []).map((o) => ({
                  value: o,
                  label: operatorWords[o],
                }))}
                value={theirOp}
                onChange={(next) => setTheirOp(next as Operator)}
                comboboxProps={{ withinPortal: false }}
              />
              {theirOp && TheirInput && their && !valueless.includes(theirOp) && (
                <TheirInput
                  field={their}
                  value={theirValue}
                  onChange={setTheirValue}
                  label="Value"
                />
              )}
            </>
          ) : (
            <>
              <Select
                placeholder="Condition"
                data={(field?.type.operators ?? []).map((o) => ({
                  value: o,
                  label: operatorWords[o],
                }))}
                value={op}
                onChange={(next) => {
                  setOp(next as Operator)
                  setValue('')
                }}
                comboboxProps={{ withinPortal: false }}
              />
              {op &&
                !valueless.includes(op) &&
                (field?.type.FilterInput ? (
                  <field.type.FilterInput field={field} op={op} value={value} onChange={setValue} />
                ) : (
                  <TextInput
                    placeholder={
                      op === 'in' || op === 'not_in' ? 'Values, separated by commas' : 'Value'
                    }
                    value={String(value ?? '')}
                    onChange={(e) => setValue(e.currentTarget.value)}
                  />
                ))}
            </>
          )}
          <Button
            disabled={!ready}
            onClick={() => {
              if (byThem && their && theirOp)
                add(name!, {
                  op: theirOp,
                  value: theirValue,
                  through: { column: their.name, op: theirOp, value: theirValue },
                })
              else add(name!, { op: op!, value })
              close()
            }}
          >
            Add filter
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
