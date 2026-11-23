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
const build = (args, env) =>
  spawnSync('bun', ['packages/cli/src/cli.ts', 'ui', 'build', ...args], options(env))
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
  }
}
const statement = async () => (await page.locator('.statement pre').first().textContent()) ?? ''
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
  await go('/data/records?ws=newsroom&c=articles&q=budget&f.status=eq.published')
  await expectText('What the budget means for school meals')
  const rows = await page.locator('tbody tr').count()
  if (rows !== 1) throw new Error('rows: ' + rows)
  await expectText('1–1 of 1')
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
server.kill()
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
backend.kill()

// The site's own Content-Security-Policy is in force: anything it refused is an error here.
if (errors.length) console.log('The page reported errors:', [...new Set(errors)])
await browser.close()
server.kill()
process.exit(failed || errors.length ? 1 : 0)
