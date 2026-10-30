#!/usr/bin/env bun
/**
 * The one repository of the platform.
 *
 * The platform is one repository, and it names one: the one it lives
 * in, the images it publishes, and the mirrors of the
 * compatibility suite. The three services were published from three
 * repositories of their own, and those repositories are gone: a clone
 * of one fails, an image published in one is not reachable, and a
 * document that tells an operator to clone one sends it to a dead end.
 *
 * The check reads every file of the repository and reports the lines
 * that name a repository the platform does not have. It does not name
 * the repositories that are gone: it refuses every name but the ones of
 * the platform, and a list of dead ends is a list that names them
 * again.
 *
 *   bun run scripts/check-repositories.ts
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { repositoryReferencesOf } from '../tooling/repositories'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The directories that hold no file of the platform. */
const SKIPPED = ['node_modules', '.git', '.pg', '.access', 'dist', 'coverage', '.tmp']

/** Every file of a directory, recursively. */
async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIPPED.includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(path)))
      continue
    }
    found.push(path)
  }
  return found
}

/** The main of the check. */
async function main(): Promise<void> {
  const files = await filesOf(root)
  const problems: string[] = []
  let read = 0
  for (const file of files) {
    const path = relative(root, file).split('\\').join('/')
    const content = await readFile(file, 'utf8')
    // A file that is not text is not a document of the platform: the
    // archives of the fixtures and the images of the tests are binary.
    if (content.includes('\0')) continue
    read += 1
    for (const reference of repositoryReferencesOf(content)) {
      problems.push(
        `${path}:${reference.line} names ${reference.name}, a repository that the platform does not have`
      )
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`${problems.length} references to a repository that the platform does not have`)
    process.exit(1)
  }
  console.log(`the ${read} files of the platform name one repository and its images`)
}

if (import.meta.main) await main()
