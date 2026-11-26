import { Button } from '@mui/material'
import { tableTarget, tableOf, schemaTarget } from '@platform/core'
import {
  Columns3,
  Eye,
  Info,
  KeyRound,
  Rows3,
  Shapes,
  ShieldUser,
  SquareFunction,
  Table2,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { grants } from '../access/grants.tsx'
import { schemaGrants } from '../access/schema-grants.tsx'
import { defaultGrants } from '../access/default-grants.tsx'
import { objectGrants } from '../access/object-grants.tsx'
import { policies, rowSecurity } from '../access/policies.tsx'
import { useNames } from '../kit/place.ts'
import { Empty } from '../kit/said.tsx'
import { ItemMark, iconSize } from '../kit/marks.tsx'
import { Tabbed, Tip } from '../kit/Header.tsx'
import { Page } from '../kit/Page.tsx'
import { KindChange, KindTable } from '../kit/Kinds.tsx'
import { useSession } from '../session/session.ts'
import { columns } from './columns.tsx'
import { metadata } from './metadata.tsx'
import { tables } from './tables.tsx'
import { schemas } from './schemas.tsx'
import { ItemActions } from './item-actions.tsx'
import { constraints } from './constraints.tsx'
import { links } from './links.tsx'
import { views } from './views.tsx'
import { routines } from './routines.tsx'
import { sequences } from './sequences.tsx'
import { triggers } from './triggers.tsx'
import { types } from './types.tsx'

/** A schema: its tables, who may use it, and what it says of itself. */
export function SchemaModel() {
  const { schema = '' } = useParams()
  const { catalog } = useSession()
  const names = useNames()
  const navigate = useNavigate()
  if (schema === '+')
    return (
      <KindChange
        kind={schemas}
        where={{}}
        open={{ action: 'create' }}
        onClose={() => navigate(-1)}
      />
    )
  const info = catalog.schemas.find((s) => s.name === schema)
  if (!info) return <Navigate to="/" replace />
  const said = names(schema)
  const where = { schema }
  return (
    <Page
      title={said.name}
      crumb={info.kind === 'system' ? 'System schema' : 'Schema'}
      mark={<ItemMark {...said} />}
      actions={
        <ItemActions
          kind={schemas}
          where={{}}
          name={schema}
          noun="schema"
          onRan={(form, action) =>
            navigate(action === 'remove' ? '/' : `/schemas/${String(form.name)}`, { replace: true })
          }
        />
      }
    >
      <Tabbed
        icons={{
          Tables: <Table2 size={iconSize} />,
          Views: <Eye size={iconSize} />,
          Functions: <SquareFunction size={iconSize} />,
          Types: <Shapes size={iconSize} />,
          Privileges: <ShieldUser size={iconSize} />,
          Metadata: <Info size={iconSize} />,
        }}
        tabs={{
          Tables: <KindTable kind={tables} where={where} lead />,
          Views: <KindTable kind={views} where={where} />,
          Functions: <KindTable kind={routines} where={where} />,
          Types: (
            <>
              <KindTable kind={types} where={where} />
              <KindTable kind={sequences} where={where} />
            </>
          ),
          Privileges: (
            <>
              <KindTable kind={schemaGrants} where={where} />
              <KindTable kind={defaultGrants} where={where} />
              <KindTable kind={objectGrants} where={where} />
              <KindTable kind={policies} where={where} />
            </>
          ),
          Metadata: <KindTable kind={metadata} where={schemaTarget(schema)} />,
        }}
      />
    </Page>
  )
}

/** A table's model: its columns, its keys and rules, its row security, and who holds what on it. */
export function TableModel() {
  const { schema = '', table = '' } = useParams()
  const { catalog } = useSession()
  const navigate = useNavigate()
  const names = useNames()
  const info = tableOf(catalog, schema, table)
  if (!info)
    return (
      <Page title={table}>
        <Empty>No such table that you may reach.</Empty>
      </Page>
    )
  const said = names(schema, table)
  const where = { schema, table }
  return (
    <Page
      title={said.name}
      crumb={<Link to={`/schemas/${schema}`}>{names(schema).name}</Link>}
      mark={<ItemMark {...said} table />}
      actions={
        <>
          <ItemActions
            kind={tables}
            where={{ schema }}
            name={table}
            noun="table"
            onRan={(form, action) =>
              navigate(
                action === 'remove'
                  ? `/schemas/${schema}`
                  : `/schemas/${schema}/${String(form.name)}`,
                {
                  replace: true,
                }
              )
            }
          />
          <Tip title="Rows">
            <Button
              component={Link}
              to={`/${schema}.${table}`}
              variant="outlined"
              aria-label="Rows"
              startIcon={<Rows3 size={iconSize} />}
            >
              Rows
            </Button>
          </Tip>
        </>
      }
    >
      <Tabbed
        icons={{
          Columns: <Columns3 size={iconSize} />,
          'Constraints and indexes': <KeyRound size={iconSize} />,
          Privileges: <ShieldUser size={iconSize} />,
          Metadata: <Info size={iconSize} />,
        }}
        tabs={{
          Columns: (
            <>
              <KindTable kind={columns} where={where} lead />
              <KindTable kind={links} where={where} />
            </>
          ),
          'Constraints and indexes': (
            <>
              <KindTable kind={constraints} where={where} />
              <KindTable kind={triggers} where={where} />
            </>
          ),
          Privileges: (
            <>
              <KindTable kind={rowSecurity} where={where} />
              <KindTable kind={policies} where={where} />
              <KindTable kind={grants} where={where} />
            </>
          ),
          Metadata: <KindTable kind={metadata} where={tableTarget(schema, table)} />,
        }}
      />
    </Page>
  )
}
