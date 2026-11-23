#!/usr/bin/env bun
import { VERSION } from '@platform/core'
import { defineCommand, runMain } from 'citty'
import { kubernetes } from './deploy/kubernetes.ts'
import { local } from './deploy/local.ts'
import {
  apply,
  doctorCommand,
  lock,
  migrate,
  modelApply,
  sql,
  unlock,
} from './commands/database.ts'
import { harden } from './commands/harden.ts'
import { token } from './commands/token.ts'
import { ui } from './commands/ui.ts'
import { command } from './commands/shared.ts'

const main = defineCommand({
  meta: {
    name: 'platform',
    version: VERSION,
    description:
      'Database commands use DATABASE_HOST/PORT/NAME/SSL and act as the person whose token is in PGTOKEN[_FILE]: `platform token` prints one. No login has a password.',
  },
  subCommands: {
    migrate,
    apply,
    'model:apply': modelApply,
    sql,
    doctor: doctorCommand,
    lock,
    unlock,
    harden,
    token,
    deploy: command(
      'deploy <local|k8s> <action>: local is up, init, admin CMD, ui, validate, build, status, logs, down (--engine, --timeout, --domain); k8s is render, validate, diff, apply, status, logs, down (--namespace, --domain, --image, --public-url, --oidc-issuer, --database-host, --database-port, --timeout). See docs/operations.md.',
      {},
      async ({ rawArgs }) => {
        const [where, action, ...rest] = rawArgs
        if (!where || !action)
          throw new Error(
            'deploy needs a target and an action: deploy local up, deploy k8s render. Run deploy --help.'
          )
        if (!['local', 'k8s', 'kubernetes'].includes(where))
          throw new Error(`Unknown deployment target: ${where}. Supported targets: local, k8s.`)
        process.exitCode = await (where === 'local'
          ? local(action, rest)
          : kubernetes(action, rest))
      }
    ),
    ui: {
      meta: {
        description: 'Build the interface as a static site, and serve it while it is worked on.',
      },
      subCommands: ui,
    },
    version: command('Print the package version.', {}, () => console.log(VERSION)),
  },
})

if (import.meta.main) runMain(main)
