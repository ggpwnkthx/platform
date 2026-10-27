#!/usr/bin/env bun
/**
 * The compatibility harness of the platform.
 *
 * The platform is three services, and they speak to each other over
 * HTTP. The harness proves that they still speak to each other the way
 * their specifications say.
 *
 * There were two harnesses before the merge, one per repository, and
 * they cloned the other services at pinned revisions. There is one now:
 * the references of the suites are the workspaces of this repository,
 * at the revision the platform was released at. The revision is pinned
 * in the manifest: the candidate of a run is the tree of the working
 * directory, and the references are the pinned revision of it.
 *
 * The harness runs two suites:
 *
 * 1. the contract of the access service: the gateway of the platform,
 *    at the pinned revision, against the access service of the tree;
 * 2. the acceptance of the platform: the data service of the tree,
 *    against the gateway and the access service of the pinned revision.
 *
 * The command:
 *
 *   bun run compatibility
 *
 * The environment:
 *
 *   GATEWAY_REPOSITORY    the repository of the gateway: a git url or the
 *                         path of a local repository (default: the
 *                         workspace of this repository)
 *   GATEWAY_COMMIT        the revision of the gateway
 *   ACCESS_REPOSITORY     the repository of the access service
 *   ACCESS_COMMIT         the revision of the access service
 *   COMPAT_MIRROR         a directory that holds the bare mirrors
 *   COMPAT_KEEP           when it is set, the checkouts are kept
 *
 * A run with an override is a run of a **candidate**: it is not the proof
 * of the baseline of the manifest, and the harness says so.
 */

import { spawn, type Subprocess } from 'bun'
import { join, resolve } from 'node:path'
import { readCompatibilityManifest, selectBaseline } from '../tooling/compatibility/manifest'
import { repositoryOf, trackedChanges } from '../tooling/compatibility/reference'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The suites of the platform, in the order they run. */
const SUITES = [
  {
    name: 'the contract of the access service',
    workspace: 'packages/access',
    command: ['bun', 'run', 'scripts/compat/compatibility.ts'],
  },
  {
    name: 'the acceptance of the platform',
    workspace: 'packages/data',
    command: ['bun', 'run', 'scripts/compat/compatibility.ts'],
  },
] as const

/** Runs a command and waits for it. */
async function run(name: string, command: string[], cwd: string): Promise<number> {
  console.log(`\n=== ${name} ===`)
  const child: Subprocess = spawn(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  return typeof code === 'number' ? code : 1
}

/** The main of the harness. */
async function main(): Promise<number> {
  const manifest = await readCompatibilityManifest(join(root, 'compatibility.json'))
  const baseline = selectBaseline(manifest, process.env)
  console.log(`the baseline of the platform is the revision of ${manifest.repository}`)
  if (!baseline.isBaseline) {
    console.log(
      `the run is a candidate: ${baseline.overrides.join(', ')} override the manifest, ` +
        'and it is not the proof of the baseline of compatibility.json'
    )
  }

  // The references are the workspaces of the pinned revision, and the
  // workspaces of the tree are the candidates. A candidate carries the
  // changes it was meant to carry: what the harness proves is that the
  // suites did not change it.
  const repository = repositoryOf(root)
  const candidates = Object.entries(manifest.workspaces).filter(
    ([, workspace]) => !workspace.source
  )
  const before = new Map<string, string>()
  for (const [name, workspace] of candidates) {
    if (workspace.source) {
      console.log(
        `the reference of ${name} is ${workspace.source.repository} at ${workspace.source.commit}`
      )
      continue
    }
    const directory = join(root, workspace.path)
    before.set(name, trackedChanges(repository, directory))
    console.log(`the candidate ${workspace.path} is the tree of the working directory`)
  }

  for (const suite of SUITES) {
    const status = await run(suite.name, [...suite.command], join(root, suite.workspace))
    if (status !== 0) {
      console.error(`the suite "${suite.name}" failed with the status ${status}`)
      return status
    }
  }

  // The suites are read-only: a suite that changed the tree of a
  // candidate changed the code that is tested.
  for (const [name, workspace] of candidates) {
    const changes = trackedChanges(repository, join(root, workspace.path))
    if (changes !== before.get(name)) {
      console.error(`the suite changed the candidate ${workspace.path}:\n${changes}`)
      return 1
    }
  }
  console.log('the candidates are the ones of the beginning of the run')

  console.log('\nthe compatibility of the platform holds')
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
