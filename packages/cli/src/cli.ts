#!/usr/bin/env bun
import { kubernetes } from './k8s.ts'
import { local } from './local.ts'

/**
 * The operator's deployment, and nothing else: the local stack and Kubernetes. Everything
 * done to a database is a SQL file run by psql (docs/operations.md), and a site is built by
 * Vite in its own folder.
 */
const usage = `platform deploy — bun run deploy <target> <action>

  local   up | init | build | validate | status | logs | down | psql
          --engine=auto|docker|podman  --timeout=SECONDS  --domain=NAME
  k8s     render | validate | diff | apply | status | logs | down
          --namespace=NAME --domain=NAME --image=IMAGE --public-url=URL
          --database-host=HOST --database-port=PORT --timeout=SECONDS

Settings are read from the environment and from .env, and written there the first time.`

const [target, action, ...rest] = process.argv.slice(2)
if (!target || !action || target.startsWith('-')) {
  console.log(usage)
  process.exit(target === '--help' || target === '-h' ? 0 : 1)
}
try {
  if (!['local', 'k8s'].includes(target))
    throw new Error(`Unknown deployment target: ${target}. Supported targets: local, k8s.`)
  process.exitCode = await (target === 'local' ? local(action, rest) : kubernetes(action, rest))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
