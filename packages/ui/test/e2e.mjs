/**
 * The interface, driven in a real browser against the newsroom example with PostgreSQL in the
 * page: every change is checked twice, as the statement shown and as what the database then
 * says. Run it with `bun run test:e2e`; it needs Chrome (or `npx playwright install chromium`).
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const port = 5179
const options = (env = {}) => ({ cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' })
const build = (args, env) => {
  const done = spawnSync('bun', ['packages/cli/src/cli.ts', 'ui', 'build', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  if (done.status !== 0) console.log('BUILD FAILED', done.stderr, done.stdout)
  return done
}
const start = (args, env) => spawn('bun', args, options(env))
const serve = () =>
  start([
    'packages/cli/src/cli.ts',
    'ui',
    'serve',
    '--dir=examples/newsroom/.dist',
    `--port=${port}`,
  ])
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Stops a server and waits for it to let its port go: the next one wants it. */
const stop = async (proc) => {
  if (!proc) return
  proc.kill()
  await Promise.race([new Promise((resolve) => proc.on('exit', resolve)), settle(4000)])
}
/** Waits until nothing answers on a port: the server that held it has let it go. */
const released = async (port) => {
  for (let at = 0; at < 50; at++) {
    try {
      await fetch(`http://localhost:${port}/`)
    } catch {
      return true
    }
    await settle(200)
  }
  return false
}

// The dev mode: the example, with PostgreSQL in the page.
build(['--dir=examples/newsroom'])
let server = serve()
await settle(1500)
const browser = await chromium
  .launch({ channel: 'chrome', args: ['--no-sandbox'] })
  .catch(() => chromium.launch())
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
let failed = 0
page.on(
  'console',
  (message) => message.type() === 'error' && errors.push(message.text().slice(0, 200))
)
page.on('pageerror', (error) => errors.push(String(error).slice(0, 400)))
const go = (path) => page.goto(`http://localhost:${port}${path}`)
const check = async (name, work) => {
  try {
    await work()
    console.log('ok  ', name)
  } catch (error) {
    failed++
    console.log('FAIL', name, String(error).split('\n')[0])
    console.log(
      '  page:',
      (
        await page
          .locator('body')
          .textContent()
          .catch(() => '')
      )
        .slice(0, 700)
        .replace(/\n+/g, ' | ')
    )
    console.log('  url:', page.url())
  }
}
const statement = async () => (await page.locator('.statement pre').first().textContent()) ?? ''
const statements = async () => await page.locator('.statement pre').allTextContents()
const expectText = (text, timeout = 15000) => page.getByText(text).first().waitFor({ timeout })
const dialog = () => page.getByRole('dialog')

await go('/data/model/collection?ws=newsroom&c=articles')
await page.getByText('admin@example.com').first().click()
await expectText('Appears in', 90000)

