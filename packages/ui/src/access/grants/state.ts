import { useState } from 'preact/hooks'
import { type GrantInfo, type MembershipInfo, columnsOf, tableOf, tablesIn } from '@platform/data'
import { useSession } from '../../session.tsx'
import { useEdits } from './edits.ts'
import { useReach } from './reach.ts'
import { changeStatements, grantStatements } from './statements.ts'
import type { GrantTarget } from './target.tsx'
import { drawn, heldBy, holdOf, others } from '../model.ts'
import { named } from '../names.ts'

/**
 * What the grant editor knows: the role, the collection, and the privileges the database
 * holds for it. The statements that change it are worked out here, and the problem the
 * database would have with them is caught here, before the reader is asked to run them.
 */
export function useGrantEditor({
  open,
  schema,
  target,
  grants,
  memberships,
}: {
  open: boolean
  schema: string
  target: GrantTarget
  grants: GrantInfo[]
  memberships: MembershipInfo[]
}) {
  const { catalog } = useSession()
  const owned = tablesIn(catalog, schema).filter((t) => t.can_alter)
  const [table, setTable] = useState(target.table ?? owned[0]?.name ?? '')
  const [typed, setTyped] = useState(target.grantee ?? '')
  const [option, setOption] = useState(false)
  const [withUsage, setWithUsage] = useState(true)
  const grantee = named(typed)
  const info = tableOf(catalog, schema, table)
  const workspace = catalog.schemas.find((s) => s.name === schema)
  const columns = columnsOf(catalog, schema, table).map((c) => c.name)
  const held = heldBy(grants, table, grantee)
  const { edits, setEdits, wanted, set, choose } = useEdits(held, columns)
  const [more, setMore] = useState(() => others.some((p) => holdOf(held[p]) !== 'none'))
  const privileges = more ? [...drawn, ...others] : [...drawn]
  // The database's own answer for the role: what it reaches through its groups and PUBLIC, and
  // whether it may use the workspace at all.
  const { reach, givers } = useReach({ open, schema, table, grantee, grants, memberships })
  const isOwner = info?.owner === grantee
  const listed = privileges.filter((p) => Array.isArray(wanted(p)))
  const change = changeStatements({ schema, table, grantee, held, edits, option, isOwner })
  const grantsSomething = change.statements.some((statement) => statement.startsWith('GRANT'))
  const holdsSomething = [...drawn, ...others].some((p) => wanted(p) !== 'none')
  // A grant on a collection is of no use to a role that may not use the workspace it is in.
  const lacksUsage = Boolean(reach && !reach.usage && holdsSomething)
  const mayGrantUsage = Boolean(workspace?.can_alter)
  const statements = grantStatements({
    change,
    grantee,
    lacksUsage,
    mayGrantUsage,
    schema,
    withUsage,
  })
  const problem = change.problem
  return {
    columns,
    choose,
    givers,
    grantee,
    grantsSomething,
    held,
    info,
    isOwner,
    lacksUsage,
    listed,
    mayGrantUsage,
    more,
    option,
    owned,
    privileges,
    problem,
    reach,
    schema,
    set,
    setEdits,
    setMore,
    setOption,
    setTable,
    setTyped,
    setWithUsage,
    statements,
    table,
    typed,
    wanted,
    withUsage,
    workspace,
  }
}

/** What the grant editor knows: everything the editor holds, in one piece. */
export type GrantState = ReturnType<typeof useGrantEditor>
