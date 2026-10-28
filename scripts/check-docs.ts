#!/usr/bin/env bun
/**
 * The links of the documentation, and its repetitions.
 *
 * The documentation is one tree now, and a link that points at nothing
 * is a dead end for the reader. The checker reads every markdown file
 * of the repository and resolves every relative link against the file
 * it is in.
 *
 * A link names two things: the document it points at, and the place
 * inside it, when it names one. The checker resolves both. The name of
 * a place is the name of a heading, the name the reader sees in the
 * address of a rendered document, and a link that names a heading that
 * is not there is a dead end too.
 *
 * The checker reads the sentences of the prose as well: a sentence that
 * two documents carry is a sentence the reader reads twice, and the
 * rule that both of them state belongs to one of them.
 *
 * The engines are in `tooling/documentation.ts` and in
 * `tooling/repetition.ts`: the command runs them, and the test suite
 * proves them.
 *
 *   bun run scripts/check-docs.ts
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { linkProblemsOf } from '../tooling/documentation'
import { repetitionProblemsOf } from '../tooling/repetition'
import { GEOMETRY, MAP_HOPS, MAP_REQUESTS, MAP_STATIONS } from '../packages/console/src/domains/map'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The directories that hold no document. */
const SKIPPED = ['node_modules', '.git', '.pg', '.access', 'dist', 'coverage']

/**
 * The files that are not checked for repetition.
 *
 * The changelog is the record of what was said: a release that repeats
 * the words of an older release is a changelog that tells the truth.
 */
const HISTORICAL = ['CHANGELOG.md']

/** Every markdown file of a directory, recursively. */
async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIPPED.includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(path)))
      continue
    }
    if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

/** The main of the check. */
async function main(): Promise<void> {
  const files = await filesOf(root)
  const problems: string[] = await linkProblemsOf(root, files)
  await checkAtlas(problems)
  const living = files.filter((file) => !HISTORICAL.includes(relative(root, file)))
  const repetitions: string[] = await repetitionProblemsOf(root, living)
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`${problems.length} broken links`)
    process.exit(1)
  }
  if (repetitions.length > 0) {
    for (const repetition of repetitions) console.error(repetition)
    console.error(`${repetitions.length} repeated sentences`)
    process.exit(1)
  }
  console.log(
    `every link of the ${files.length} documents of the documentation resolves, ` +
      'every place it names is there, and no sentence of it is said twice'
  )
}

/**
 * The paths of the code that the atlas names.
 *
 * The atlas is a drawing of the platform, and a drawing that names a
 * directory that moved is a drawing that lies. The paths it names are
 * checked against the repository, the way the links of a document are.
 */
async function checkAtlas(problems: string[]): Promise<void> {
  const atlas = join(root, 'docs', 'platform', 'atlas.html')
  const content = await readFile(atlas, 'utf8')
  const paths = [...content.matchAll(/"code":\s*"([^"]+)"/g)].map((match) => match[1]!)
  for (const path of paths) {
    const target = join(root, path)
    const exists = await stat(target).then(
      () => true,
      () => false
    )
    if (!exists) {
      problems.push(`the atlas names ${path}, which is not there`)
    }
  }
  await checkTheMap(problems, content)
}

/** The shape of the data of the atlas. */
interface AtlasData {
  readonly stations?: {
    readonly id: string
    readonly name: string
    readonly kind: string
    readonly what: string
    readonly owns: string
    readonly contracts: string
    readonly code: string
  }[]
  readonly hops?: {
    readonly id: string
    readonly from: string
    readonly to: string
    readonly contract: string
    readonly carries: string
    readonly decides: string
    readonly refuses: string
    readonly requests: readonly string[]
  }[]
  readonly requests?: {
    readonly id: string
    readonly label: string
    readonly steps: readonly string[]
    readonly note?: string
  }[]
}

/**
 * The atlas and the console draw the same platform.
 *
 * The atlas is in the documentation and the map is on the page of the
 * status, and the two hold the facts of the platform in their own copy.
 * The check refuses them when they part company: a drawing that names a
 * contract the console does not know is a drawing that lies.
 */
