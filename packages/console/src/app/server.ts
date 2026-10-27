/**
 * The application of the console: the routes of `src/app/routes`, read
 * by HonoX.
 *
 * Vite builds this module into `dist/server/index.js`, and the server of
 * the development loads it from the source. The process that serves it
 * is `src/main.ts`.
 */

import { createApp } from 'honox/server'

const app = createApp({
  root: '/src/app/routes',
  NOT_FOUND: import.meta.glob('/src/app/routes/**/_404.tsx', { eager: true }),
  ERROR: import.meta.glob('/src/app/routes/**/_error.tsx', { eager: true }),
  RENDERER: import.meta.glob('/src/app/routes/**/_renderer.tsx', { eager: true }),
  MIDDLEWARE: import.meta.glob('/src/app/routes/**/_middleware.{ts,tsx}', { eager: true }),
  ROUTES: import.meta.glob(
    [
      '/src/app/routes/**/*.{ts,tsx}',
      '!/src/app/routes/**/_*.{ts,tsx}',
      '!/src/app/routes/**/-*.{ts,tsx}',
      '!/src/app/routes/**/-*/**/*',
    ],
    { eager: true }
  ),
})

export default app
