/**
 * The documents the images of a deployment read.
 *
 * The images of a release and the templates of a deployment are one
 * release: an image reads the route table of the deployment, the files
 * of its secrets and the variables of its environment, and an image that
 * reads a document it does not know refuses to start.
 *
 * The wizard refuses to run the images of a release with the templates
 * of another commit, and the refusal is right: the templates write the
 * documents, and a document that changed is a document the images of the
 * release do not know.
 *
 * But a commit is more than its documents: a commit that moves the
 * private endpoint of the cache, or that keeps more than one revision of
 * an application, writes the documents of the commit before it. The
 * **contract** is the documents and not the commit: the wizard compares
 * the contract of the checkout with the contract of the release, and the
 * deployment runs the images of the release when the two agree.
 *
 * The contract is read out of the templates as they are written: the
 * templates are HCL, and the reader of the contract reads the text of
 * the templates the way the reader of the variables of a deployment
 * reads it. A template that the reader does not understand is a
 * contract it cannot prove, and a contract it cannot prove is a
 * deployment it refuses.
 *
 * A document is read without its comments and without the addresses of
 * the deployment: a comment is a word for the reader of the templates,
 * and an address is a value of the deployment. A commit that moves the
 * address of a service writes another address and the same document,
 * and the images of the release read the address they are given.
 */

/** The contract of a set of templates. */
export interface TemplatesContract {
  /** The route table the templates write. */
  readonly routeTable: string | null
  /** The bindings of Data the templates write. */
  readonly bindings: string | null
  /** The tokens of the control plane the templates write. */
  readonly controlTokens: string | null
  /** The credentials of the access context the templates write. */
  readonly accessContextTokens: string | null
  /** The names of the secrets of the deployment. */
  readonly secretNames: readonly string[]
  /** The files of the secrets each service reads. */
  readonly secretFiles: Readonly<Record<string, readonly string[]>>
  /** The names of the files of the secrets, when a file is not named after its secret. */
  readonly secretFileNames: Readonly<Record<string, string>>
  /** The variables of the environment of each service that carry a secret. */
  readonly envSecrets: Readonly<Record<string, readonly string[]>>
  /** The variables of the environment of each service. */
  readonly envNames: Readonly<Record<string, readonly string[]>>
}

/** The services of the deployment, and the files of the secrets they read. */
const SECRET_FILES: Readonly<Record<string, string>> = {
  access: 'access_secret_files',
  control: 'control_secret_files',
  data: 'data_secret_files',
  gateway: 'gateway_secret_files',
}

/** The services of the deployment, and the variables that carry a secret. */
const ENV_SECRETS: Readonly<Record<string, string>> = {
  access: 'access_env_secrets',
  console: 'console_env_secrets',
  control: 'control_env_secrets',
  data: 'data_env_secrets',
  gateway: 'gateway_env_secrets',
}

/** The brackets of HCL, and the bracket that closes them. */
const CLOSERS: Readonly<Record<string, string>> = {
  '{': '}',
  '[': ']',
  '(': ')',
}

/**
 * The contract of a set of templates.
 *
 * The files are the files of the templates, by their name. The contract
 * is what the templates write for the images to read, and nothing else:
 * the values of the deployment, the resources of the cloud and the
 * comments of the templates are not documents the images read.
 *
 * @param files the files of the templates.
 */
export function contractOf(files: Readonly<Record<string, string>>): TemplatesContract {
  const contents = Object.values(files)
  const secretFiles: Record<string, readonly string[]> = {}
  for (const [service, name] of Object.entries(SECRET_FILES)) {
    secretFiles[service] = stringsOf(documentOf(blockOf(contents, name)))
  }
  const envSecrets: Record<string, readonly string[]> = {}
  for (const [service, name] of Object.entries(ENV_SECRETS)) {
    envSecrets[service] = keysOf(documentOf(blockOf(contents, name)))
  }
  const envNames: Record<string, readonly string[]> = {}
  for (const [service, block] of Object.entries(appsOf(contents))) {
    envNames[service] = [...literalsOf(block, 'env'), ...literalsOf(block, 'secret')]
  }
  return {
    routeTable: documentOf(blockOf(contents, 'gateway_route_table')),
    bindings: documentOf(blockOf(contents, 'data_gateway_bindings')),
    controlTokens: documentOf(blockOf(contents, 'control_tokens')),
    accessContextTokens: documentOf(blockOf(contents, 'access_context_tokens')),
    secretNames: stringsOf(documentOf(blockOf(contents, 'secret_names'))),
    secretFiles,
    secretFileNames: pairsOf(documentOf(blockOf(contents, 'secret_file_names'))),
    envSecrets,
    envNames,
  }
}

