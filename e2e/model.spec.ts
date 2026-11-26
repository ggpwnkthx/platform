/** The model and access, changed by the administrator: every change is shown as SQL, then runs as them. */
import { change, choose, expect, go, run, signInAs, statement, test } from './support.ts'

test.describe.configure({ mode: 'serial' })

test('a column is added: the statement is shown, then runs', async ({ app }) => {
  await go(app, '/schemas/newsroom/articles')
  await signInAs(app, 'admin@example.com')
  await app.getByRole('button', { name: 'Create column' }).click()
  await change(app).getByLabel('Name').fill('subtitle')
  await change(app).getByLabel('CHECK char_length <=').fill('80')
  expect(await statement(app)).toContain(
    'ALTER TABLE "newsroom"."articles" ADD COLUMN "subtitle" text CHECK (char_length("subtitle") <= 80);'
  )
  await run(app)
  await expect(app.getByRole('cell', { name: 'subtitle', exact: true }).first()).toBeVisible()
})

test('a column says what it is called and where it appears', async ({ app }) => {
  await app.getByRole('button', { name: 'Alter subtitle' }).click()
  await change(app).getByLabel('display_name').fill('Standfirst')
  await choose(app, 'In the grid', 'Hidden')
  const sql = await statement(app)
  expect(sql).toContain(`'display_name', '"Standfirst"'::jsonb`)
  expect(sql).toContain('"list":"hide"')
  await run(app)
  await expect(app.getByText('Standfirst')).toBeVisible()
  await expect(app.getByText('Hidden in the grid')).toBeVisible()
})

test('a grant is the difference between the ACL and what is asked', async ({ app }) => {
  await app.getByRole('button', { name: 'Privileges', exact: true }).click()
  await app.getByRole('button', { name: 'Grant or revoke newsroom_writer on articles' }).click()
  await choose(app, 'Held on', 'Not held', change(app).locator('[data-privilege=DELETE]'))
  expect((await statement(app)).trim()).toBe(
    'REVOKE DELETE ON TABLE "newsroom"."articles" FROM "newsroom_writer";'
  )
  await run(app)
})

test('a row policy is written and applies', async ({ app }) => {
  await go(app, '/schemas/newsroom/sections?tab=Privileges')
  await app.getByRole('button', { name: 'Create policy' }).click()
  await change(app).getByLabel('Name', { exact: true }).fill('desk_reads')
  await change(app).getByLabel('USING', { exact: true }).fill('desk_email IS NOT NULL')
  const sql = await statement(app)
  expect(sql).toContain(
    'CREATE POLICY "desk_reads" ON "newsroom"."sections" AS PERMISSIVE FOR ALL TO PUBLIC'
  )
  expect(sql).toContain('USING (desk_email IS NOT NULL)')
  await run(app)
  await expect(app.getByRole('cell', { name: 'desk_reads', exact: true })).toBeVisible()
})

test('PostgreSQL refuses, and the refusal is shown with its SQLSTATE', async ({ app }) => {
  await app.getByRole('button', { name: 'Create policy' }).click()
  await change(app).getByLabel('Name', { exact: true }).fill('broken')
  await change(app).getByLabel('USING', { exact: true }).fill('no_such_column = 1')
  await change(app).getByRole('button', { name: 'Run' }).click()
  await expect(change(app).locator('[data-refusal]')).toContainText('(42703)')
  await change(app).getByRole('button', { name: 'Cancel' }).click()
})

test('a new table, with a relation and choices', async ({ app }) => {
  await go(app, '/schemas/newsroom')
  await app.getByRole('button', { name: 'Create table' }).click()
  await change(app).getByLabel('Table name').fill('pitches')
  expect(await statement(app)).toContain(`SELECT platform.create_table('newsroom', 'pitches');`)
  await run(app)
  await go(app, '/schemas/newsroom/pitches')
  await expect(app.getByRole('cell', { name: 'uuid', exact: true }).first()).toBeVisible()
  await app.getByRole('button', { name: 'Privileges', exact: true }).click()
  await expect(app.getByText('Enabled: policies decide which rows a role reaches')).toBeVisible()
  await app.getByRole('button', { name: 'Columns', exact: true }).click()
  for (const column of ['name', 'stage', 'section']) {
    await app.getByRole('button', { name: 'Create column' }).click()
    await change(app).getByLabel('Name').fill(column)
    if (column === 'stage')
      await change(app).getByLabel('CHECK IN', { exact: false }).fill('idea, commissioned, filed')
    if (column === 'section') {
      await choose(app, 'Type', /\(foreign key\)/)
      await choose(app, 'REFERENCES', 'sections')
      expect(await statement(app)).toContain(
        'FOREIGN KEY ("section") REFERENCES "newsroom"."sections" (id) ON DELETE RESTRICT'
      )
    }
    await run(app)
  }
  await expect(app.getByText('idea · commissioned · filed')).toBeVisible()
})

test('a many-to-many is made in one step, as a table of its own', async ({ app }) => {
  await go(app, '/schemas/newsroom/articles')
  await app.getByRole('button', { name: 'Create join table' }).click()
  await choose(app, 'Referenced table', 'pitches')
  const sql = await statement(app)
  expect(sql).toContain(`SELECT platform.create_table('newsroom', 'articles_pitches');`)
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
