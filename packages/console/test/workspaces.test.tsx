import { describe, expect, test } from 'bun:test'
import { WorkspaceForm } from '../src/app/components/workspace-form'

/**
 * The form of a workspace, as the console draws it.
 *
 * The form names a workspace of the tenant: its slug — the name it is
 * known by inside the tenant, and the name that never changes — and the
 * name the people read.
 */

describe('the form of a workspace', () => {
  test('it asks for the slug and the name of the workspace', async () => {
    const html = String(await (<WorkspaceForm action="/workspaces/new" />).toString())
    expect(html).toContain('name="slug"')
    expect(html).toContain('name="displayName"')
    expect(html).toContain('Create the workspace')
  })

  test('the slug is the name the registry accepts', async () => {
    const html = String(await (<WorkspaceForm action="/workspaces/new" />).toString())
    expect(html).toContain('[a-z][a-z0-9_-]{0,62}')
    expect(html).toContain('it never changes')
  })
})
