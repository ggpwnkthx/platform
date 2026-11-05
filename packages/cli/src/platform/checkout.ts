/**
 * The checkout the command runs in.
 *
 * The CLI is run from a checkout of the repository, and the paths of a
 * deployment are paths of that checkout: `deploy/tofu/azure` and
 * `deploy/tofu/runtime/<environment>` are not paths of the directory
 * the command happens to run in.
 *
 * The command may run in a directory of the checkout, and not in the
 * checkout itself: the CLI is run through the workspace of a package,
 * and the workspace is a directory of the checkout. The path the
 * operator typed is a path of the checkout, and the CLI reads it from
 * the checkout.
 *
 * A command that runs outside of a checkout reads its paths from the
 * directory it runs in, and the path the operator typed is the path
 * they typed.
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { run } from './process'

/** The directory of the deployment of a checkout. */
const DEPLOYMENT = join('deploy', 'tofu')

/** The number of directories the CLI walks up. */
const DEPTH = 6

/**
 * The checkout the command runs in.
 *
 * The checkout is the directory that holds the deployment of the
 * platform, and the CLI walks up from the directory the command runs
 * in to find it. A command that runs outside of a checkout has none,
 * and its paths are the paths of the directory it runs in.
 *
 * @param from the directory the command runs in.
 */
export function checkoutOf(from: string = process.cwd()): string | undefined {
  let directory = resolve(from)
  for (let depth = 0; depth < DEPTH; depth += 1) {
    if (existsSync(join(directory, DEPLOYMENT))) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/**
 * A path the operator named.
 *
 * The path is read from the directory the command runs in, and from the
 * checkout when it is not there: the operator named a path of the
 * deployment, and the deployment lives in the checkout. A path that is
 * nowhere is the path of the directory the command runs in, and the
 * command that needs it refuses it and names it.
 *
 * @param named the path the operator named.
 * @param from the directory the command runs in.
 */
export function pathOf(named: string, from: string = process.cwd()): string {
  if (isAbsolute(named)) return named
  const direct = resolve(from, named)
  if (existsSync(direct)) return direct
  const checkout = checkoutOf(from)
  if (checkout === undefined) return direct
  const candidate = join(checkout, named)
  return existsSync(candidate) ? candidate : direct
}

/**
 * A path the deployment names by itself.
 *
 * The path of a deployment lives in the checkout, and the directory it
 * holds may not be there yet: the values of a deployment that is new
 * are written in a directory that does not exist. The path is read
 * from the checkout, and from the directory the command runs in when
 * there is no checkout.
 *
 * @param named the path the deployment names.
 * @param from the directory the command runs in.
 */
export function placeOf(named: string, from: string = process.cwd()): string {
  if (isAbsolute(named)) return named
  const checkout = checkoutOf(from)
  if (checkout !== undefined) return join(checkout, named)
  return resolve(from, named)
}

/**
 * What a checkout says about the templates of a release.
 *
 * - `same` — the templates of the checkout are the ones of the tag.
 * - `different` — they are not: the checkout is ahead of the tag, or
 *   the templates of the checkout were changed.
 * - `unknown` — the checkout cannot tell: it is not a repository, the
 *   tag is not in it, or the program that reads it is not there.
 */
export type TemplatesState = 'same' | 'different' | 'unknown'

/**
 * The state of the templates of a checkout, against the tag of a
 * release.
 *
 * The templates of a deployment and the images of the release are one
 * release: a deployment that runs the images of a release with the
 * templates of another commit runs a service that reads a document it
 * does not know, and refuses to start.
 *
 * The state is read with the program that reads the state of a
 * repository. A checkout that holds no program, or a tag that is not
 * in it, tells nothing: the state is unknown, and the caller decides
 * what to do with a thing it cannot know.
 *
 * @param directory the directory of the templates of the deployment.
 * @param tag the tag of the release.
 */
export async function templatesStateOf(directory: string, tag: string): Promise<TemplatesState> {
  const here = resolve(directory)
  let top: string
  try {
    const answer = await run('git', ['-C', here, 'rev-parse', '--show-toplevel'])
    if (answer.status !== 0) return 'unknown'
    top = answer.stdout.trim()
  } catch {
    return 'unknown'
  }
  if (top === '') return 'unknown'
  const path = relative(top, here)
  if (path === '' || path.startsWith('..')) return 'unknown'
  try {
    const answer = await run('git', ['-C', top, 'diff', '--quiet', tag, '--', path])
    if (answer.status === 0) return 'same'
    if (answer.status === 1) return 'different'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
