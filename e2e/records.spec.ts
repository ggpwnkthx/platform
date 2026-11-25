/** Records, as the administrator: written under their version, searched, filtered and linked. */
import { address, expect, go, rows, signInAs, test } from './support.ts'

test.describe.configure({ mode: 'serial' })
const filtered = (filter: object) => `?filter=${encodeURIComponent(JSON.stringify(filter))}`

test('a record is written, read back, changed under its version, and logged', async ({ app }) => {
  await go(app, '/newsroom.tags/create')
  await signInAs(app, 'admin@example.com')
  await app.getByRole('textbox', { name: 'name' }).fill('Harbour')
  await app.getByRole('button', { name: 'Save' }).click()
  await app.getByRole('cell', { name: 'Harbour', exact: true }).click()
  await app.getByRole('textbox', { name: 'name' }).fill('Harbour and docks')
  await app.getByRole('button', { name: 'Save' }).click()
  await expect(app.getByText('Saved.')).toBeVisible()
  const aside = app.locator('aside')
  await expect(aside.getByText('version')).toBeVisible()
  await expect(aside.locator('p', { hasText: 'version' })).toContainText('2')
  await expect(aside.locator('[data-revision]', { hasText: 'Changed' })).toBeVisible()
})

test('search and a filter narrow the records, in the address', async ({ app }) => {
  await go(
    app,
    `/newsroom.articles${filtered({ q: 'Ward boundaries', status: { op: 'eq', value: 'published' } })}`
  )
  await expect(app.getByText('Ward boundaries: the new map, street by street')).toBeVisible()
  await expect(rows(app)).toHaveCount(1)
  await expect(app.getByText('1-1 of 1')).toBeVisible()
})

test('a record is linked to another, and the link is written', async ({ app }) => {
  await go(app, `/newsroom.articles${filtered({ q: 'Ward boundaries' })}`)
  await rows(app).first().locator('td').nth(1).click()
  await expect(app.getByRole('combobox', { name: 'Tags' })).toBeVisible()
  await app
    .getByRole('combobox', { name: 'Tags' })
    .locator('xpath=..')
    .getByRole('button', { name: 'Open' })
    .click()
  await expect(app.getByRole('option').first()).toBeVisible()
  // A tag the story does not carry yet: the ones it carries are not offered again.
  const tag = (await app.getByRole('option').first().textContent())!
  await app.getByRole('option', { name: tag, exact: true }).click()
  await app.getByRole('button', { name: 'Save' }).click()
  await expect(app.getByText('Saved.')).toBeVisible()
  await go(app, `/newsroom.article_tags${filtered({ q: 'Ward boundaries' })}`)
  await expect(app.getByRole('link', { name: tag, exact: true }).first()).toBeVisible()
})

test('the rows that point at a record are counted, and lead to them', async ({ app }) => {
  await go(app, '/newsroom.corrections')
  await rows(app).first().getByRole('link').first().click()
  await app.locator('[data-children=corrections] a').click()
  await expect(app.getByRole('heading', { name: 'Corrections' })).toBeVisible()
  expect(address(app)).toContain('/newsroom.corrections?')
  expect(address(app)).toContain('"article"')
})

test('the search follows the name of the row a record points at', async ({ app }) => {
  // 'Sport' is the name of a section and of a tag: no headline of the example says it.
  await go(app, `/newsroom.articles${filtered({ q: 'Sport' })}`)
  await expect(rows(app).first()).toBeVisible()
  await expect(app.getByRole('link', { name: 'Sport' }).first()).toBeVisible()
})

test('a filter may ask by the rows a record is linked to', async ({ app }) => {
  await go(app, '/newsroom.articles')
  await app.getByRole('button', { name: 'Add filter' }).click()
  await app.getByRole('menuitemcheckbox', { name: 'Tags' }).click()
  const condition = app.locator('[data-condition=tags]')
  await condition.getByLabel('Value').click()
  await app.getByRole('option', { name: 'Sport', exact: true }).click()
  await expect.poll(() => address(app)).toContain('"has_any"')
  // Fewer than the sixty stories there are: the condition has been asked of PostgreSQL.
  await expect(app.getByText(/^1-\d+ of (?!60$)\d+$/)).toBeVisible()
  await expect(rows(app).first()).toBeVisible()
})

test('chosen rows are deleted together, each under the version the page shows', async ({ app }) => {
  await go(app, `/newsroom.tags${filtered({ q: 'and docks' })}`)
  await expect(app.getByRole('heading', { name: 'Tags' })).toBeVisible()
  await expect(rows(app)).toHaveCount(1)
  await rows(app).first().getByRole('checkbox').check()
  await app.getByRole('button', { name: 'Delete' }).click()
  await app.getByRole('button', { name: 'Confirm' }).click()
  await expect(app.getByText('No record matches the search and its conditions.')).toBeVisible()
  await go(app, '/activity/newsroom?table=tags')
  await expect(app.getByRole('cell', { name: 'Deleted', exact: true })).toHaveCount(1)
})
