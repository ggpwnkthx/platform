import { buildUi, devUi, serveUi } from '../site.ts'
import { command } from './shared.ts'

/** The interface as a static site: built for a CDN, served while it is worked on. */
export const ui = {
  build: command(
    'Write the interface out as a static site: the pages, one bundle, the fonts, config.json and _headers.',
    {
      dir: {
        type: 'string',
        description: 'The directory that holds platform.json; the site is written to its .dist',
        required: true,
      },
      production: {
        type: 'boolean',
        description:
          'Build the published interface: the one that signs in through the issuer and reaches PostgreSQL through the relay',
      },
    },
    async ({ args }) => console.log(`The site is in ${await buildUi(args)}`)
  ),
  dev: command(
    'Serve the site, rebuilding it on every change. A folder that applies something runs PostgreSQL inside the page.',
    {
      dir: {
        type: 'string',
        description: 'The directory that holds platform.json',
        required: true,
      },
      relay: {
        type: 'string',
        description:
          'HOST:PORT of a real PostgreSQL: serve the published interface and forward its sessions there',
      },
      port: { type: 'string', description: 'Default: 5173' },
    },
    ({ args }) => devUi({ ...args, port: args.port ? Number(args.port) : undefined })
  ),
  serve: command(
    'Serve a site that is already built, as the files it is.',
    {
      dir: { type: 'string', description: 'The built site', required: true },
      port: { type: 'string', description: 'Default: 8080' },
    },
    ({ args }) =>
      void console.log(
        `Serving ${args.dir} on port ${serveUi(args.dir, Number(args.port ?? 8080)).port}`
      )
  ),
}
