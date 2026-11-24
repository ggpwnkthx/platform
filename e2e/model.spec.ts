/** The model and access, changed by the administrator: every change is shown as SQL, then runs as them. */
import { change, choose, expect, go, run, signInAs, statement, test } from './support.ts'

test.describe.configure({ mode: 'serial' })

test('a field is added: the statement is shown, then runs', async ({ app }) => {
  await go(app, '/w/newsroom/articles')
  await signInAs(app, 'admin@example.com')
  await app.getByRole('button', { name: 'Add a field' }).click()
  await change(app).getByLabel('Name').fill('subtitle')
  await change(app).getByLabel('Longest').fill('80')
  expect(await statement(app)).toContain(
    'ALTER TABLE "newsroom"."articles" ADD COLUMN "subtitle" text CHECK (char_length("subtitle") <= 80);'
  )
  await run(app)
  await expect(app.getByRole('cell', { name: 'subtitle', exact: true }).first()).toBeVisible()
})

test('a field says what it is called and where it appears', async ({ app }) => {
  await app.getByRole('button', { name: 'Change subtitle' }).click()
  await change(app).getByLabel('The name people read').fill('Standfirst')
  await choose(app, 'In the records grid', 'Hidden')
  const sql = await statement(app)
  expect(sql).toContain(`'display_name', '"Standfirst"'::jsonb`)
  expect(sql).toContain('"list":"hide"')
  await run(app)
  await expect(app.getByText('Standfirst')).toBeVisible()
  await expect(app.getByText('Hidden in the records grid')).toBeVisible()
})

test('a grant is the difference between the ACL and what is asked', async ({ app }) => {
  await app.getByRole('tab', { name: 'Access' }).click()
  await app.getByRole('button', { name: 'Change newsroom_writer on articles' }).click()
  await choose(app, 'Held on', 'Not held', change(app).locator('[data-privilege=DELETE]'))
  expect((await statement(app)).trim()).toBe(
    'REVOKE DELETE ON TABLE "newsroom"."articles" FROM "newsroom_writer";'
  )
  await run(app)
})

test('a row policy is written and applies', async ({ app }) => {
  await go(app, '/w/newsroom/sections?tab=Access')
  await app.getByRole('button', { name: 'Add a row policy' }).click()
  await change(app).getByLabel('Name', { exact: true }).fill('desk_reads')
  await change(app)
    .getByLabel(/^USING/)
    .fill('desk_email IS NOT NULL')
  const sql = await statement(app)
  expect(sql).toContain(
    'CREATE POLICY "desk_reads" ON "newsroom"."sections" AS PERMISSIVE FOR ALL TO PUBLIC'
  )
  expect(sql).toContain('USING (desk_email IS NOT NULL)')
  await run(app)
  await expect(app.getByRole('cell', { name: 'desk_reads', exact: true })).toBeVisible()
})

test('PostgreSQL refuses, and the refusal is shown with its SQLSTATE', async ({ app }) => {
  await app.getByRole('button', { name: 'Add a row policy' }).click()
  await change(app).getByLabel('Name', { exact: true }).fill('broken')
  await change(app)
    .getByLabel(/^USING/)
    .fill('no_such_column = 1')
  await change(app).getByRole('button', { name: 'Run' }).click()
  await expect(change(app).locator('[data-refusal]')).toContainText('(42703)')
  await change(app).getByRole('button', { name: 'Cancel' }).click()
})

test('a new collection, with a relation and choices', async ({ app }) => {
  await go(app, '/w/newsroom')
  await app.getByRole('button', { name: 'Add a collection' }).click()
  await change(app).getByLabel('Name: a PostgreSQL table').fill('pitches')
  expect(await statement(app)).toContain(
    `SELECT platform.create_collection('newsroom', 'pitches');`
  )
  await run(app)
  await go(app, '/w/newsroom/pitches')
  await expect(app.getByRole('cell', { name: 'uuid', exact: true }).first()).toBeVisible()
  await app.getByRole('tab', { name: 'Access' }).click()
  await expect(app.getByText('On: policies decide which rows a role reaches')).toBeVisible()
  await app.getByRole('tab', { name: 'Fields' }).click()
  for (const field of ['name', 'stage', 'section']) {
    await app.getByRole('button', { name: 'Add a field' }).click()
    await change(app).getByLabel('Name').fill(field)
    if (field === 'stage') await change(app).getByLabel('One of').fill('idea, commissioned, filed')
    if (field === 'section') {
      await choose(app, 'Type', /^relation/)
      await choose(app, 'Points at', 'sections')
      expect(await statement(app)).toContain(
        'FOREIGN KEY ("section") REFERENCES "newsroom"."sections" (id) ON DELETE RESTRICT'
      )
    }
    await run(app)
  }
  await expect(app.getByText('idea · commissioned · filed')).toBeVisible()
})

test('a many-to-many is made in one step, as a table of its own', async ({ app }) => {
  await go(app, '/w/newsroom/articles')
  await app.getByRole('button', { name: 'Link to another collection' }).click()
  await choose(app, 'The other collection', 'pitches')
  const sql = await statement(app)
  expect(sql).toContain(`SELECT platform.create_collection('newsroom', 'articles_pitches');`)
  expect(sql).toContain(
    'FOREIGN KEY ("articles") REFERENCES "newsroom"."articles" (id) ON DELETE CASCADE'
  )
  expect(sql).toContain(
    'FOREIGN KEY ("pitches") REFERENCES "newsroom"."pitches" (id) ON DELETE CASCADE'
  )
  expect(sql).toContain(
    'CREATE UNIQUE INDEX ON "newsroom"."articles_pitches" ("articles", "pitches");'
  )
  await run(app)
  await expect(app.getByRole('cell', { name: 'articles_pitches', exact: true })).toBeVisible()
})
