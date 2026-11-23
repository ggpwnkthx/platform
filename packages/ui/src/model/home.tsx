import { ActionIcon, Group, Table, Text } from '@mantine/core'
import { columnsOf, tablesIn } from '@platform/core'
import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { NoCollection } from '../bits/empty.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Page, Tag } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
/** The collections of the workspace and their shape: the model view of the data module. */
export function ModelHome() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const collections = tablesIn(catalog, place.ws)
  return (
    <Page
      title={names(place.ws).name}
      crumbs={[
        <Link key="d" to={place.to('/data')}>
          Data
        </Link>,
        'Data model',
      ]}
      mark={<ItemMark {...names(place.ws)} size={44} />}
      actions={
        place.schema?.can_create && (
          <ActionIcon
            size={44}
            radius="xl"
            component={Link}
            to={place.to('/data/model/new')}
            aria-label="New collection"
            title="New collection"
          >
            <Plus />
          </ActionIcon>
        )
      }
    >
      {!collections.length && <NoCollection />}
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Collection</Table.Th>
            <Table.Th>Fields</Table.Th>
            <Table.Th>Row security</Table.Th>
            <Table.Th>Owner</Table.Th>
            <Table.Th>What it is for</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {collections.map((t) => (
            <Table.Tr key={t.name}>
              <Table.Td>
                <Group
                  gap="sm"
                  wrap="nowrap"
                  component={Link}
                  {...{ to: place.to('/data/model/collection', { c: t.name }) }}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <ItemMark {...names(t.schema, t.name)} size={28} table />
                  <div>
                    <Text fw={600}>{names(t.schema, t.name).name}</Text>
                    <Text fz="xs" className="mono" c="dimmed">
                      {t.name}
                      {t.kind === 'v' ? ' (view)' : ''}
                    </Text>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td className="mono">{columnsOf(catalog, t.schema, t.name).length}</Table.Td>
              <Table.Td>{t.rls ? <Tag color="blue">on</Tag> : <Tag>off</Tag>}</Table.Td>
              <Table.Td className="mono">{t.owner}</Table.Td>
              <Table.Td c="dimmed">{t.comment}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Page>
  )
}
