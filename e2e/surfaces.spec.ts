/** What the interface added beside rows and grants: renames, objects, the database, scripts and files. */
import { address, change, expect, go, run, signInAs, statement, test } from './support.ts'

test.describe.configure({ mode: 'serial' })

test('a table renamed from its page keeps its sayings and its address follows it', async ({
  app,
}) => {
  await go(app, '/schemas/newsroom/tags')
  await signInAs(app, 'admin@example.com')
  await app.getByRole('button', { name: 'Alter table' }).click()
  await change(app).getByLabel('Table name').fill('labels')
  const sql = await statement(app)
  expect(sql).toContain('DELETE FROM platform.item_metadata')
  expect(sql).toContain('ALTER TABLE "newsroom"."tags" RENAME TO "labels";')
  expect(sql).toContain('INSERT INTO platform.item_metadata')
  await run(app)
  await expect.poll(() => address(app)).toContain('/schemas/newsroom/labels')
})

test('a column is renamed and given a new type', async ({ app }) => {
  await go(app, '/schemas/newsroom/articles')
  await app.getByRole('button', { name: 'Alter word_count' }).click()
  await change(app).getByLabel('Column name').fill('words')
  await change(app).getByLabel('Data type').fill('bigint')
  const sql = await statement(app)
  expect(sql).toContain('ALTER COLUMN "word_count" TYPE bigint')
  expect(sql).toContain('RENAME COLUMN "word_count" TO "words"')
  await run(app)
  await expect(app.getByRole('cell', { name: 'words', exact: true })).toBeVisible()
})

test('a view is made in a schema, reading as its reader', async ({ app }) => {
  await go(app, '/schemas/newsroom?tab=Views')
  await app.getByRole('button', { name: 'Create view' }).click()
  await change(app).getByLabel('View name').fill('published')
  await change(app)
    .getByLabel(/^Query/)
    .fill("SELECT id, title FROM newsroom.articles WHERE status = 'published'")
  expect(await statement(app)).toContain('WITH (security_invoker = true) AS SELECT id, title')
  await run(app)
  await expect(app.locator('[data-kind=views]').getByText('invoker', { exact: true })).toBeVisible()
})

test('a script runs in one transaction, and a plan is explained', async ({ app }) => {
  await go(app, '/sql')
  await app.getByRole('switch', { name: /A script/ }).check()
  await app.getByLabel('Statement').fill('SELECT 1 AS one; SELECT 2 AS two;')
  await app.getByRole('button', { name: 'Run' }).click()
  await expect(app.locator('[data-answer]')).toContainText('2 statements ran in one transaction')
  await app.getByRole('switch', { name: /A script/ }).uncheck()
  await app.getByLabel('Statement').fill('SELECT title FROM newsroom.articles')
  await app.getByRole('button', { name: 'Explain' }).click()
  await expect(app.locator('[data-plan]')).toContainText('Scan')
})

test('the database page shows the sessions, the tables by size and the extensions', async ({
  app,
}) => {
  await go(app, '/database')
  // PostgreSQL in the page has no client sessions to list; the section says so.
  await expect(app.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await expect(app.locator('[data-kind=table-stats]').getByText('newsroom.articles')).toBeVisible()
  await expect(app.locator('[data-kind=extensions]').getByText('plpgsql')).toBeVisible()
})

test('rows are saved as a CSV file', async ({ app }) => {
  await go(app, '/newsroom.sections')
  const saved = app.waitForEvent('download')
  await app.getByRole('button', { name: 'Save as CSV' }).click()
  expect((await saved).suggestedFilename()).toBe('newsroom.sections.csv')
})