await check('add a field: the statement is shown, then runs', async () => {
  await page.getByRole('button', { name: 'Add field' }).click()
  await dialog().getByLabel('Name').fill('subtitle')
  await dialog().getByLabel('Longest').fill('80')
  const sql = await statement()
  if (
    !sql.includes(
      'ALTER TABLE "newsroom"."articles" ADD COLUMN "subtitle" text CHECK (char_length("subtitle") <= 80);'
    )
  )
    throw new Error('statement: ' + sql)
  await dialog().getByRole('button', { name: 'Run' }).click()
  await page.getByRole('cell', { name: 'subtitle' }).first().waitFor({ timeout: 15000 })
})
await check('a field says how it is drawn and where it appears', async () => {
  await page.getByRole('button', { name: 'What subtitle says of itself' }).click()
  await dialog().getByLabel('Display name').fill('Standfirst')
  await dialog().getByText('Hidden').first().click()
  const sql = await statement()
  if (!sql.includes(`'display_name', '"Standfirst"'::jsonb`) || !sql.includes('"list":"hide"'))
    throw new Error('statement: ' + sql)
  await dialog().getByRole('button', { name: 'Run' }).click()
  await expectText('Standfirst')
})
await check('a grant is the difference between the ACL and what is asked', async () => {
  await go('/data/model/collection?ws=newsroom&c=articles&tab=access')
  await expectText('Granted by name')
  await page
    .getByRole('row', { name: /newsroom_writer/ })
    .first()
    .getByRole('button', { name: 'Change this grant' })
    .click()
  await dialog().getByText('DELETE').waitFor()
  const group = dialog()
    .locator('div')
    .filter({ hasText: /^DELETENot heldWhole collection$/ })
    .first()
  await group.getByText('Not held').click()
  const sql = await statement()
  if (sql.trim() !== 'REVOKE DELETE ON TABLE "newsroom"."articles" FROM "newsroom_writer";')
    throw new Error('statement: ' + sql)
  await dialog().getByRole('button', { name: 'Run' }).click()
  await dialog().waitFor({ state: 'hidden', timeout: 15000 })
})
await check('a row policy is written and applies', async () => {
  await go('/data/model/collection?ws=newsroom&c=sections&tab=access')
  await expectText('Granted by name')
  await page.getByRole('button', { name: 'New policy' }).first().click()
  await dialog().getByLabel('Name').fill('desk_reads')
  await dialog().getByLabel('USING').fill('desk_email IS NOT NULL')
  const sql = await statement()
  if (
    !sql.includes(
      'CREATE POLICY "desk_reads" ON "newsroom"."sections" AS PERMISSIVE FOR ALL TO PUBLIC'
    ) ||
    !sql.includes('USING (desk_email IS NOT NULL)')
  )
    throw new Error('statement: ' + sql)
  await dialog().getByRole('button', { name: 'Run' }).click()
  await expectText('desk_reads')
})
await check('PostgreSQL refuses, and the refusal is shown with its SQLSTATE', async () => {
  await page.getByRole('button', { name: 'New policy' }).first().click()
  await dialog().getByLabel('Name').fill('broken')
  await dialog().getByLabel('USING').fill('no_such_column = 1')
  await dialog().getByRole('button', { name: 'Run' }).click()
  await expectText('(42703)')
  await page.keyboard.press('Escape')
})
await check('a new collection with a relation and choices', async () => {
  await go('/data/model/new?ws=newsroom')
  await expectText('What it is for')
  await page.getByLabel('Name').first().fill('pitches')
  const sql = await statement()
  if (!sql.startsWith(`SELECT platform.create_collection('newsroom', 'pitches');`))
    throw new Error('statement: ' + sql)
  await page.getByRole('button', { name: 'Create' }).click()
  await expectText('Appears in')
  await page.getByRole('cell', { name: 'uuid' }).first().waitFor()
})
await check('a record is written, read back, changed under its version, and logged', async () => {
  await go('/data/item?ws=newsroom&c=pitches')
  await page.getByLabel('name').first().fill('A profile of the harbour master')
  await page.getByRole('button', { name: 'Save' }).click()
  await expectText('A profile of the harbour master')
  await page.getByText('A profile of the harbour master').first().click()
  await page.getByLabel('name').first().waitFor()
  await page.getByLabel('name').first().fill('A profile of the harbour pilot')
  await page.getByRole('button', { name: 'Save' }).click()
  await expectText('Saved.')
  await page.getByRole('cell', { name: '2', exact: true }).first().waitFor({ timeout: 10000 })
  await expectText('UPDATE by')
})
await check('search and a filter narrow the records, in the address', async () => {
  await go('/data/records?ws=newsroom&c=articles&q=Ward+boundaries&f.status=eq.published')
  await expectText('Ward boundaries: the new map, street by street')
  const rows = await page.locator('tbody tr').count()
  if (rows !== 1) throw new Error('rows: ' + rows)
  await expectText('1–1 of 1')
})
await check('a many-to-many is made in one step, as a table of its own', async () => {
  await go('/data/model/collection?ws=newsroom&c=articles')
  await page.getByRole('button', { name: 'Many to many' }).click()
  await page.getByLabel('And the other side is').first().click()
  await page.getByRole('option', { name: 'pitches' }).click()
  const sql = (await statements()).join('\n')
  if (!sql.includes(`SELECT platform.create_collection('newsroom', 'articles_pitches');`))
    throw new Error('statement: ' + sql)
  if (!sql.includes(`ALTER TABLE "newsroom"."articles_pitches" ADD FOREIGN KEY ("articles")`))
    throw new Error('statement: ' + sql)
  if (!sql.includes(`ALTER TABLE "newsroom"."articles_pitches" ADD FOREIGN KEY ("pitches")`))
    throw new Error('statement: ' + sql)
  if (
    !sql.includes(`CREATE UNIQUE INDEX ON "newsroom"."articles_pitches" ("articles", "pitches");`)
  )
    throw new Error('statement: ' + sql)
  await page.getByRole('button', { name: 'Run' }).click()
  await expectText('statements ran as you')
  await go('/data/model/collection?ws=newsroom&c=articles_pitches')
  await expectText('Appears in')
})
await check('a record is linked to another, and the link is written', async () => {
  await go('/data/records?ws=newsroom&c=articles')
  await page.locator('tbody tr').first().click()
  await page.getByLabel('Tags').first().waitFor({ timeout: 15000 })
  await page.getByLabel('Tags').first().click()
  await page.getByRole('option', { name: 'Sport' }).first().click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expectText('Saved.')
  await go('/data/records?ws=newsroom&c=article_tags')
  await expectText('Sport')
})
await check('the rows that point at a record are counted, and lead to them', async () => {
  await go('/data/records?ws=newsroom&c=articles')
  await page.locator('tbody tr').first().click()
  await expectText('Rows that point here')
  const count = page.getByTitle('Every corrections that points at this row')
  await count.waitFor({ timeout: 15000 })
  await count.click()
  await expectText('Corrections')
  if (!page.url().includes('c=corrections') || !page.url().includes('f.article=eq.'))
    throw new Error(`landed on ${page.url()}`)
})
await check('the search follows the name of the row a record points at', async () => {
  // 'Sport' is the name of a section and of a tag: no headline of the example says it.
  await go('/data/records?ws=newsroom&c=articles&q=Sport')
  await page.locator('tbody tr').first().waitFor({ timeout: 15000 })
  const rows = await page.locator('tbody tr').count()
  if (!rows) throw new Error('the search found no story in the Sport section')
})
await check('a filter may ask by the rows a record reaches', async () => {
  await go('/data/records?ws=newsroom&c=articles')
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByPlaceholder('Field').click()
  await page.getByRole('option', { name: 'Tags', exact: true }).click()
  await page.getByRole('switch').click()
  await page.getByPlaceholder('Their field').click()
  await page.getByRole('option', { name: 'name', exact: true }).click()
  await page.getByPlaceholder('Condition').click()
  await page.getByRole('option', { name: 'is', exact: true }).click()
  await page.getByLabel('Value').fill('Sport')
  await page.getByRole('button', { name: 'Add filter' }).click()
  if (!page.url().includes('f.tags=through.name.eq.Sport'))
    throw new Error(`landed on ${page.url()}`)
  const rows = await page.locator('tbody tr').count()
  if (!rows) throw new Error('the filter found no story with the Sport tag')
})
await check('alice is held to her grants and the policies', async () => {
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByText('Sign out').click()
  await page.getByText('alice@example.com').first().click()
  await expectText('Collections', 60000)
  await go('/sql')
  await page.locator('textarea').first().fill('SELECT internal_notes FROM newsroom.articles')
  await page.getByRole('button', { name: 'Run' }).click()
  await expectText('permission denied for table articles (42501)')
  await page.locator('textarea').first().fill('SELECT 1; SELECT 2')
  await page.getByRole('button', { name: 'Run' }).click()
  await expectText('(42601)')
  await go('/activity?ws=newsroom')
  await expectText('No revision that you may read')
})

