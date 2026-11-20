import { describe, expect, test } from 'bun:test'
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
import { FieldAccessTable, HoldCell } from '../src/access/collection-access.tsx'
import { FieldAccessDrawer, GrantDrawer, SchemaGrantDrawer } from '../src/access/grant-editor.tsx'
import {
  alsoHeld,
  draftOf,
  granteesOf,
  groupsOf,
  heldBy,
  holdOf,
  policyReaches,
  reachesMore,
  sameWanted,
  throughOf,
  toggleField,
  wantedOf,
} from '../src/access/model.ts'
import {
  CollectionPolicies,
  PolicyCard,
  PolicyDrawer,
  rowSecurityWords,
} from '../src/access/policies.tsx'
import { RoleLabel } from '../src/access/rights.tsx'
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

const articles: TableInfo = {
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

const names = ['id', 'title', 'status', 'internal_notes']

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

const grants: GrantInfo[] = [
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

const roles = [role('reader', false), role('writer', false), role('alice@example.com', true)]

const member = (group: string, name: string, inherit = true): MembershipInfo => ({
  role: group,
  member: name,
  admin_option: false,
  inherit_option: inherit,
  set_option: true,
})

const policy: PolicyInfo = {
  schema: 'newsroom',
  table: 'articles',
  name: 'published',
  permissive: 'PERMISSIVE',
  roles: ['reader'],
  command: 'SELECT',
  using: "(status = 'published'::text)",
  check: null,
}

const session = { catalog, phase: 'ready', identity: null, notify: () => {} } as unknown as Session

const drawn = (children: ComponentChildren) =>
  render(<SessionContext.Provider value={session}>{children}</SessionContext.Provider>)

describe('What an ACL says each role holds', () => {
  test('a privilege is held on the whole collection, on some fields, or not at all', () => {
    const reader = heldBy(grants, 'articles', 'reader')
    expect(holdOf(reader.SELECT)).toBe('some')
    expect(holdOf(reader.UPDATE)).toBe('none')
    expect(wantedOf(reader.SELECT)).toEqual(['id', 'title'])
    const writer = heldBy(grants, 'articles', 'writer')
    expect(holdOf(writer.SELECT)).toBe('all')
    expect(wantedOf(writer.DELETE)).toBe('all')
    expect(alsoHeld(writer)).toEqual(['TRUNCATE'])
  })

  test('the roles a collection names leave its owner out, and put everyone first', () => {
    expect(granteesOf(grants, 'articles', 'editors')).toEqual(['PUBLIC', 'reader', 'writer'])
  })

  test('a field given to a list is added to it, and one taken from the whole leaves the rest', () => {
    expect(toggleField(['id'], 'SELECT', 'title', true, names)).toEqual(['id', 'title'])
    expect(toggleField('none', 'UPDATE', 'title', true, names)).toEqual(['title'])
    expect(toggleField('all', 'SELECT', 'internal_notes', false, names)).toEqual([
      'id',
      'title',
      'status',
    ])
    expect(toggleField(['id'], 'SELECT', 'id', false, names)).toBe('none')
    // The whole collection already covers the field, and DELETE has no fields to speak of.
    expect(toggleField('all', 'SELECT', 'title', true, names)).toBe('all')
    expect(toggleField('all', 'DELETE', 'title', false, names)).toBe('all')
  })

  test('two wishes are the same whatever order their fields are in', () => {
    expect(sameWanted(['id', 'title'], ['title', 'id'])).toBe(true)
    expect(sameWanted(['id'], 'all')).toBe(false)
    expect(sameWanted('none', 'none')).toBe(true)
  })
})

describe('Where a role’s reach comes from', () => {
  const memberships = [
    member('reader', 'alice@example.com'),
    member('desk', 'alice@example.com', false),
    member('writer', 'reader'),
  ]

  test('a role inherits from its groups and theirs, and not through a membership without INHERIT', () => {
    expect(groupsOf('alice@example.com', memberships)).toEqual(['reader', 'writer'])
  })

  test('its reach on a collection comes through the groups the ACL names, and everyone', () => {
    expect(throughOf('alice@example.com', 'articles', grants, memberships)).toEqual([
      'reader',
      'writer',
      'PUBLIC',
    ])
    expect(throughOf('PUBLIC', 'articles', grants, memberships)).toEqual([])
  })

  test('a role reaches more than its own grants when a group gives it more', () => {
    expect(reachesMore('all', 'some')).toBe(true)
    expect(reachesMore('some', 'some')).toBe(false)
  })

  test('a policy applies by name, through a group, or to everyone', () => {
    expect(policyReaches(policy, 'reader', [])).toBe(true)
    expect(policyReaches(policy, 'alice@example.com', ['reader'])).toBe(true)
    expect(policyReaches(policy, 'writer', [])).toBe(false)
    expect(policyReaches({ ...policy, roles: ['public'] }, 'writer', [])).toBe(true)
  })
})

describe('A policy as the editor starts from it', () => {
  test('is the database’s own record, with everyone written as no role at all', () => {
    expect(draftOf(policy)).toEqual({
      schema: 'newsroom',
      table: 'articles',
      name: 'published',
      permissive: true,
      command: 'SELECT',
      roles: ['reader'],
      using: "(status = 'published'::text)",
      check: '',
    })
    expect(draftOf({ ...policy, roles: ['public'] }).roles).toEqual([])
  })

  test('row security is said as what it does to the collection', () => {
    expect(rowSecurityWords(articles, 0)).toContain('nobody but the owner')
    expect(rowSecurityWords({ ...articles, rls: false }, 2)).toContain(
      '2 policies below are not applied'
    )
    expect(rowSecurityWords({ ...articles, rls: false }, 1)).toContain(
      '1 policy below is not applied'
    )
  })
})

describe('Access as it is drawn', () => {
  test('a role is a person, a group, everyone, or a name the database only mentions', () => {
    expect(drawn(<RoleLabel name="reader" roles={roles} />)).toContain(
      'href="/access/role?r=reader"'
    )
    expect(drawn(<RoleLabel name="PUBLIC" roles={roles} />)).toContain('title="Everyone"')
    const unseen = drawn(<RoleLabel name="auditors" roles={roles} />)
    expect(unseen).not.toContain('href')
    expect(unseen).toContain('A role you may not see')
  })

  test('a half mark says how many fields it covers', () => {
    const cell = drawn(
      <table>
        <tbody>
          <tr>
            <HoldCell hold="some" privilege="SELECT" fields={['id', 'title']} of={4} />
          </tr>
        </tbody>
      </table>
    )
    expect(cell).toContain('perm-some')
    expect(cell).toContain('2/4')
    expect(cell).toContain('SELECT: on some fields (id, title)')
  })

  test('each field lists who holds it, and a withheld field lists nobody', () => {
    const html = drawn(<FieldAccessTable table={articles} grants={grants} onOpen={() => {}} />)
    const row = (name: string) => html.slice(html.indexOf(`>${name}</td>`)).split('</tr>')[0]!
    expect(row('title')).toContain('reader')
    expect(row('title')).toContain('who-role is-whole')
    // SELECT on internal_notes is the writer's alone, through the whole collection.
    const notes = row('internal_notes')
    expect(notes).not.toContain('>reader<')
    expect(notes).toContain('>writer<')
    expect(notes).toContain('owner only')
  })

  test('the grant editor starts from what the ACL holds, and changes nothing yet', () => {
    const html = drawn(
      <GrantDrawer
        schema="newsroom"
        target={{ table: 'articles', grantee: 'reader' }}
        grants={grants}
        roles={roles}
        memberships={[]}
        onClose={() => {}}
        onDone={() => {}}
      />
    )
    expect(html).toContain('2 of 4 fields')
    expect(html).toContain('Nothing changes yet')
    expect(html).not.toContain('GRANT ')
    // The fields of a narrowed privilege are listed, each with its own box.
    expect(html).toContain('aria-label="SELECT on internal_notes"')
  })

  test('an owner is granted nothing: it holds everything already', () => {
    const html = drawn(
      <GrantDrawer
        schema="newsroom"
        target={{ table: 'articles', grantee: 'editors' }}
        grants={grants}
        roles={roles}
        memberships={[]}
        onClose={() => {}}
        onDone={() => {}}
      />
    )
    expect(html).toContain('editors owns articles')
  })

  test('a field’s own drawer lists the roles the collection names', () => {
    const html = drawn(
      <FieldAccessDrawer
        schema="newsroom"
        table="articles"
        column="title"
        grants={grants}
        roles={roles}
        onClose={() => {}}
        onDone={() => {}}
      />
    )
    expect(html).toContain('aria-label="UPDATE on title for writer"')
    expect(html).toContain('whole collection')
    expect(html).toContain('aria-label="SELECT on title for PUBLIC"')
  })

  test('a role new to a workspace is offered USAGE, and shown the statement', () => {
    const html = drawn(
      <SchemaGrantDrawer
        schema="newsroom"
        target={{ grantee: 'reader' }}
        grants={[]}
        roles={roles}
        onClose={() => {}}
        onDone={() => {}}
      />
    )
    expect(html).toContain('GRANT USAGE ON SCHEMA &quot;newsroom&quot; TO &quot;reader&quot;;')
  })

  test('a policy is drawn as the database records it, and changed by being made again', () => {
    expect(
      drawn(
        <ul>
          <PolicyCard policy={policy} />
        </ul>
      )
    ).toContain("USING ((status = 'published'::text))")
    const html = drawn(
      <PolicyDrawer
        schema="newsroom"
        target={{ table: 'articles', policy }}
        roles={roles}
        onClose={() => {}}
        onDone={() => {}}
      />
    )
    expect(html).toContain(
      'DROP POLICY &quot;published&quot; ON &quot;newsroom&quot;.&quot;articles&quot;;'
    )
    expect(html).toContain('CREATE POLICY &quot;published&quot;')
    // A field with listed values offers an expression to start from.
    expect(html).toContain('Rows where status is published')
  })

  test('a collection’s row security says its state and offers its owner the change', () => {
    const html = drawn(
      <CollectionPolicies
        schema="newsroom"
        table={articles}
        policies={[policy]}
        roles={roles}
        onDone={() => {}}
      />
    )
    expect(html).toContain('Row security is on: a role reaches the rows a policy')
    expect(html).toContain('Turn off')
    expect(html).toContain('aria-label="Change published"')
    const read = drawn(
      <CollectionPolicies
        schema="newsroom"
        table={{ ...articles, can_alter: false }}
        policies={[policy]}
        roles={roles}
        onDone={() => {}}
      />
    )
    expect(read).not.toContain('Turn off')
    expect(read).not.toContain('aria-label="Change published"')
  })
})
