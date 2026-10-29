/**
 * The build of the console.
 *
 *   vite build --mode client   the script of the browser and the sheet: dist/static
 *   vite build                 the server: dist/server/index.js
 *
 * The client is built first: the server reads the manifest of the client
 * to name the files of the script and of the sheet in its pages.
 *
 * The sources of the application live in `src/app`, and HonoX is told
 * so: its defaults name `/app`.
 */

import honox from 'honox/vite'
import { injectImportingIslands } from 'honox/vite/inject-importing-islands'
import { defineConfig } from 'vite'
import { documentation } from './scripts/documentation'

const ISLANDS = '/src/app/islands'

export default defineConfig(({ command, mode }) => {
  if (mode === 'client') {
    return {
      // The cache of Vite is at the root of the repository: the tree of
      // the dependencies is flat, and a workspace holds no
      // `node_modules` of its own.
      cacheDir: '../../node_modules/.vite/console',
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        assetsDir: 'static',
        manifest: true,
        rollupOptions: {
          input: ['/src/app/client.ts', '/src/app/style.css'],
        },
      },
      esbuild: { jsxImportSource: 'hono/jsx/dom' },
    }
  }
  return {
    // The cache of Vite is at the root of the repository: the tree of
    // the dependencies is flat, and a workspace holds no
    // `node_modules` of its own.
    cacheDir: '../../node_modules/.vite/console',
    // The pages name the files of the build when they are built, whatever
    // the environment of the process that builds them says: a build in a
    // process whose NODE_ENV is not `production` is still a build.
    define: { 'import.meta.env.CONSOLE_BUILD': JSON.stringify(command === 'build') },
    plugins: [
      honox({
        entry: './src/app/server.ts',
        islandComponents: { islandDir: ISLANDS },
        client: { input: ['/src/app/client.ts', '/src/app/style.css'] },
        devServer: {
          // The sources, the modules and the assets of Vite are Vite's
          // own business in the development: the application never sees
          // them.
          exclude: [
            /^\/src\/.+/,
            /^\/@.+$/,
            /^\/node_modules\/.*/,
            /.*\.(ts|tsx|css|map)(\?.*)?$/,
            /\?(import|inline|raw|url)/,
          ],
        },
      }),
      injectImportingIslands({ appDir: '/src/app', islandDir: ISLANDS }),
      // The documentation of the platform is read when the server is
      // built, and the build holds it: the image of the console holds
      // the build of the server and nothing else.
      documentation(),
    ],
    build: {
      ssr: './src/app/server.ts',
      outDir: 'dist/server',
      emptyOutDir: false,
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: 'index.js' } },
    },
    ssr: { target: 'node', noExternal: true },
  }
})