// The published interface: an issuer to sign in through, and PostgreSQL behind the relay.
await stop(server)
if (!(await released(port))) throw new Error('the port was not released')
const published = {
  PLATFORM_ISSUER: 'http://localhost:5560',
  PLATFORM_RELAY_URL: 'ws://localhost:5181',
  PLATFORM_DATABASE_NAME: 'postgres',
}
build(['--dir=examples/newsroom', '--production'], published)
const backend = start(['packages/ui/test/published.ts'], { PLATFORM_SITE_PORT: String(port) })
server = serve()
await settle(6000)
const signIn = () => page.getByRole('button', { name: 'Sign in' })
await check(
  'the published interface signs in through the issuer and returns to the page asked for',
  async () => {
    await go('/data/records?ws=newsroom&c=articles')
    await signIn().click()
    await expectText('Headline', 30000)
    if (!page.url().endsWith('/data/records?ws=newsroom&c=articles'))
      throw new Error(`landed on ${page.url()}`)
    await expectText('1–25 of 60', 30000)
    if ((await page.locator('tbody tr').count()) !== 25)
      throw new Error('the records did not arrive through the relay')
  }
)
await check('the token lives in memory: a reload starts signed out', async () => {
  await go('/sql')
  await signIn().waitFor({ timeout: 15000 })
})
await check(
  'a statement runs through the relay on a login of its own, one statement at a time',
  async () => {
    await signIn().click()
    await page.getByRole('button', { name: 'Run' }).click({ timeout: 30000 })
    await expectText('1 row')
    await page.locator('textarea').first().fill('SELECT 1; SELECT 2')
    await page.getByRole('button', { name: 'Run' }).click()
    await expectText('(42601)')
  }
)
await stop(backend)

// The site's own Content-Security-Policy is in force: anything it refused is an error here.
if (errors.length) console.log('The page reported errors:', [...new Set(errors)])
await browser.close()
await stop(server)
process.exit(failed || errors.length ? 1 : 0)