/**
 * The ways the two contracts differ.
 *
 * The list is empty when the two contracts agree, and every way they
 * differ is a sentence the operator reads: a document that changed is a
 * document the images of the release do not know.
 *
 * @param here the contract of the checkout.
 * @param there the contract of the release.
 */
export function differencesOf(
  here: TemplatesContract,
  there: TemplatesContract
): readonly string[] {
  const differences: string[] = []
  if (!sameDocument(here.routeTable, there.routeTable)) {
    differences.push('the route table the templates write is not the one of the release')
  }
  if (!sameDocument(here.bindings, there.bindings)) {
    differences.push('the bindings of Data the templates write are not the ones of the release')
  }
  if (!sameDocument(here.controlTokens, there.controlTokens)) {
    differences.push('the tokens of the control plane are not the ones of the release')
  }
  if (!sameDocument(here.accessContextTokens, there.accessContextTokens)) {
    differences.push('the credentials of the access context are not the ones of the release')
  }
  if (!sameNames(here.secretNames, there.secretNames)) {
    differences.push('the names of the secrets are not the ones of the release')
  }
  for (const [service] of Object.entries(SECRET_FILES)) {
    if (!sameNames(here.secretFiles[service] ?? [], there.secretFiles[service] ?? [])) {
      differences.push(
        `the files of the secrets the ${service} reads are not the ones of the release`
      )
    }
  }
  for (const [name, file] of Object.entries(here.secretFileNames)) {
    if (there.secretFileNames[name] !== file) {
      differences.push(`the file of the secret "${name}" is not the one of the release`)
    }
  }
  for (const name of Object.keys(there.secretFileNames)) {
    if (here.secretFileNames[name] === undefined) {
      differences.push(`the file of the secret "${name}" is not the one of the release`)
    }
  }
  for (const [service] of Object.entries(ENV_SECRETS)) {
    if (!sameNames(here.envSecrets[service] ?? [], there.envSecrets[service] ?? [])) {
      differences.push(
        `the variables of the environment of the ${service} that carry a secret are not the ones of the release`
      )
    }
  }
  for (const [service, names] of Object.entries(here.envNames)) {
    if (!sameNames(names, there.envNames[service] ?? [])) {
      differences.push(
        `the variables of the environment of the ${service} are not the ones of the release`
      )
    }
  }
  for (const service of Object.keys(there.envNames)) {
    if (here.envNames[service] === undefined) {
      differences.push(
        `the variables of the environment of the ${service} are not the ones of the release`
      )
    }
  }
  return differences
}

/**
 * Whether two documents are the same document.
 *
 * The documents are compared by their tokens: a document that was
 * written with another layout is the same document, and a document
 * whose words changed is another document.
 *
 * @param here the document of the checkout.
 * @param there the document of the release.
 */
function sameDocument(here: string | null, there: string | null): boolean {
  if (here === null || there === null) return here === there
  const left = tokensOf(here)
  const right = tokensOf(there)
  return left.length === right.length && left.every((token, index) => token === right[index])
}

/**
 * The tokens of a document.
 *
 * A token is a word, a number, a string or a mark: the layout of the
 * document is not a token, and neither is a comment.
 *
 * @param document the document.
 */
function tokensOf(document: string): readonly string[] {
  const tokens: string[] = []
  let index = 0
  while (index < document.length) {
    const char = document[index]!
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"') {
      const end = endOfString(document, index)
      tokens.push(document.slice(index, end))
      index = end
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index
      while (end < document.length && /[A-Za-z0-9_]/.test(document[end]!)) end += 1
      tokens.push(document.slice(index, end))
      index = end
      continue
    }
    if (/[0-9]/.test(char)) {
      let end = index
      while (end < document.length && /[0-9.]/.test(document[end]!)) end += 1
      tokens.push(document.slice(index, end))
      index = end
      continue
    }
    tokens.push(char)
    index += 1
  }
  return tokens
}

