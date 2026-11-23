import { ActionIcon, Card, Group, SimpleGrid, Text } from '@mantine/core'
import { tablesIn } from '@platform/core'
import { Cog, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { NoCollection } from '../bits/empty.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Empty, Page } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
/** The collections of the workspace in view, as an entry point: the content view of the data module. */
export function ContentHome() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const collections = tablesIn(catalog, place.ws)
  return (
    <Page
      title={names(place.ws).name}
      crumbs={['Data']}
      mark={<ItemMark {...names(place.ws)} size={44} />}
      actions={
        <>
          {place.schema?.can_create && (
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
          )}
          <ActionIcon
            size={44}
            radius="xl"
            component={Link}
            to={place.to('/data/model')}
            aria-label="The data model"
            title="The data model"
          >
            <Cog />
          </ActionIcon>
        </>
      }
    >
      {!place.ws && <Empty>The database gives you USAGE on no workspace yet.</Empty>}
      {place.ws && !collections.length && <NoCollection />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {collections.map((t) => {
          const said = names(t.schema, t.name)
          return (
            <Card
              key={t.name}
              withBorder
              radius="md"
              component={Link}
              to={place.to('/data/records', { c: t.name })}
            >
              <Group wrap="nowrap" align="start">
                <ItemMark {...said} table />
                <div>
                  <Text fw={650}>{said.name}</Text>
                  <Text fz="sm" c="dimmed" lineClamp={2}>
                    {t.comment ?? (
                      <span className="mono">
                        {t.schema}.{t.name}
                      </span>
                    )}
                  </Text>
                </div>
              </Group>
            </Card>
          )
        })}
      </SimpleGrid>
    </Page>
  )
}
