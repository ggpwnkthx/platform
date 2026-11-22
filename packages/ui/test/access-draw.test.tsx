import { describe, expect, test } from 'bun:test'
import { HoldCell } from '../src/access/grants/marks.tsx'
import { FieldAccessTable } from '../src/access/fields/table.tsx'
import { FieldAccessDrawer } from '../src/access/fields/access.tsx'
import { GrantDrawer } from '../src/access/grants/drawer.tsx'
import { SchemaGrantDrawer } from '../src/access/grants/schema.tsx'
import { CollectionPolicies } from '../src/access/collections/policies.tsx'
import { PolicyCard } from '../src/access/policies/card.tsx'
import { PolicyDrawer } from '../src/access/policies/drawer.tsx'
import { RoleLabel } from '../src/access/rights.tsx'
import { articles, grants, roles, policy, drawn } from './access-helpers.tsx'

/**
 * Access as it is drawn: the drawers and the tables of it.
 */

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
