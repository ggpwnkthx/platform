import { expect, type Page, test as base } from '@playwright/test'

/**
 * One page for each file, in order: a file starts with the example as it is installed, and
 * the database in its page remembers what the tests before did. Anything the page reports as an error — the Content-Security-Policy's
 * refusals among them — fails the test it happened in.
 */
const pages = new Map<string, Page>()
const errors: string[] = []
export const test = base.extend<{ app: Page }>({
  app: async ({ browser }, use, info) => {
    let shared = pages.get(info.file)
    if (!shared) {
      shared = await browser.newPage()
      shared.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text().slice(0, 300))
      })
      pages.set(info.file, shared)
      shared.on('pageerror', (error) => void errors.push(String(error).slice(0, 300)))
    }
    await use(shared)
    expect(errors.splice(0), 'the page reported errors').toEqual([])
  },
})
export { expect }

/** Goes to a page of the interface. The address is a hash, so one document serves them all. */
export const go = async (page: Page, path: string) => {
  await page.goto(`/#${path}`)
}
export const address = (page: Page) => decodeURIComponent(page.url())
/** The change surface, and the statements it shows before they run. */
export const change = (page: Page) => page.locator('[data-change]')
export const statement = async (page: Page) =>
  (await page.locator('[data-change] [data-statement] pre').textContent({ timeout: 10_000 })) ?? ''
export const run = async (page: Page) => {
  await change(page)
    .getByRole('button', { name: /^(Run|Delete|Drop|Revoke)$/ })
    .click()
  await expect(change(page)).toBeHidden()
}
/** Chooses one of a select's options, by the label of the select. */
export const choose = async (
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
  within = change(page)
) => {
  await within.getByLabel(label).first().click()
  await page.getByRole('option', { name: option }).first().click()
}
/** The dev mode's sign-in: the page is the identity provider, and a person is chosen. */
export const signInAs = async (page: Page, who: string) => {
  await page.getByRole('button', { name: who }).click()
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible({ timeout: 90_000 })
}
export const rows = (page: Page) => page.locator('main tbody tr')
