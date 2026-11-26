/** A reader who owns nothing: alice is held to her grants and to the row policies, by PostgreSQL. */
import { expect, go, rows, signInAs, test } from './support.ts'

test.describe.configure({ mode: 'serial' })
const filtered = (filter: object) => `?filter=${encodeURIComponent(JSON.stringify(filter))}`

test('alice is held to her grants and the policies', async ({ app }) => {
  await go(app, '/newsroom.articles')
  await signInAs(app, 'alice@example.com')
  // She reads the published stories and her own: the policies decide, and the count says so.
  await go(app, '/newsroom.articles')
  await expect(app.getByText('1-25 of 48')).toBeVisible()
  await expect(app.getByRole('columnheader', { name: 'Legal flags' })).toHaveCount(0)
  // She owns nothing: no change to the model is offered, and PostgreSQL would refuse one.
  await go(app, '/schemas/newsroom/articles')
  await expect(app.getByRole('cell', { name: 'status', exact: true }).first()).toBeVisible()
  await expect(app.getByRole('button', { name: 'Create column' })).toHaveCount(0)
  await go(app, '/sql')
  await app.getByLabel('Statement').fill('SELECT internal_notes FROM newsroom.articles')
  await app.getByRole('button', { name: 'Run' }).click()
  await expect(app.locator('[data-refusal]')).toContainText(
    'permission denied for table articles (42501)'
  )
  await app.getByLabel('Statement').fill('SELECT 1; SELECT 2')
  await app.getByRole('button', { name: 'Run' }).click()
  await expect(app.locator('[data-refusal]')).toContainText('(42601)')
  await go(app, '/activity/newsroom')
  await expect(app.getByText('No revision that you may read')).toBeVisible()
})

test('what PostgreSQL only warns of is said, and her session stays hers', async ({ app }) => {
  await go(app, '/sql')
  const ask = async (statement: string) => {
    await app.getByLabel('Statement').fill(statement)
    await app.getByLabel('Statement').press('Control+Enter')
  }
  // She holds SELECT on articles with no GRANT OPTION: the GRANT runs, and changes nothing.
  await ask('GRANT SELECT ON newsroom.sections TO "bob@example.com"')
  await expect(app.locator('[data-notice]')).toContainText(
    'PostgreSQL warned: no privileges were granted for "sections" (01007)'
  )
  // In the dev mode the page is the identity provider: nobody talks their way into another role.
  await ask('SET SESSION AUTHORIZATION "admin@example.com"')
  await expect(app.locator('[data-refusal]')).toContainText('(42501)')
  await ask('SET ROLE newsroom_reader')
  await ask('SELECT session_user = current_user AS mine')
  await expect(app.getByRole('cell', { name: 'true' })).toBeVisible()
})

test('on a narrow screen the pane is behind a menu button', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 800 })
  await go(app, '/newsroom.articles')
  await expect(app.getByRole('navigation', { name: 'Schema' })).toBeHidden()
  await app.getByRole('button', { name: 'Menu' }).click()
  await app.getByRole('navigation', { name: 'Schema' }).getByText('Sections').click()
  await expect(app.getByRole('heading', { name: 'Sections' })).toBeVisible()
  await expect(app.getByRole('navigation', { name: 'Schema' })).toBeHidden()
  await app.setViewportSize({ width: 1440, height: 900 })
})

test('a write PostgreSQL refuses is shown as it refused it', async ({ app }) => {
  // A story of her own: its headline is hers to change, its publication date is not offered.
  await go(
    app,
    `/newsroom.articles${filtered({ created_by: { op: 'eq', value: 'alice@example.com' }, status: { op: 'eq', value: 'draft' } })}`
  )
  await rows(app).first().locator('td').nth(1).click()
  await expect(app.locator('[data-locked=published_at]')).toBeVisible()
  await app.getByLabel('word_count').fill('-5')
  await app.getByRole('button', { name: 'Update' }).click()
  await expect(app.locator('[data-refusal]')).toContainText('(23514)')
})
