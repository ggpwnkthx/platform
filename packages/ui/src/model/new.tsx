import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core'
import { type FieldSpec, collectionStatements } from '@platform/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Page, Problem, Remove, Statements } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { emptyField, FieldForm, fieldOf } from './field-form.tsx'

/** A new collection, with its fields. Created through platform.create_collection, as the reader. */
export function NewCollection() {
  const { run } = useSession()
  const place = usePlace()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [fields, setFields] = useState<FieldSpec[]>([{ ...emptyField, name: 'name' }])
  const [refusal, setRefusal] = useState<unknown>(null)
  let statements: string[] = []
  let problem = ''
  try {
    statements = collectionStatements(place.ws, name.trim(), note, fields.map(fieldOf))
  } catch (error) {
    problem = name ? (error as Error).message : 'Name the collection.'
  }
  const create = () =>
    run(statements).then(
      () => navigate(place.to('/model/collection', { c: name.trim() })),
      setRefusal
    )
  return (
    <Page
      title="New collection"
      crumbs={[
        <Link key="m" to={place.to('/model')}>
          Data model
        </Link>,
        'New',
      ]}
      actions={
        <Button disabled={!statements.length} onClick={create}>
          Create
        </Button>
      }
    >
      <Stack maw={760}>
        <Group grow>
          <TextInput
            label="Name"
            className="mono"
            description={`A table in ${place.ws}`}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="What it is for"
            description="Kept as the table's comment"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </Group>
        <Text fz="sm" c="dimmed">
          Every collection is made with id, created_at, updated_at, created_by, updated_by and
          version, with row security on and no policy: its owner administers it, and grants alone
          show nobody a row.
        </Text>
        {fields.map((field, at) => (
          <Card key={String(at)} withBorder radius="md">
            <Group justify="space-between" mb="xs">
              <Text fw={650}>Field {at + 1}</Text>
              <Remove
                label="Leave this field out"
                onClick={() => setFields(fields.filter((_, i) => i !== at))}
              />
            </Group>
            <FieldForm
              field={field}
              onChange={(next) => setFields(fields.map((f, i) => (i === at ? next : f)))}
            />
          </Card>
        ))}
        <Button
          variant="default"
          leftSection={<Plus size={16} />}
          onClick={() => setFields([...fields, emptyField])}
        >
          Add a field
        </Button>
        {problem && (
          <Text fz="sm" c="dimmed">
            {problem}
          </Text>
        )}
        <Statements sql={statements} />
        <Problem error={refusal} />
      </Stack>
    </Page>
  )
}
