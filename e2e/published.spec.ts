import { address, expect, go, rows, test } from './support.ts'

test.describe.configure({ mode: 'serial' })
const signIn = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Sign in' })

test('the published site signs in through the issuer and returns to the page asked for', async ({
  app,
}) => {
  await go(app, '/newsroom.articles')
  await signIn(app).click()
  await expect(app.getByRole('columnheader', { name: 'Headline' })).toBeVisible({ timeout: 30_000 })
  expect(address(app)).toContain('#/newsroom.articles')
  // The rows arrived over a WebSocket, through the relay, from PostgreSQL's own protocol.
  await expect(app.getByText('1-25 of 60')).toBeVisible()
  await expect(rows(app)).toHaveCount(25)
})

test('the token lives in memory: a reload starts signed out', async ({ app }) => {
  await go(app, '/sql')
  await app.reload()
  await expect(signIn(app)).toBeVisible()
})

test('a statement runs through the relay on a login of its own, one statement at a time', async ({
  app,
}) => {
  await signIn(app).click()
  await app.getByRole('button', { name: 'Run' }).click({ timeout: 30_000 })
  await expect(app.locator('[data-answer]')).toContainText('1 row')
  await app.getByLabel('Statement').fill('SELECT 1; SELECT 2')
  await app.getByRole('button', { name: 'Run' }).click()
  await expect(app.locator('[data-refusal]')).toContainText('(42601)')
  // What PostgreSQL says beside its answer arrives through the relay too.
  await app.getByLabel('Statement').fill("DO $$ BEGIN RAISE WARNING 'said beside'; END $$")
  await app.getByLabel('Statement').press('Control+Enter')
  await expect(app.locator('[data-notice]')).toContainText('PostgreSQL warned: said beside')
})

test('the published site carries no in-page PostgreSQL', async ({ request }) => {
  const page = await (await request.get('/')).text()
  const script = page.match(/assets\/index-[^"]+\.js/)![0]
  expect(await (await request.get(`/${script}`)).text()).not.toContain('pglite')
  const headers = (await request.get('/')).headers()
  expect(headers['content-security-policy']).toContain("script-src 'self';")
})
