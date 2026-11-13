/**
 * The grid of the roles of a tenant against its permissions.
 *
 * A cell says how a role holds a permission: itself, through a role it
 * includes, or not at all. A grid that comes back is read as what the
 * operator changed, and the change is applied to what the role holds
 * when it is written.
 */

import { describe, expect, test } from 'bun:test'
import type { Role } from '../src/domains/access'
import { matrixChangesOf, matrixOf } from '../src/domains/operators'

const role = (key: string, permissions: string[], roles: string[] = []): Role => ({
  id: `r-${key}`,
  tenant: 'acme',
  key,
  displayName: null,
  description: null,
  permissions,
  roles,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const roles = [
  role('reader', ['content.read']),
  role('editor', ['content.write', 'content.read'], ['reader']),
  role('publisher', ['content.publish'], ['editor']),
]

describe('the grid of the roles', () => {
  test('the rows are the permissions, gathered by family', () => {
    const grid = matrixOf(roles, ['content.write', 'console.status', 'content.read', 'superuser'])
    expect(grid.map((family) => [family.family, family.rows.map((row) => row.permission)])).toEqual(
      [
        ['console', ['console.status']],
        ['content', ['content.read', 'content.write']],
        ['superuser', ['superuser']],
      ]
    )
  })

  test('a cell says whether the role holds the permission itself, or through another', () => {
    const [content] = matrixOf(roles, ['content.read', 'content.write', 'content.publish'])
    const read = content!.rows.find((row) => row.permission === 'content.read')!
    expect(read.cells.reader).toEqual({ own: true, through: [] })
    // The editors hold it themselves and through the readers: both are said.
    expect(read.cells.editor).toEqual({ own: true, through: [['reader']] })
    expect(read.cells.publisher).toEqual({
      own: false,
      through: [['editor'], ['editor', 'reader']],
    })
    const publish = content!.rows.find((row) => row.permission === 'content.publish')!
    expect(publish.cells.reader).toEqual({ own: false, through: [] })
    expect(publish.cells.publisher?.own).toBe(true)
  })
})

describe('the changes of a grid', () => {
  test('a cell that was ticked is added, a cell that was cleared is removed', () => {
    const changes = matrixChangesOf(roles, {
      reader: { shown: ['content.read'], ticked: ['content.read', 'content.export'] },
      editor: { shown: ['content.read', 'content.write'], ticked: ['content.write'] },
      publisher: { shown: ['content.publish'], ticked: ['content.publish'] },
    })
    expect(
      changes.map((change) => [change.role.key, change.added, change.removed, change.permissions])
    ).toEqual([
      ['reader', ['content.export'], [], ['content.export', 'content.read']],
      ['editor', [], ['content.read'], ['content.write']],
    ])
  })

  test('a permission the grid never showed is not taken away', () => {
    // Another operator gave the readers a permission after the grid was
    // drawn: the grid changes the cells its reader touched, and nothing
    // else.
    const now = [role('reader', ['content.read', 'content.comment'])]
    const changes = matrixChangesOf(now, {
      reader: { shown: ['content.read'], ticked: ['content.read', 'content.export'] },
    })
    expect(changes[0]?.permissions).toEqual(['content.comment', 'content.export', 'content.read'])
  })

  test('a change that is already what the role holds writes nothing', () => {
    const now = [role('reader', ['content.read', 'content.export'])]
    expect(
      matrixChangesOf(now, {
        reader: { shown: ['content.read'], ticked: ['content.read', 'content.export'] },
      })
    ).toEqual([])
    expect(
      matrixChangesOf(now, {
        reader: { shown: ['content.gone'], ticked: [] },
        nobody: { shown: [], ticked: ['x'] },
      })
    ).toEqual([])
  })
})
