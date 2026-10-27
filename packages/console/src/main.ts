#!/usr/bin/env bun
/**
 * The process of the console.
 *
 * The configuration is read first, and a configuration that cannot be
 * used stops the process before it listens. Then the console is served
 * one of two ways:
 *
 * - **the build** (`dist/`): the server Vite built and the files of the
 *   browser, served by Bun. It is the way of an image and of every
 *   deployment.
 * - **the sources**, through the server of the development of Vite, when
 *   `CONSOLE_ENVIRONMENT=development` and Vite is installed: a change of
 *   a page is the page the developer reads next.
 *
 *   bun run src/main.ts
 */

import { join, normalize, resolve, sep } from 'node:path'
import { ConfigError, type ConsoleConfig, readConfig } from './runtime/config'
import { createLogger, type Logger } from './runtime/log'
import { VERSION } from './runtime/version'

/** The root of the package. */
const root = resolve(import.meta.dir, '..')

/** The application the build holds. */
interface BuiltApp {
  fetch: (request: Request) => Response | Promise<Response>
}

/** Reports whether the server of the development is installed. */
async function viteIsInstalled(): Promise<boolean> {
  try {
    await import('vite')
    return true
  } catch {
    return false
  }
}

/**
 * The modules of the console that the development needs.
 *
 * The pages of the console are written in the JSX of Hono, and the
 * server of the development of Vite builds them with the runtime of
 * that JSX. The application of the console is HonoX.
 */
const DEVELOPMENT_MODULES = ['hono/jsx/jsx-dev-runtime', 'honox/server'] as const

/**
 * Reports what the console misses to serve a page.
 *
 * A console whose dependencies are not installed does not serve a
 * page: it fails when the browser asks for one, and the error names a
 * module rather than a cause. The console looks for its modules before
 * it listens, and says what is missing and what to do about it.
 */
function missesOfTheDevelopment(): string[] {
  const misses: string[] = []
  for (const module of DEVELOPMENT_MODULES) {
    try {
      Bun.resolveSync(module, root)
    } catch {
      misses.push(describeMissingModule(module))
    }
  }
  return misses
}

/**
 * Describes a module of the console that cannot be resolved.
 *
 * A package that is not installed at all and a package whose
 * installation misses one of its files are two different faults, and
 * they have two different remedies: the first is an installation that
 * is not made, the second is an installation that is not whole.
 */
function describeMissingModule(module: string): string {
  const segments = module.split('/')
  const name = module.startsWith('@')
    ? segments.slice(0, 2).join('/') || module
    : (segments[0] ?? module)
  try {
    const entry = Bun.resolveSync(name, root)
    return (
      `${module} is missing from the installation of ${name} (${entry}): run ` +
      '`bun install --force` in the root of the repository, and clear the cache of Bun ' +
      '(~/.bun/install/cache) when the package is still not whole'
    )
  } catch {
    return `${name} is not installed: run \`bun install --force\` in the root of the repository`
  }
}

/** Serves the sources through the server of the development of Vite. */
async function serveSources(config: ConsoleConfig, log: Logger): Promise<() => Promise<void>> {
  const { createServer } = await import('vite')
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    server: { host: config.host, port: config.port, strictPort: true },
    logLevel: 'warn',
  })
  await server.listen()
  log.info('the console is listening', {
    mode: 'sources',
    url: `http://${config.host}:${config.port}`,
    version: VERSION,
  })
  return async () => {
    await server.close()
  }
}

/** Serves a file of the browser from the build. */
async function staticFile(directory: string, pathname: string): Promise<Response | null> {
  let relative: string
  try {
    relative = decodeURIComponent(pathname.slice('/static/'.length))
  } catch {
    return null
  }
  const path = normalize(join(directory, relative))
  // A path that leaves the directory of the build is not a file of it.
  if (!path.startsWith(`${directory}${sep}`)) return null
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return new Response(file, {
    headers: {
      // The names of the files carry the digest of their content.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Serves the build. */
async function serveBuild(config: ConsoleConfig, log: Logger): Promise<() => Promise<void>> {
  const bundle = join(root, 'dist', 'server', 'index.js')
  if (!(await Bun.file(bundle).exists())) {
    throw new Error('the console is not built: run `bun run build` in packages/console')
  }
  const app = ((await import(bundle)) as { default: BuiltApp }).default
  const assets = join(root, 'dist', 'static')
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/static/')) {
        return (
          (await staticFile(assets, url.pathname)) ?? new Response('not found', { status: 404 })
        )
      }
      return await app.fetch(request)
    },
  })
  log.info('the console is listening', {
    mode: 'build',
    url: `http://${config.host}:${server.port}`,
    version: VERSION,
  })
  return async () => {
    await server.stop()
  }
}

async function main(): Promise<void> {
  let config: ConsoleConfig
  try {
    config = readConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      createLogger('error').error('the configuration of the console is not usable', {
        problems: error.problems,
      })
      process.exit(1)
    }
    throw error
  }
  const log = createLogger(config.logLevel)
  const sources = config.environment === 'development' && (await viteIsInstalled())
  const misses = sources ? missesOfTheDevelopment() : []
  if (misses.length > 0) {
    log.error('the console cannot serve a page: its dependencies are not installed', {
      missing: misses,
      remedy:
        'run `bun install --force` in the root of the repository, and check that ' +
        'packages/console is a workspace of the repository and that its package.json ' +
        'names hono and honox',
    })
    process.exit(1)
  }
  const stop = sources ? await serveSources(config, log) : await serveBuild(config, log)

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    log.info('the console is stopping', { signal })
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  createLogger('error').error('the console did not start', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