/**
 * Whether two lists of names are the same names.
 *
 * The order of the names is not a difference: a deployment that writes
 * the secrets in another order writes the same documents.
 *
 * @param here the names of the checkout.
 * @param there the names of the release.
 */
function sameNames(here: readonly string[], there: readonly string[]): boolean {
  if (here.length !== there.length) return false
  const left = [...here].sort()
  const right = [...there].sort()
  return left.every((name, index) => name === right[index])
}

/**
 * The text of the value of an assignment, with the brackets around it.
 *
 * The value may be wrapped in a call: `toset([...])` and `tomap({...})`
 * are values, and the brackets inside them are the value.
 *
 * @param contents the files of the templates.
 * @param name the name of the assignment.
 */
function blockOf(contents: readonly string[], name: string): string | null {
  const pattern = new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*`, 'm')
  for (const content of contents) {
    const match = pattern.exec(content)
    if (!match) continue
    const from = match.index + match[0].length
    const region = regionOf(content, from)
    if (region === null) continue
    return region
  }
  return null
}

/**
 * The document the templates write.
 *
 * The document is the region of the templates without its comments and
 * without the addresses of the deployment: a comment is a word for the
 * reader of the templates, and an address is a value of the deployment.
 * A commit that moves the address of a service writes another address
 * and the same document, and the images of the release read the address
 * they are given.
 *
 * The fields of the document and the values that are not addresses are
 * kept: the images read them, and a document that changed is a
 * document the images of the release do not know.
 *
 * @param region the region of the templates.
 */
function documentOf(region: string | null): string | null {
  if (region === null) return null
  let document = ''
  let index = 0
  while (index < region.length) {
    const char = region[index]!
    if (char === '"') {
      const end = endOfString(region, index)
      document += addressIn(region.slice(index, end))
      index = end
      continue
    }
    if (char === '#' || (char === '/' && region[index + 1] === '/')) {
      index = endOfLine(region, index)
      continue
    }
    if (char === '/' && region[index + 1] === '*') {
      index = endOfComment(region, index)
      continue
    }
    document += char
    index += 1
  }
  return document
}

/**
 * The region of a value: the first bracket of the value and its match.
 *
 * @param content the file of the templates.
 * @param from the place the value starts at.
 */
function regionOf(content: string, from: number): string | null {
  let index = from
  while (index < content.length && /\s/.test(content[index]!)) index += 1
  const char = content[index]
  if (char === undefined) return null
  if (char === '(') {
    // The value is wrapped in a call: the brackets inside it are the
    // value.
    const close = closingOf(content, index)
    if (close === -1) return null
    return regionOf(content.slice(index + 1, close), 0)
  }
  if (char === '[' || char === '{') {
    const close = closingOf(content, index)
    if (close === -1) return null
    return content.slice(index, close + 1)
  }
  if (!/[A-Za-z_]/.test(char)) return null
  // The value is the result of a call: the brackets inside the call are
  // the value.
  const open = content.indexOf('(', index)
  if (open === -1) return null
  const close = closingOf(content, open)
  if (close === -1) return null
  return regionOf(content.slice(open + 1, close), 0)
}

/**
 * The place the bracket that opens at the place given is closed.
 *
 * The strings and the comments of HCL are skipped: a bracket in a
 * string is a character, and a bracket in a comment is a comment.
 *
 * @param content the file of the templates.
 * @param open the place the bracket opens at.
 */
function closingOf(content: string, open: number): number {
  const stack: string[] = []
  let index = open
  while (index < content.length) {
    const char = content[index]!
    if (char === '"') {
      index = endOfString(content, index)
      continue
    }
    if (char === '#' || (char === '/' && content[index + 1] === '/')) {
      index = endOfLine(content, index)
      continue
    }
    if (char === '/' && content[index + 1] === '*') {
      index = endOfComment(content, index)
      continue
    }
    if (CLOSERS[char] !== undefined) {
      stack.push(CLOSERS[char]!)
      index += 1
      continue
    }
    if (char === '}' || char === ']' || char === ')') {
      const expected = stack.pop()
      if (expected === char && stack.length === 0) return index
      index += 1
      continue
    }
    index += 1
  }
  return -1
}

/**
 * The place the string that opens at the place given ends.
 *
 * @param content the file of the templates.
 * @param open the place the string opens at.
 */
function endOfString(content: string, open: number): number {
  let index = open + 1
  while (index < content.length) {
    const char = content[index]!
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return index + 1
    index += 1
  }
  return content.length
}

/**
 * The place the line that starts at the place given ends.
 *
 * @param content the file of the templates.
 * @param open the place the line starts at.
 */
function endOfLine(content: string, open: number): number {
  const end = content.indexOf('\n', open)
  return end === -1 ? content.length : end + 1
}

/**
 * The place the comment that starts at the place given ends.
 *
 * @param content the file of the templates.
 * @param open the place the comment starts at.
 */
function endOfComment(content: string, open: number): number {
  const end = content.indexOf('*/', open)
  return end === -1 ? content.length : end + 2
}

/**
 * The address of a service, and what is left of it.
 *
 * The address of a service is a value of the deployment: the images of
 * a release read the address they are given, and the address is not a
 * part of the document they know. The scheme of the address is kept:
 * the scheme says how the address is read.
 *
 * @param text the string of the templates, with its quotes.
 */
function addressIn(text: string): string {
  const match = /^"([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^"]*"$/.exec(text)
  if (match === null) return text
  return `"${match[1]}<address>"`
}

/**
 * The strings of a region.
 *
 * @param region the region of the templates.
 */
function stringsOf(region: string | null): readonly string[] {
  if (region === null) return []
  const found: string[] = []
  for (const match of region.matchAll(/"([^"]*)"/g)) found.push(match[1]!)
  return found
}

/**
 * The keys of a map of strings.
 *
 * @param region the region of the templates.
 */
function keysOf(region: string | null): readonly string[] {
  if (region === null) return []
  const found: string[] = []
  for (const match of region.matchAll(/(?:^|[{,\s])([A-Za-z_][A-Za-z0-9_]*|"[^"]*")\s*=[^=]/g)) {
    found.push(match[1]!.replace(/^"|"$/g, ''))
  }
  return found
}

/**
 * The pairs of a map of strings.
 *
 * @param region the region of the templates.
 */
function pairsOf(region: string | null): Readonly<Record<string, string>> {
  const pairs: Record<string, string> = {}
  if (region === null) return pairs
  for (const match of region.matchAll(/"([^"]*)"\s*=\s*"([^"]*)"/g)) {
    pairs[match[1]!] = match[2]!
  }
  return pairs
}

/**
 * The applications of the deployment, and the block of each of them.
 *
 * @param contents the files of the templates.
 */
function appsOf(contents: readonly string[]): Record<string, string> {
  const apps: Record<string, string> = {}
  for (const content of contents) {
    const pattern = /resource\s+"azurerm_container_app"\s+"([^"]+)"\s*\{/g
    for (const match of content.matchAll(pattern)) {
      const open = match.index + match[0].length - 1
      const close = closingOf(content, open)
      if (close === -1) continue
      apps[match[1]!] = content.slice(open, close + 1)
    }
  }
  return apps
}

/**
 * The names the blocks of a keyword hold.
 *
 * The block of a `dynamic` block is not a block of the keyword: the
 * names of a dynamic block are the names of the map it reads, and the
 * map is a part of the contract on its own.
 *
 * @param block the block of the application.
 * @param keyword the keyword of the blocks.
 */
function literalsOf(block: string, keyword: string): readonly string[] {
  const found: string[] = []
  const pattern = new RegExp(`\\b${keyword}\\s*\\{([^{}]*)\\}`, 'g')
  for (const match of block.matchAll(pattern)) {
    for (const name of match[1]!.matchAll(/name\s*=\s*"([^"]+)"/g)) found.push(name[1]!)
  }
  return found
}
