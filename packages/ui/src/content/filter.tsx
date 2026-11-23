import { Button, Popover, Select, Stack, Text, TextInput } from '@mantine/core'
import { type Condition, type Operator, valueless } from '@platform/core'
import { Filter as FilterIcon } from 'lucide-react'
import { useState } from 'react'
import { operatorWords } from '../fields/filters.ts'
import type { Field } from '../fields/types.ts'
/** One condition at a time: a field, one of the operators its type offers, and a value. */
export function FilterBuilder({
  fields,
  add,
}: {
  fields: Field[]
  add: (name: string, condition: Condition) => void
}) {
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [op, setOp] = useState<Operator | null>(null)
  const [value, setValue] = useState('')
  const field = fields.find((f) => f.name === name)
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
            }}
            comboboxProps={{ withinPortal: false }}
          />
          <Select
            placeholder="Condition"
            data={(field?.type.operators ?? []).map((o) => ({ value: o, label: operatorWords[o] }))}
            value={op}
            onChange={(next) => setOp(next as Operator)}
            comboboxProps={{ withinPortal: false }}
          />
          {op && !valueless.includes(op) && (
            <TextInput
              placeholder={op === 'in' || op === 'not_in' ? 'Values, separated by commas' : 'Value'}
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
            />
          )}
          <Button
            disabled={!name || !op}
            onClick={() => {
              add(name!, { op: op!, value })
              setOpened(false)
              setValue('')
            }}
          >
            Add filter
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
