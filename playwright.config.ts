import { defineConfig } from '@playwright/test'

/**
 * The interface in a real browser, under the site's own Content-Security-Policy: the dev
 * mode (PostgreSQL in the page, the newsroom example) and the published site (an issuer to
 * sign in through, and PostgreSQL behind the relay). `bun run test:e2e`.
 */
const vite = 'bun --bun run --cwd examples/newsroom vite'
const published = {
  PLATFORM_DIST: '.dist-published',
  PLATFORM_ISSUER: 'http://localhost:5560',
  PLATFORM_RELAY_URL: 'ws://localhost:5181',
  PLATFORM_DATABASE_NAME: 'postgres',
}
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    channel: 'chrome',
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--no-sandbox'] },
  },
  projects: [
    {
      name: 'dev',
      testMatch: /(model|rows|reader|surfaces)\.spec\.ts/,
      use: { baseURL: 'http://localhost:5179' },
    },
    {
      name: 'published',
      testMatch: 'published.spec.ts',
      use: { baseURL: 'http://localhost:5180' },
    },
  ],
  webServer: [
    {
      command: `${vite} build --mode development && ${vite} preview --mode development --port 5179 --strictPort`,
      url: 'http://localhost:5179',
      timeout: 180_000,
    },
    {
      command: `${vite} build && ${vite} preview --port 5180 --strictPort`,
      url: 'http://localhost:5180',
      env: published,
      timeout: 180_000,
    },
    {
      command: 'bun packages/ui/test/published.ts',
      url: 'http://localhost:5560/.well-known/openid-configuration',
      env: { PLATFORM_SITE_PORT: '5180' },
    },
  ],
})
