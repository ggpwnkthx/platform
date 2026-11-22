import type { ComponentChildren } from 'preact'
import { render } from 'preact-render-to-string'
import type {
  Catalog,
  ColumnInfo,
  GrantInfo,
  MembershipInfo,
  PolicyInfo,
  RoleInfo,
  TableInfo,
} from '@platform/data'
import { type Session, SessionContext } from '../src/session.tsx'

/**
 * Access is read from the database's ACLs and drawn the same way wherever it appears: from a
 * role, from a workspace, from a collection and from a field. What is tested here is the
 * reading — an ACL turned into what each role holds — and that each editor draws what the
 * ACL says before anything is changed.
 */

const column = (name: string): ColumnInfo => ({
  schema: 'newsroom',
  table: 'articles',
  name,
  position: 1,
  type: 'text',
  required: false,
  default: null,
  comment: null,
  generated: null,
  identity: null,
  can_select: true,
  can_insert: true,
  can_update: true,
})

export const articles: TableInfo = {
  schema: 'newsroom',
  name: 'articles',
  kind: 'r',
  rls: true,
  force_rls: false,
  owner: 'editors',
  comment: null,
  system: false,
  can_select: true,
  can_insert: true,
  can_update: true,
  can_delete: true,
  can_truncate: true,
  can_alter: true,
}

export const names = ['id', 'title', 'status', 'internal_notes']

const catalog: Catalog = {
  schemas: [
    { name: 'newsroom', owner: 'editors', kind: 'user', can_create: true, can_alter: true },
  ],
  tables: [articles],
  columns: names.map(column),
  relations: [],
  constraints: [
    {
      schema: 'newsroom',
      table: 'articles',
      name: 'articles_status_check',
      type: 'c',
      definition: "CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))",
      columns: ['status'],
    },
  ],
  types: [],
}

const grant = (grantee: string, privilege: string, field: string | null = null): GrantInfo => ({
  schema: 'newsroom',
  table: 'articles',
  column: field,
  grantee,
  privilege,
  grantor: 'editors',
  grantable: false,
})

export const grants: GrantInfo[] = [
  grant('editors', 'SELECT'),
  grant('reader', 'SELECT', 'id'),
  grant('reader', 'SELECT', 'title'),
  grant('writer', 'SELECT'),
  grant('writer', 'UPDATE', 'title'),
  grant('writer', 'DELETE'),
  grant('writer', 'TRUNCATE'),
  grant('PUBLIC', 'SELECT', 'id'),
]

const role = (name: string, login: boolean): RoleInfo => ({
  name,
  login,
  inherit: true,
  create_role: false,
  bypass_rls: false,
  superuser: false,
  admits: true,
})

export const roles = [role('reader', false), role('writer', false), role('alice@example.com', true)]

export const member = (group: string, name: string, inherit = true): MembershipInfo => ({
  role: group,
  member: name,
  admin_option: false,
  inherit_option: inherit,
  set_option: true,
})

export const policy: PolicyInfo = {
  schema: 'newsroom',
  table: 'articles',
  name: 'published',
  permissive: 'PERMISSIVE',
  roles: ['reader'],
  command: 'SELECT',
  using: "(status = 'published'::text)",
  check: null,
}

const session = {
  catalog,
  phase: 'ready',
  identity: null,
  notify: () => {},
} as unknown as Session

export const drawn = (children: ComponentChildren) =>
  render(<SessionContext.Provider value={session}>{children}</SessionContext.Provider>)
