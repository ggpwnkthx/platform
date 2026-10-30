/**
 * The paths of the clients of the data API.
 *
 * The console, the CLI and the published client of Data are three
 * clients of the same contract, and they speak to it with the same
 * paths. They live in three places — the client workspace and the
 * published package — and a path that one of them writes and the other
 * does not is a path that answers differently depending on who asks.
 *
 * The published client is installed by the consumers of the platform
 * outside of this repository: it cannot import the client workspace,
 * and the client workspace cannot be published. The two are therefore
 * two copies of the same paths, and the check of the paths reads both
 * and refuses the published one when it names a path that the console
 * and the CLI do not know.
 *
 * The check reads the sources: it never imports the code it checks.
 */

/**
 * The marker of an expression of a template, in the source that is read.
 *
 * The marker is not a character of the source: it is what the scanner
 * leaves behind when it skips the expression of a placeholder.
 */
const PLACEHOLDER = '\u0000'

/** A path of the API of the data, with its placeholders. */
export interface ClientPath {
  /** The path, with `{…}` where the caller names a value. */
  readonly path: string
  /** The file it was read from. */
  readonly file: string
}

/**
 * Reads the paths of a source.
 *
 * A path is a literal that begins with a slash. The placeholders of a
 * template are replaced with `{…}`, so that the path of a record and
 * the path of a collection are the same path: the literal that follows
 * a placeholder is part of the path when it begins with a slash, and it
 * is a query when it does not.
 *
 * @param file the file the source is in.
 * @param content the source.
 */
export function pathsOf(file: string, content: string): ClientPath[] {
  const found: ClientPath[] = []
  for (const literal of literalsOf(content)) {
    if (!literal.startsWith('/')) continue
    const parts = literal.split(PLACEHOLDER)
    let path = ''
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''
      path += part
      // A placeholder that follows a slash names a segment of the
      // path; a placeholder that follows a name is part of the last
      // segment, and a query string is not a path.
      if (index < parts.length - 1 && part.endsWith('/')) path += '{…}'
    }
    if (path.length < 2) continue
    found.push({ path, file })
  }
  return found
}

/**
 * The literals of a source.
 *
 * A literal is a string or a template; the prose of a comment is not a
 * literal, and the text of a documentation is not read here.
 *
 * @param content the source.
 */
export function literalsOf(content: string): string[] {
  const found: string[] = []
  let index = 0
  while (index < content.length) {
    const character = content[index]
    if (character !== "'" && character !== '"' && character !== '`') {
      index += 1
      continue
    }
    const quote = character
    let literal = ''
    index += 1
    while (index < content.length && content[index] !== quote) {
      if (content[index] === '\\') {
        index += 1
        continue
      }
      // A template holds the expressions of its placeholders; they are
      // not part of the path, and the scanner skips them.
      if (quote === '`' && content[index] === '$' && content[index + 1] === '{') {
        let depth = 1
        index += 2
        while (index < content.length && depth > 0) {
          if (content[index] === '{') depth += 1
          if (content[index] === '}') depth -= 1
          index += 1
        }
        literal += PLACEHOLDER
        continue
      }
      literal += content[index]
      index += 1
    }
    index += 1
    found.push(literal)
  }
  return found
}

/** The paths of the published client of Data. */
export const PUBLISHED_CLIENT = 'packages/data/packages/client/src/index.ts'

/** The paths of the client of the console and of the CLI. */
export const SHARED_CLIENT = 'packages/client/src/data.ts'

/**
 * The paths of the published client that the client of the console and
 * of the CLI does not know.
 *
 * @param published the paths of the published client.
 * @param shared the paths of the shared client.
 */
export function unknownPaths(
  published: readonly ClientPath[],
  shared: readonly ClientPath[]
): string[] {
  const known = new Set(shared.map((entry) => entry.path))
  const unknown: string[] = []
  for (const entry of published) {
    if (known.has(entry.path)) continue
    if (unknown.includes(entry.path)) continue
    unknown.push(entry.path)
  }
  return unknown
}