function checkTheMap(problems: string[], content: string): void {
  const island = /<script type="application\/json" id="atlas-map">([\s\S]*?)<\/script>/.exec(
    content
  )
  if (!island) {
    problems.push('the atlas holds no data of the platform')
    return
  }
  let data: AtlasData
  try {
    data = JSON.parse(island[1] ?? '') as AtlasData
  } catch {
    problems.push('the data of the atlas is not json')
    return
  }
  const stations = new Map((data.stations ?? []).map((station) => [station.id, station]))
  for (const station of MAP_STATIONS) {
    const found = stations.get(station.id)
    if (!found) {
      problems.push(`the atlas has no station named ${station.id}`)
      continue
    }
    for (const field of ['name', 'kind', 'what', 'owns', 'contracts', 'code'] as const) {
      if (found[field] !== station[field]) {
        problems.push(`the atlas and the console disagree on the ${field} of ${station.id}`)
      }
    }
  }
  const hops = new Map((data.hops ?? []).map((hop) => [hop.id, hop]))
  for (const hop of MAP_HOPS) {
    const found = hops.get(hop.id)
    if (!found) {
      problems.push(`the atlas has no hop named ${hop.id}`)
      continue
    }
    for (const field of ['from', 'to', 'contract', 'carries', 'decides', 'refuses'] as const) {
      if (found[field] !== hop[field]) {
        problems.push(`the atlas and the console disagree on the ${field} of ${hop.id}`)
      }
    }
    if (found.requests.join(' ') !== hop.requests.join(' ')) {
      problems.push(`the atlas and the console disagree on the requests of ${hop.id}`)
    }
  }
  const requests = new Map((data.requests ?? []).map((request) => [request.id, request]))
  for (const request of MAP_REQUESTS) {
    const found = requests.get(request.id)
    if (!found) {
      problems.push(`the atlas has no request named ${request.id}`)
      continue
    }
    if (found.label !== request.label) {
      problems.push(`the atlas and the console disagree on the label of ${request.id}`)
    }
    if (found.steps.join(' ') !== request.steps.join(' ')) {
      problems.push(`the atlas and the console disagree on the steps of ${request.id}`)
    }
    if ((found.note ?? '') !== (request.note ?? '')) {
      problems.push(`the atlas and the console disagree on the note of ${request.id}`)
    }
  }
  checkTheDrawing(problems, content)
}

/**
 * The atlas and the console draw the same facts.
 *
 * The two draw the platform in two styles — the atlas as a picture of
 * the stations, the console as the lanes of a conversation — and
 * they name the same things. A hop that the two call differently is a
 * hop that one of the two pages shows wrong.
 */
function checkTheDrawing(problems: string[], content: string): void {
  const hops = [
    ...content.matchAll(
      /data-hop="([^"]+)"[^>]*>\s*<path[^>]*\sd="([^"]+)"[^>]*\/>\s*<text[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*>([^<]*)</g
    ),
  ]
  const drawn = new Map(hops.map((match) => [match[1]!, match]))
  for (const hop of MAP_HOPS) {
    const found = drawn.get(hop.id)
    const shape = GEOMETRY.hops[hop.id]
    if (!found || !shape) {
      problems.push(`the atlas does not draw the hop ${hop.id}`)
      continue
    }
    if (found[5].trim() !== shape.label) {
      problems.push(`the atlas and the console name the hop ${hop.id} differently`)
    }
  }
  const stations = [
    ...content.matchAll(
      /data-station="([^"]+)"[^>]*>\s*<rect[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*\swidth="([^"]+)"[^>]*\sheight="([^"]+)"[^>]*\/>\s*<text[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*>([^<]*)<\/text>\s*<text[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*>([^<]*)</g
    ),
  ]
  const drawnStations = new Map(stations.map((match) => [match[1]!, match]))
  for (const station of MAP_STATIONS) {
    const found = drawnStations.get(station.id)
    const shape = GEOMETRY.stations[station.id]
    if (!found || !shape) {
      problems.push(`the atlas does not draw the station ${station.id}`)
      continue
    }
    if (found[8].trim() !== shape.kind) {
      problems.push(`the atlas and the console call ${station.id} something else`)
    }
    if (found[11].trim() !== station.name) {
      problems.push(`the atlas and the console name the station ${station.id} differently`)
    }
  }
}

if (import.meta.main) await main()
