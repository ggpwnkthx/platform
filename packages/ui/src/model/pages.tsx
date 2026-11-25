import { Button } from '@mui/material'
import { collectionTarget, tableOf, workspaceTarget } from '@platform/core'
import { Columns3, Info, KeyRound, Rows3, ShieldUser, Table2 } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { grants } from '../access/grants.tsx'
import { schemaGrants } from '../access/workspace-grants.tsx'
import { policies, rowSecurity } from '../access/policies.tsx'
import { useNames } from '../kit/place.ts'
import { Empty } from '../kit/said.tsx'
import { ItemMark, iconSize } from '../kit/marks.tsx'
import { Tabbed, Tip } from '../kit/Header.tsx'
import { Page } from '../kit/Page.tsx'
import { KindChange, KindTable } from '../kit/Kinds.tsx'
import { useSession } from '../session/session.ts'
import { fields } from './fields.tsx'
import { metadata } from './metadata.tsx'
import { collections, workspaces } from './collections.tsx'
import { constraints } from './constraints.tsx'
import { links } from './links.tsx'

/** A workspace: its collections, who may use it, and what it says of itself. */
export function WorkspaceModel() {
  const { ws = '' } = useParams()
  const { catalog } = useSession()
  const names = useNames()
  const navigate = useNavigate()
  if (ws === '+')
    return (
      <KindChange
        kind={workspaces}
        where={{}}
        open={{ action: 'create' }}
        onClose={() => navigate(-1)}
      />
    )
  const schema = catalog.schemas.find((s) => s.name === ws)
  if (!schema) return <Navigate to="/" replace />
  const said = names(ws)
  const where = { schema: ws }
  return (
    <Page
      title={said.name}
      crumb={schema.kind === 'system' ? 'System workspace' : 'Workspace'}
      mark={<ItemMark {...said} />}
    >
      <Tabbed
        icons={{
          Collections: <Table2 size={iconSize} />,
          Access: <ShieldUser size={iconSize} />,
          Metadata: <Info size={iconSize} />,
        }}
        tabs={{
          Collections: <KindTable kind={collections} where={where} lead />,
          Access: (
            <>
              <KindTable kind={schemaGrants} where={where} />
              <KindTable kind={policies} where={where} />
            </>
          ),
          Metadata: <KindTable kind={metadata} where={workspaceTarget(ws)} />,
        }}
      />
    </Page>
  )
}

/** A collection's model: its fields, its keys and rules, its row security, and who holds what on it. */
export function CollectionModel() {
  const { ws = '', table = '' } = useParams()
  const { catalog } = useSession()
  const names = useNames()
  const info = tableOf(catalog, ws, table)
  if (!info)
    return (
      <Page title={table}>
        <Empty>No such collection that you may reach.</Empty>
      </Page>
    )
  const said = names(ws, table)
  const where = { schema: ws, table }
  return (
    <Page
      title={said.name}
      crumb={<Link to={`/w/${ws}`}>{names(ws).name}</Link>}
      mark={<ItemMark {...said} table />}
      actions={
        <Tip title="Records">
          <Button
            component={Link}
            to={`/${ws}.${table}`}
            variant="outlined"
            aria-label="Records"
            startIcon={<Rows3 size={iconSize} />}
          >
            Records
          </Button>
        </Tip>
      }
    >
      <Tabbed
        icons={{
          Fields: <Columns3 size={iconSize} />,
          'Keys and rules': <KeyRound size={iconSize} />,
          Access: <ShieldUser size={iconSize} />,
          Metadata: <Info size={iconSize} />,
        }}
        tabs={{
          Fields: (
            <>
              <KindTable kind={fields} where={where} lead />
              <KindTable kind={links} where={where} />
            </>
          ),
          'Keys and rules': <KindTable kind={constraints} where={where} />,
          Access: (
            <>
              <KindTable kind={rowSecurity} where={where} />
              <KindTable kind={policies} where={where} />
              <KindTable kind={grants} where={where} />
            </>
          ),
          Metadata: <KindTable kind={metadata} where={collectionTarget(ws, table)} />,
        }}
      />
    </Page>
  )
}
