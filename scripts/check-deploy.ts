#!/usr/bin/env bun
/**
 * The check of the directory of the deployment.
 *
 * Every file of a deployment is in `deploy/`, and the three services of
 * the platform are deployed there **on their own** and as part of the
 * **composition** of the three.
 *
 * A file that drifts out of the directory is a file that nobody owns,
 * and a stack that names a service with another name, or a port with
 * another port, is a stack that does not deploy the same thing as the
 * composition. The check answers three questions:
 *
 * - Is every file of a deployment in `deploy/`?
 * - Is every service of the platform deployed on its own and in the
 *   composition, with the same name, the same port and the same
 *   variables of the environment?
 * - Do the files the stacks mount exist, and do the images they run
 *   carry the version of the platform?
 * - Does the minimum environment of the platform hold every variable a
 *   stack refuses to start without?
 * - Do the templates of the deployment hold every variable in their
 *   example, and do they name no file of a deployment?
 * - Are the credentials the templates generate strong enough for the
 *   services that read them?
 * - Does the console of the deployment know the address of every
 *   service it probes?
 * - Does the console of the deployment hold the credentials that Access
 *   knows, and only those?
 *
 *   bun run deploy:check
 */

import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { secretBytes } from '../packages/gateway/src/runtime/env/read'
import { git } from '../tooling/compatibility/reference'

/** A disagreement between the directory of the deployment and the platform. */
export interface DeployFinding {
  /** The file the disagreement was found in. */
  file: string
  /** What it says and what it should say. */
  message: string
}

/** The services of the platform, and the port each of them listens on. */
export const SERVICES = {
  gateway: {
    port: 8080,
    image: 'ghcr.io/ggpwnkthx/gateway',
    variables: [
      'GATEWAY_CONFIG',
      'GATEWAY_OIDC_ISSUER',
      'GATEWAY_OIDC_CLIENT_ID',
      'GATEWAY_OIDC_CLIENT_SECRET',
      'GATEWAY_OIDC_REDIRECT_URI',
      'GATEWAY_ACCESS_URL',
      'GATEWAY_ACCESS_TOKEN',
      'GATEWAY_SESSION_SECRET',
      'GATEWAY_IDENTITY_SIGNING_KEY',
    ],
  },
  access: {
    port: 8081,
    image: 'ghcr.io/ggpwnkthx/access',
    variables: [
      'ACCESS_ENVIRONMENT',
      'ACCESS_HOST',
      'ACCESS_PORT',
      'ACCESS_ISSUER',
      'ACCESS_DATABASE_URL',
      'ACCESS_REDIS_URL',
      'ACCESS_ADMIN_TOKEN',
      'ACCESS_DECISION_TOKEN',
      'ACCESS_CONTEXT_TOKENS',
      'ACCESS_STATE_SECRET',
      'ACCESS_SECRET_ENCRYPTION_KEY',
    ],
  },
  data: {
    port: 8082,
    image: 'ghcr.io/ggpwnkthx/data',
    variables: [
      'DATA_ENVIRONMENT',
      'DATA_HOST',
      'DATA_PORT',
      'DATA_PROCESS_ROLE',
      'DATA_DATABASE_URL',
      'DATA_REGISTRY_DATABASE_URL',
      'DATA_SCHEMA_BUNDLE_FILE',
      'DATA_POLICY_BUNDLE_FILE',
      'DATA_GATEWAY_BINDINGS_FILE',
      'DATA_ACCESS_URL',
      'DATA_ACCESS_CONTEXT_TOKEN_FILE',
      'DATA_CURSOR_KEY_FILE',
    ],
  },
} as const

/** The name of a service of the platform. */
export type Service = keyof typeof SERVICES

/** The names of the services of the platform. */
export const SERVICE_NAMES = Object.keys(SERVICES) as Service[]

/** The directory of the deployment. */
const DEPLOY = 'deploy'

/**
 * The file that holds the minimum environment of the platform.
 *
 * It holds the variables a stack refuses to start without, with the
 * example values of a development machine.
 */
export const MINIMUM_ENVIRONMENT = '.env.min'

/** The stacks of a machine. */
const COMPOSE = join(DEPLOY, 'compose')

/** The stacks of a deployment. */
const PRODUCTION = join(COMPOSE, 'production')

/** The manifests of a cluster. */
const KUBERNETES = join(DEPLOY, 'kubernetes')

/** The directory of the infrastructure as code. */
const TOFU = join(DEPLOY, 'tofu')

/** The templates of the deployment on Azure. */
const TEMPLATES = join(TOFU, 'azure')

/** The stack that creates the place where the state of a deployment lives. */
const BOOTSTRAP = join(TEMPLATES, 'bootstrap')

/** The files of a deployment: they belong to one deployment. */
const RUNTIME = join(TOFU, 'runtime')

/**
 * The files the templates of a deployment are made of.
 *
 * The list is the shape of the deployment: a template that is missing is
 * a part of the deployment that nobody wrote, and a file that is not in
 * the list is a file that nobody owns.
 */
export const TEMPLATE_FILES: readonly string[] = [
  'versions.tf',
  'providers.tf',
  'variables.tf',
  'locals.tf',
  'network.tf',
  'registry.tf',
  'observability.tf',
  'postgres.tf',
  'redis.tf',
  'keyvault.tf',
  'identity.tf',
  'containerapps.tf',
  'edge.tf',
  'dns.tf',
  'outputs.tf',
  'terraform.tfvars.example',
  '.terraform.lock.hcl',
]

/**
 * The files of the bootstrap.
 *
 * The bootstrap is a stack of its own, and it has the same shape as the
 * templates: the versions of the tools, the stack itself, the example
 * of the values and the lock of the providers.
 */
export const BOOTSTRAP_FILES: readonly string[] = [
  'versions.tf',
  'main.tf',
  'terraform.tfvars.example',
  '.terraform.lock.hcl',
]

/** The name of the file that holds the example of the values of a stack. */
const EXAMPLE = 'terraform.tfvars.example'

/** The name of the file that holds the lock of the providers. */
const LOCK = '.terraform.lock.hcl'

/** The pattern of the digest of an image. */
const DIGEST = /@sha256:[0-9a-f]{64}$/

/**
 * The variables the console of the deployment names to reach the
 * services it probes.
 *
 * The console shows the state of the three services of the platform on
 * its status board, and it reads each of them at the address its
 * environment names. The variable of each of them is the one the
 * console reads the address of that service in.
 */
const CONSOLE_PROBES: readonly string[] = [
  'CONSOLE_ACCESS_URL',
  'CONSOLE_GATEWAY_URL',
  'CONSOLE_DATA_URL',
]

/** A value of a yaml that is not known. */
type Unknown = Record<string, unknown>

/** Reads the documents of a yaml and reports the file when it does not parse. */
function readDocuments(root: string, file: string, findings: DeployFinding[]): Unknown[] {
  const path = join(root, file)
  let documents: Unknown[]
  try {
    const parsed = parseAllDocuments(readFileSync(path, 'utf8'))
    const problems = parsed.flatMap((document) => document.errors).map((error) => error.message)
    if (problems.length > 0) {
      findings.push({ file, message: `the file is not a valid yaml: ${problems[0]}` })
      return []
    }
    documents = parsed.map((document) => document.toJS() as unknown)
  } catch (error) {
    findings.push({ file, message: `the file is not a valid yaml: ${(error as Error).message}` })
    return []
  }
  return documents.filter(
    (document): document is Unknown => typeof document === 'object' && document !== null
  )
}

/** The files of a directory, with the suffix they carry. */
async function filesOf(root: string, directory: string, suffix: string): Promise<string[]> {
  const path = join(root, directory)
  if (!existsSync(path)) return []
  const entries = await readdir(path, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(root, child, suffix)))
      continue
    }
    if (entry.name.endsWith(suffix)) found.push(child)
  }
  return found.sort()
}

/** The services of a stack, and the environment of each of them. */
interface Stack {
  /** The file of the stack. */
  file: string
  /** The services of the stack. */
  services: Record<string, Unknown>
}

/** Reads a stack of compose. */
function readStack(root: string, file: string, findings: DeployFinding[]): Stack | null {
  const documents = readDocuments(root, file, findings)
  const document = documents[0]
  if (document === undefined) return null
  const services = document.services
  if (typeof services !== 'object' || services === null) {
    findings.push({ file, message: 'the stack holds no services' })
    return null
  }
  return { file, services: services as Record<string, Unknown> }
}

/** The names of the variables of the environment of a service. */
function variablesOf(service: Unknown): string[] {
  const environment = service.environment
  if (typeof environment !== 'object' || environment === null) return []
  if (Array.isArray(environment)) {
    return environment
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.split('=')[0]!)
  }
  return Object.keys(environment as Unknown)
}

/** The ports a service publishes. */
function portsOf(service: Unknown): string[] {
  const ports = service.ports
  if (!Array.isArray(ports)) return []
  return ports
    .map((port) => (typeof port === 'string' ? port : `${(port as Unknown).published}`))
    .map((port) => port.split(':')[0]!)
}

/** The volumes a service mounts. */
function volumesOf(service: Unknown): string[] {
  const volumes = service.volumes
  if (!Array.isArray(volumes)) return []
  return volumes
    .map((volume) => (typeof volume === 'string' ? volume : `${(volume as Unknown).source}`))
    .filter((volume): volume is string => typeof volume === 'string')
}

/**
 * Checks that every file of a deployment is in the directory of the
 * deployment.
 *
 * A workspace that holds a `deploy` directory is a workspace that
 * deploys something else than the platform, and the reader of the
 * repository has two places to look.
 */
export function checkLayout(root: string): DeployFinding[] {
  const findings: DeployFinding[] = []
  for (const workspace of ['access', 'data', 'gateway']) {
    const directory = join(root, 'packages', workspace, 'deploy')
    if (existsSync(directory)) {
      findings.push({
        file: `packages/${workspace}/deploy`,
        message: 'the deployment files are in the directory of the deployment',
      })
    }
  }
  for (const file of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml']) {
    if (existsSync(join(root, file))) {
      findings.push({
        file,
        message: 'the deployment files are in the directory of the deployment',
      })
    }
  }
  for (const directory of [COMPOSE, KUBERNETES, join(DEPLOY, 'config')]) {
    if (!existsSync(join(root, directory))) {
      findings.push({ file: directory, message: 'the directory of the deployment is not there' })
    }
  }
  return findings
}

/**
 * Checks that every service of the platform is deployed on its own and
 * in the composition.
 *
 * The stacks of a machine and the stacks of a deployment are checked
 * the same way: the name of the service, the port it publishes and the
 * variables of its environment are the same in the stack of the service
 * and in the composition.
 */
export async function checkStacks(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const stacks = [
    ...(await filesOf(root, COMPOSE, '.compose.yaml')),
    ...(await filesOf(root, PRODUCTION, '.compose.yaml')),
  ]
  if (stacks.length === 0) {
    findings.push({ file: COMPOSE, message: 'there is no stack of a machine' })
    return findings
  }

  const read = new Map<string, Stack | null>()
  for (const file of stacks) {
    read.set(file, readStack(root, file, findings))
  }

  for (const service of SERVICE_NAMES) {
    const { port, variables } = SERVICES[service]
    for (const directory of [COMPOSE, PRODUCTION]) {
      const own = join(directory, `${service}.compose.yaml`)
      const composition = join(directory, 'platform.compose.yaml')
      for (const file of [own, composition]) {
        const stack = read.get(file)
        if (stack === undefined) {
          findings.push({ file, message: 'the stack of the service is not there' })
          continue
        }
        if (stack === null) continue
        const definition = stack.services[service]
        if (definition === undefined) {
          findings.push({ file, message: `the stack does not deploy the ${service}` })
          continue
        }
        if (!portsOf(definition).includes(String(port))) {
          findings.push({
            file,
            message: `the ${service} does not publish the port ${port}`,
          })
        }
        const names = variablesOf(definition)
        for (const variable of variables) {
          if (!names.includes(variable)) {
            findings.push({
              file,
              message: `the ${service} does not name the variable ${variable}`,
            })
          }
        }
      }
    }
  }

  // The stack of a service deploys that service and nothing else of the
  // platform: a stack that brings another service of the platform with it
  // is not a deployment of one service.
  for (const service of SERVICE_NAMES) {
    for (const directory of [COMPOSE, PRODUCTION]) {
      const file = join(directory, `${service}.compose.yaml`)
      const stack = read.get(file)
      if (stack === undefined || stack === null) continue
      for (const other of SERVICE_NAMES) {
        if (other === service) continue
        if (stack.services[other] !== undefined) {
          findings.push({
            file,
            message: `the stack of the ${service} deploys the ${other}: the service is deployed on its own`,
          })
        }
      }
    }
  }
  return findings
}

/**
 * Checks that the files the stacks mount are there, and that the images
 * they run carry the version of the platform.
 */
export async function checkFiles(root: string, version: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const stacks = [
    ...(await filesOf(root, COMPOSE, '.compose.yaml')),
    ...(await filesOf(root, PRODUCTION, '.compose.yaml')),
  ]

  for (const file of stacks) {
    const stack = readStack(root, file, findings)
    if (stack === null) continue
    const directory = dirname(file)

    for (const [name, definition] of Object.entries(stack.services)) {
      const service = definition as Unknown

      const build = service.build
      if (typeof build === 'object' && build !== null) {
        const context = (build as Unknown).context
        const dockerfile = (build as Unknown).dockerfile
        if (typeof context === 'string' && !context.includes('${')) {
          const path = resolve(root, directory, context)
          if (!existsSync(path)) {
            findings.push({ file, message: `the context of the ${name} is not there: ${context}` })
          } else if (typeof dockerfile === 'string' && !dockerfile.includes('${')) {
            const file2 = resolve(path, dockerfile)
            if (!existsSync(file2)) {
              findings.push({
                file,
                message: `the image of the ${name} is not there: ${dockerfile}`,
              })
            }
          }
        }
      }

      const volumes = volumesOf(service)
      for (const volume of volumes) {
        const source = volume.split(':')[0]!
        if (!source.startsWith('.') && !source.startsWith('/')) continue
        if (source.includes('${')) continue
        const path = resolve(root, directory, source)
        if (!existsSync(path)) {
          findings.push({ file, message: `the ${name} mounts a file that is not there: ${source}` })
        }
      }
    }

    // The files of the secrets of the stack.
    const document = readDocuments(root, file, findings)[0]
    if (document === undefined) continue
    const secrets = document.secrets
    if (typeof secrets === 'object' && secrets !== null) {
      for (const [name, secret] of Object.entries(secrets as Unknown)) {
        const path = (secret as Unknown)?.file
        if (typeof path !== 'string' || path.includes('${')) continue
        const resolved = resolve(root, directory, path)
        if (!existsSync(resolved)) {
          findings.push({ file, message: `the secret ${name} is not there: ${path}` })
        }
      }
    }

    // The images of the stack carry the version of the platform.
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/image:\s*(\S+)/g)) {
      const image = match[1]!
      if (!image.startsWith('ghcr.io/ggpwnkthx/')) continue
      const tag = image.split(':')[1]
      if (tag !== version) {
        findings.push({
          file,
          message: `the image ${image} does not carry the version ${version} of the platform`,
        })
      }
    }
  }
  return findings
}

/**
 * Checks the manifests of a cluster.
 *
 * Every base is a deployment of its own, the overlay composes the three,
 * and the names of the resources of the three do not collide: a
 * composition of two bases that name a service the same way is a
 * composition that deploys one of them twice.
 */
export async function checkManifests(root: string, version: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const bases = join(KUBERNETES, 'base')
  if (!existsSync(join(root, bases))) {
    findings.push({ file: bases, message: 'the bases of the manifests are not there' })
    return findings
  }

  const directories = await filesOf(root, bases, '.yaml')
  const names = new Map<string, string>()

  for (const service of SERVICE_NAMES) {
    const base = join(bases, service)
    if (!existsSync(join(root, base))) {
      findings.push({ file: base, message: 'the base of the service is not there' })
      continue
    }
    const kustomization = join(base, 'kustomization.yaml')
    if (!existsSync(join(root, kustomization))) {
      findings.push({
        file: kustomization,
        message: 'the base of the service has no kustomization',
      })
      continue
    }
    const document = readDocuments(root, kustomization, findings)[0]
    if (document === undefined) continue
    const resources = document.resources
    if (!Array.isArray(resources) || resources.length === 0) {
      findings.push({ file: kustomization, message: 'the base of the service holds no resource' })
      continue
    }
    for (const resource of resources) {
      if (typeof resource !== 'string') continue
      const path = resolve(root, base, resource)
      if (!existsSync(path)) {
        findings.push({ file: kustomization, message: `the resource is not there: ${resource}` })
      }
    }
  }

  // The names of the resources of the three bases do not collide.
  for (const file of directories) {
    for (const document of readDocuments(root, file, findings)) {
      const metadata = document.metadata
      if (typeof metadata !== 'object' || metadata === null) continue
      const name = (metadata as Unknown).name
      const kind = document.kind
      if (typeof name !== 'string' || typeof kind !== 'string') continue
      const key = `${kind}/${name}`
      const owner = names.get(key)
      if (owner !== undefined) {
        findings.push({
          file,
          message: `the resource ${key} is named by ${owner} as well: the composition deploys it twice`,
        })
        continue
      }
      names.set(key, file)
    }
  }

  // The images of the manifests carry the version of the platform.
  for (const file of directories) {
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/image:\s*(\S+)/g)) {
      const image = match[1]!
      if (!image.startsWith('ghcr.io/ggpwnkthx/')) continue
      const tag = image.split(':')[1]
      if (tag !== version) {
        findings.push({
          file,
          message: `the image ${image} does not carry the version ${version} of the platform`,
        })
      }
    }
  }

  // The overlay composes the three bases.
  const overlay = join(KUBERNETES, 'overlays', 'platform', 'kustomization.yaml')
  if (!existsSync(join(root, overlay))) {
    findings.push({ file: overlay, message: 'the composition of the manifests is not there' })
    return findings
  }
  const document = readDocuments(root, overlay, findings)[0]
  if (document === undefined) return findings
  const resources = document.resources
  if (!Array.isArray(resources)) {
    findings.push({ file: overlay, message: 'the composition holds no resource' })
    return findings
  }
  for (const service of SERVICE_NAMES) {
    const base = `../../base/${service}`
    if (!resources.includes(base)) {
      findings.push({ file: overlay, message: `the composition does not hold the ${service}` })
    }
  }
  for (const resource of resources) {
    if (typeof resource !== 'string') continue
    const path = resolve(root, dirname(overlay), resource)
    if (!existsSync(path)) {
      findings.push({ file: overlay, message: `the resource is not there: ${resource}` })
    }
  }
  return findings
}

/** The version of the platform. */
function readVersion(root: string): string {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string
  }
  return packageJson.version ?? '0.0.0'
}

/**
 * The variables a stack refuses to start without.
 *
 * A stack names them with `${VARIABLE:?the message of the operator}`:
 * the stack stops before the first request when the variable is not in
 * the environment.
 */
export function requiredVariablesOf(stack: string): string[] {
  const names = new Set<string>()
  for (const match of stack.matchAll(/\$\{([A-Z0-9_]+):\?/g)) {
    names.add(match[1]!)
  }
  return [...names].sort()
}

/**
 * The variables a file of the environment sets.
 *
 * A line that is empty, that is a comment or that holds no value sets
 * nothing: the value of a variable that is commented out is the one of
 * the example of the service, and not the one of the file.
 */
export function variablesSetBy(environment: string): string[] {
  const names = new Set<string>()
  for (const line of environment.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator).trim()
    if (!/^[A-Z0-9_]+$/.test(name)) continue
    if (trimmed.slice(separator + 1).trim() === '') continue
    names.add(name)
  }
  return [...names].sort()
}

/**
 * Checks that the minimum environment holds every variable a stack
 * requires.
 *
 * The file is the answer to the question "what does the platform need
 * to come up", and a variable that a stack requires and the file does
 * not hold is a variable that the operator discovers when the stack is
 * already down.
 */
export async function checkMinimumEnvironment(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  let environment: string
  try {
    environment = await readFile(join(root, MINIMUM_ENVIRONMENT), 'utf8')
  } catch {
    return [
      {
        file: MINIMUM_ENVIRONMENT,
        message: 'the minimum environment of the platform is not there',
      },
    ]
  }
  const declared = new Set(variablesSetBy(environment))

  const stacks = [
    ...(await filesOf(root, COMPOSE, '.compose.yaml')),
    ...(await filesOf(root, PRODUCTION, '.compose.yaml')),
  ]
  for (const file of stacks) {
    for (const variable of requiredVariablesOf(readFileSync(join(root, file), 'utf8'))) {
      if (declared.has(variable)) continue
      findings.push({
        file: MINIMUM_ENVIRONMENT,
        message: `the variable ${variable} is not set: the stack ${file} refuses to start without it`,
      })
    }
  }
  return findings
}

/**
 * The files of a directory, recursively.
 *
 * The directories whose name starts with a dot are not walked: they are
 * the working directories of the tools, and they hold the code of the
 * tools and not the code of the platform.
 */
async function filesUnder(root: string, directory: string): Promise<string[]> {
  const path = join(root, directory)
  if (!existsSync(path)) return []
  const entries = await readdir(path, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(root, child)))
      continue
    }
    found.push(child)
  }
  return found.sort()
}

/**
 * The files of the templates that the index of the repository holds.
 *
 * The check reads the index and not the tree: the files of a
 * deployment are in the tree of the machine of the operator, and they
 * are never in the index. The index is unknown when the directory is
 * not a repository, and every file is then a file of the repository.
 *
 * @param root the root of the repository.
 */
function trackedTemplates(root: string): Set<string> | undefined {
  const result = git(['ls-files', '--', TOFU], root)
  if (result.status !== 0) return undefined
  const tracked = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const file = line.trim()
    if (file !== '') tracked.add(file)
  }
  return tracked
}

/** The sources of the templates of a stack. */
async function sourcesOf(root: string, directory: string): Promise<string[]> {
  const path = join(root, directory)
  if (!existsSync(path)) return []
  const entries = await readdir(path, { withFileTypes: true })
  const sources: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.tf')) continue
    sources.push(readFileSync(join(path, entry.name), 'utf8'))
  }
  return sources.sort()
}

/** The sources of the templates of a stack, with the file they are in. */
async function sourcesWithNames(
  root: string,
  directory: string
): Promise<{ file: string; source: string }[]> {
  const path = join(root, directory)
  if (!existsSync(path)) return []
  const entries = await readdir(path, { withFileTypes: true })
  const sources: { file: string; source: string }[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.tf')) continue
    sources.push({
      file: join(directory, entry.name),
      source: readFileSync(join(path, entry.name), 'utf8'),
    })
  }
  return sources.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * The brackets a text opens and closes.
 *
 * The brackets inside a string are not brackets: a value of the example
 * may carry one, and the example of a map is read by its brackets.
 */
function bracketsOf(text: string): number {
  let depth = 0
  let quoted = false
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (character === '{' || character === '[') depth += 1
    if (character === '}' || character === ']') depth -= 1
  }
  return depth
}

/**
 * The names the example of the values of a stack assigns.
 *
 * A line that is empty, that is a comment or that holds no value
 * assigns nothing: the value of a variable that is commented out is the
 * one of the example of the service, and not the one of the file.
 *
 * The names inside a value that spans several lines are the names of
 * the value, and not the names of the variables: the example of a map
 * of the sizes of the services holds a name per service, and those
 * names are not variables.
 */
export function assignmentsOf(example: string): string[] {
  const names = new Set<string>()
  let depth = 0
  for (const line of example.split('\n')) {
    const trimmed = line.trim()
    if (depth === 0) {
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const name = trimmed.slice(0, separator).trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name)
      depth += bracketsOf(trimmed.slice(separator + 1))
      continue
    }
    depth += bracketsOf(trimmed)
  }
  return [...names].sort()
}

/** The value the example of the values of a stack gives to a name. */
export function valueOfAssignment(example: string, name: string): string | undefined {
  let depth = 0
  let current: string | undefined
  for (const line of example.split('\n')) {
    const trimmed = line.trim()
    if (depth === 0) {
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      if (trimmed.slice(0, separator).trim() !== name) {
        depth += bracketsOf(trimmed.slice(separator + 1))
        continue
      }
      current = trimmed.slice(separator + 1).trim()
      depth += bracketsOf(current)
      if (depth <= 0) return current.replace(/^"(.*)"$/, '$1')
      continue
    }
    depth += bracketsOf(trimmed)
    if (current === undefined) continue
    current += `\n${line}`
    if (depth <= 0) return current.replace(/^"(.*)"$/, '$1')
  }
  return current
}

/**
 * The variables the templates of a stack declare.
 *
 * A variable that the example of the values does not name is a variable
 * that the operator discovers when the deployment is already running.
 */
export function variablesOfTemplates(sources: readonly string[]): string[] {
  const names = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(/^[ \t]*variable[ \t]+"([^"]+)"[ \t]*\{/gm)) {
      names.add(match[1]!)
    }
  }
  return [...names].sort()
}

/**
 * The images the templates name.
 *
 * An image that a template names is an image that a deployment pulls:
 * an image that is a tag is an image that moves, and a deployment that
 * runs an image that moves runs bytes that nothing proved.
 */
export function imagesOfTemplates(sources: readonly string[]): string[] {
  const images: string[] = []
  for (const source of sources) {
    for (const match of source.matchAll(/(^|[ \t])image[ \t]*=[ \t]*"([^"]+)"/gm)) {
      images.push(match[2]!)
    }
  }
  return images
}

/** The text of a block, from its opening brace to the brace that closes it. */
function blockOf(text: string, open: number): string {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, index)
    }
  }
  return text.slice(open + 1)
}

/**
 * The versions the templates pin the providers to.
 *
 * A provider without a version is a provider that changes under the
 * feet of the deployment, and the state of a deployment is read by the
 * version of the provider that wrote it.
 */
export function providerVersionsOf(versions: string): { provider: string; version: string }[] {
  const start = versions.indexOf('required_providers')
  if (start < 0) return []
  const open = versions.indexOf('{', start)
  if (open < 0) return []
  const block = blockOf(versions, open)
  const found: { provider: string; version: string }[] = []
  for (const match of block.matchAll(/([A-Za-z0-9_]+)[ \t]*=[ \t]*\{/g)) {
    const entry = blockOf(block, match.index + match[0].length - 1)
    const version = entry.match(/version[ \t]*=[ \t]*"([^"]+)"/)?.[1] ?? ''
    found.push({ provider: match[1]!, version })
  }
  return found
}

/**
 * The minimum number of bytes of a credential of the deployment.
 *
 * The services count the bytes of a secret the way they read it, and a
 * service that reads a credential that counts fewer than thirty-two
 * bytes refuses to start. The check counts the bytes the same way the
 * services do.
 */
export const MINIMUM_CREDENTIAL_BYTES = 32

/** A credential that the templates of a deployment generate. */
export interface TemplateCredential {
  /** The name of the resource that generates it. */
  name: string
  /** The file the resource is declared in. */
  file: string
  /** The number of bytes the services count the credential in. */
  bytes: number
  /** Whether a database of the deployment carries the credential. */
  carriedByDatabase: boolean
}

/**
 * Reads the credentials that the templates of a deployment generate.
 *
 * The templates generate two kinds of credential: bytes that are written
 * in hexadecimal, and passphrases that are written as they are. The
 * services count the bytes of the two the way they read them, and the
 * check counts them the same way: a hexadecimal credential is counted in
 * its own bytes, and a passphrase of forty characters is counted in
 * thirty, because forty characters of a passphrase are forty characters
 * of base64.
 */
export function credentialsOfTemplates(
  sources: readonly { file: string; source: string }[]
): TemplateCredential[] {
  const credentials: TemplateCredential[] = []
  const lines = sources.flatMap(({ source }) => source.split('\n'))
  for (const { file, source } of sources) {
    for (const match of source.matchAll(
      /resource\s+"(random_bytes|random_password)"\s+"([a-z0-9_]+)"\s*\{/g
    )) {
      const body = blockOf(source, match.index + match[0].length - 1)
      const length = Number(body.match(/length\s*=\s*(\d+)/)?.[1] ?? '0')
      const special = body.match(/special\s*=\s*(true|false)/)?.[1] === 'true'
      const name = match[2]!
      // The value of a credential of bytes is written in hexadecimal,
      // and the value of a passphrase is written as it is. The check
      // counts the bytes of the value the way the services read it.
      const value =
        match[1] === 'random_bytes'
          ? 'ab'.repeat(length)
          : 'aZ0bZ9cX8dW7eV6uT5sR4qP3oN2mK1jL0hGqP9oN2mK1jL0hGqP9'.repeat(2).slice(0, length)
      // A passphrase that carries a special character is not a part of
      // the alphabet of base64, and it is counted in its whole length.
      const bytes = special ? value.length : secretBytes(value)
      const usages = lines.filter((line) => line.includes(`${match[1]}.${name}.`))
      // A password of a role of a database is carried by the address of
      // the database, and the vault holds it under the name of the
      // password of the role. A service reads the address and not the
      // password.
      const carriedByDatabase =
        usages.length > 0 &&
        usages.every(
          (line) =>
            line.includes('postgres://') ||
            line.includes('administrator_password') ||
            /"[a-z0-9-]*-password"\s*=/.test(line)
        )
      credentials.push({ name, file, bytes, carriedByDatabase })
    }
  }
  return credentials
}

/**
 * Checks that the credentials the templates generate are strong enough.
 *
 * A credential that a service reads is counted in the bytes the service
 * counts it in, and a service refuses to start with a credential of
 * fewer than thirty-two bytes. The check holds the templates to the
 * rule of the services: a deployment that generates a credential that
 * is too short starts a service that stops, and the deployment of the
 * operator is a deployment that is down.
 *
 * The passwords of the roles of the databases are a different thing:
 * they are carried by the address of a database, and a service reads
 * the address and not the password.
 */
export function checkCredentials(
  sources: readonly { file: string; source: string }[]
): DeployFinding[] {
  const findings: DeployFinding[] = []
  for (const credential of credentialsOfTemplates(sources)) {
    if (credential.carriedByDatabase) continue
    if (credential.bytes >= MINIMUM_CREDENTIAL_BYTES) continue
    findings.push({
      file: credential.file,
      message: `the credential ${credential.name} is counted in ${credential.bytes} bytes: a service refuses to start with a credential of fewer than ${MINIMUM_CREDENTIAL_BYTES} bytes`,
    })
  }
  return findings
}

/**
 * Checks that the files of a deployment are not in the templates.
 *
 * The state of a deployment holds the value of every secret of the
 * deployment, and the values of a deployment name one deployment. A file
 * of a deployment that is committed is a credential that everybody
 * reads.
 *
 * The check reads the index of the repository and not the tree: the
 * files of a deployment are in the tree of the machine of the operator,
 * and they are never in the index. The state of the bootstrap lives
 * next to the templates of the bootstrap, and it is not committed: it
 * is the state of the machine of the operator, and the check says
 * nothing about it.
 */
export async function checkRuntimeFiles(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const tracked = trackedTemplates(root)
  for (const file of await filesUnder(root, TOFU)) {
    if (file.startsWith(`${RUNTIME}/`)) continue
    if (tracked !== undefined && !tracked.has(file)) continue
    const name = file.slice(file.lastIndexOf('/') + 1)
    if (name.endsWith('.tfstate') || name.includes('.tfstate.')) {
      findings.push({
        file,
        message: 'the state of a deployment holds the credentials of the deployment',
      })
      continue
    }
    if (name.endsWith('.tfvars') && !name.endsWith('.tfvars.example')) {
      findings.push({
        file,
        message: 'the values of a deployment belong to one deployment and not to the repository',
      })
      continue
    }
    if (name.endsWith('.bin') || name.endsWith('.tfplan')) {
      findings.push({
        file,
        message: 'a plan of a deployment is not a file of the repository',
      })
    }
  }
  return findings
}

/**
 * Checks the templates of the deployment.
 *
 * The templates are the platform's artifacts, and the values of one
 * deployment are not. The check holds three lines:
 *
 * - Every variable of the templates is in the example of the values, and
 *   the example names no variable that the templates do not declare: an
 *   example that is short is an example that stops a deployment, and a
 *   name that is left over is a name that nobody reads.
 * - Every image is a digest: an image that is a tag is an image that
 *   moves.
 * - Every provider is pinned: a provider without a version changes
 *   under the feet of the deployment.
 */
export async function checkInfrastructure(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []

  const stacks: { directory: string; files: readonly string[] }[] = [
    { directory: TEMPLATES, files: TEMPLATE_FILES },
    { directory: BOOTSTRAP, files: BOOTSTRAP_FILES },
  ]

  for (const stack of stacks) {
    for (const file of stack.files) {
      if (!existsSync(join(root, stack.directory, file))) {
        findings.push({
          file: join(stack.directory, file),
          message: 'the file of the templates is not there',
        })
      }
    }
  }
  if (findings.length > 0) return findings

  findings.push(...(await checkRuntimeFiles(root)))

  for (const stack of stacks) {
    const sources = await sourcesOf(root, stack.directory)
    const example = readFileSync(join(root, stack.directory, EXAMPLE), 'utf8')
    const declared = new Set(variablesOfTemplates(sources))
    const assigned = new Set(assignmentsOf(example))

    for (const variable of declared) {
      if (assigned.has(variable)) continue
      findings.push({
        file: join(stack.directory, EXAMPLE),
        message: `the variable ${variable} is not in the example of the values`,
      })
    }
    for (const name of assigned) {
      if (declared.has(name)) continue
      findings.push({
        file: join(stack.directory, EXAMPLE),
        message: `the example names ${name}, which the templates do not declare`,
      })
    }

    // The images are digests. The value of an image is in the example of
    // the values, and the image of a template that is written down is a
    // value of the platform that nobody proved.
    for (const variable of declared) {
      if (!variable.endsWith('_image')) continue
      const value = valueOfAssignment(example, variable)
      if (value === undefined) continue
      if (DIGEST.test(value)) continue
      findings.push({
        file: join(stack.directory, EXAMPLE),
        message: `the image ${variable} is not a digest: the deployment runs the bytes that the release proved`,
      })
    }
    for (const image of imagesOfTemplates(sources)) {
      if (image.includes('${')) continue
      if (DIGEST.test(image)) continue
      findings.push({
        file: stack.directory,
        message: `the image ${image} is not a digest`,
      })
    }

    // The providers are pinned.
    const versions = sources.find((source) => source.includes('required_providers')) ?? ''
    for (const { provider, version } of providerVersionsOf(versions)) {
      if (version !== '') continue
      findings.push({
        file: join(stack.directory, 'versions.tf'),
        message: `the provider ${provider} is not pinned: a provider that changes changes the deployment`,
      })
    }

    // The credentials the templates generate are strong enough for the
    // services that read them.
    findings.push(...checkCredentials(await sourcesWithNames(root, stack.directory)))

    // The directory of the templates holds the files of the templates
    // and nothing else. A file that is not a file of the templates is a
    // file that nobody owns, and the tool that writes the deployment
    // reads the whole directory: a file it cannot read stops the
    // deployment with the stack trace of the tool and not with the
    // name of the file.
    findings.push(...(await checkFilesOfStack(root, stack)))
  }

  // The runtime directory is not committed: the files of a deployment
  // are the files of one deployment.
  let ignore = ''
  try {
    ignore = readFileSync(join(root, '.gitignore'), 'utf8')
  } catch {
    findings.push({ file: '.gitignore', message: 'the file of the ignored files is not there' })
  }
  if (!ignore.split('\n').some((line) => line.trim() === `${RUNTIME}/`)) {
    findings.push({
      file: '.gitignore',
      message: `the directory ${RUNTIME} is not ignored: the files of a deployment are not files of the repository`,
    })
  }

  return findings
}

/**
 * The variables the environment of the console of the templates names.
 *
 * The console reads the state of the three services of the platform and
 * shows it on its status board, and it reads each of them at the
 * address its environment names. The variables are read out of the
 * blocks of `env` of the application of the console, and the name of a
 * variable is the `name` of its block.
 *
 * @param sources the sources of the templates.
 */
export function consoleVariablesOf(sources: readonly string[]): string[] {
  const names = new Set<string>()
  for (const source of sources) {
    const lines = source.split('\n')
    const start = lines.findIndex((line) =>
      /^resource\s+"azurerm_container_app"\s+"console"/.test(line)
    )
    if (start < 0) continue
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => /^resource\s/.test(line))
    const block = (end < 0 ? rest : rest.slice(0, end)).join('\n')
    for (const match of block.matchAll(/\benv\s*\{\s*name\s*=\s*"([^"]+)"/g)) {
      names.add(match[1]!)
    }
  }
  return [...names].sort()
}

/**
 * Checks that the console of the deployment knows the address of every
 * service it probes.
 *
 * The console shows the state of the three services of the platform on
 * its status board, and it reads each of them at the address its
 * environment names. A console that names no address of a service shows
 * that service as not configured, and an operator reads a service that
 * is not configured as a service that is not there.
 *
 * @param root the root of the repository.
 */
export async function checkConsoleProbes(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const sources = await sourcesOf(root, TEMPLATES)
  const names = consoleVariablesOf(sources)
  for (const variable of CONSOLE_PROBES) {
    if (names.includes(variable)) continue
    findings.push({
      file: join(TEMPLATES, 'containerapps.tf'),
      message: `the console of the deployment does not name the variable ${variable}: the status board of the console shows the service as not configured`,
    })
  }
  return findings
}

/**
 * The block of a resource of the templates.
 *
 * The block of a resource is the text of the resource, from its
 * declaration to the declaration of the resource that follows it. The
 * blocks are read out of the sources of the templates.
 *
 * @param source the source of a template.
 * @param name the name of the resource.
 */
function resourceBlockOf(source: string, name: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) =>
    new RegExp(`^resource\\s+"[^"]+"\\s+"${name}"`).test(line)
  )
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^resource\s/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * The variables of the environment of an application of the templates.
 *
 * The environment of an application is the list of its `env` blocks, and
 * the value of a variable is the expression of the `value` of its block.
 * A block that names a secret has no value, and the name of the secret
 * is not a value of the environment.
 *
 * @param sources the sources of the templates.
 * @param application the name of the application.
 */
export function environmentOf(
  sources: readonly string[],
  application: string
): Map<string, string> {
  const environment = new Map<string, string>()
  for (const source of sources) {
    const block = resourceBlockOf(source, application)
    if (block === '') continue
    for (const match of block.matchAll(/env\s*\{([^{}]*)\}/g)) {
      const body = match[1]!
      const name = /name\s*=\s*"([^"]+)"/.exec(body)?.[1]
      if (name === undefined) continue
      const value = /value\s*=\s*([^\n]+)/.exec(body)?.[1]?.trim()
      if (value === undefined) continue
      environment.set(name, value)
    }
  }
  return environment
}

/**
 * The name of the secret of the vault that a map of secrets names.
 *
 * The maps of the secrets of the environment of the applications are
 * read out of the sources of the templates, and the name of the secret
 * of a variable is the value of the entry of the map.
 *
 * @param sources the sources of the templates.
 * @param map the name of the map.
 * @param name the name of the variable.
 */
export function secretOf(
  sources: readonly string[],
  map: string,
  name: string
): string | undefined {
  for (const source of sources) {
    const block = new RegExp(`${map}\\s*=\\s*\\{([^}]*)\\}`).exec(source)?.[1]
    if (block === undefined) continue
    const secret = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, 'm').exec(block)?.[1]
    if (secret !== undefined) return secret
  }
  return undefined
}

/**
 * The value of a secret of the vault.
 *
 * The values of the secrets of the vault are written out of the map of
 * the sources of the templates, and the value of a secret is the
 * expression of its entry.
 *
 * @param sources the sources of the templates.
 * @param name the name of the secret.
 */
export function valueOfSecret(sources: readonly string[], name: string): string | undefined {
  for (const source of sources) {
    const block = /secret_values\s*=\s*\{([^}]*)\}/.exec(source)?.[1]
    if (block === undefined) continue
    const value = new RegExp(`^\\s*"${name}"\\s*=\\s*([^\\n]+)`, 'm').exec(block)?.[1]?.trim()
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Checks the credentials the console of the deployment holds at Access.
 *
 * Access holds one client for a tenant: it resolves the tenant of a
 * login from the identifier of the client, and it holds one secret for
 * that client. The gateway and the console are that client, and the
 * callbacks of the two of them are the redirect URIs of the one client.
 * A console that presents a client of its own presents a client that
 * names no tenant, and the sign-in of the console fails with a request
 * that is not valid.
 *
 * The check holds the templates to that rule, and it holds the console
 * to the two rules that follow from it: the credential of the access
 * context that the console reads is registered at Access, or the
 * console reads no scope for the people who sign in; and the token of
 * the control plane is a credential of its own, and the console never
 * holds one — it is the service that the browsers reach.
 *
 * @param root the root of the repository.
 */
export async function checkConsoleCredentials(root: string): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const sources = await sourcesOf(root, TEMPLATES)

  const gateway = environmentOf(sources, 'gateway')
  const consoleApp = environmentOf(sources, 'console')
  const gatewayId = gateway.get('GATEWAY_OIDC_CLIENT_ID')
  const consoleId = consoleApp.get('CONSOLE_CLIENT_ID')
  if (gatewayId !== undefined && consoleId !== undefined && gatewayId !== consoleId) {
    findings.push({
      file: join(TEMPLATES, 'containerapps.tf'),
      message: `the console of the deployment is a client of Access of its own (${consoleId}), and the gateway is another one (${gatewayId}): Access holds one client for a tenant, and the sign-in of the console fails with a request that names no tenant`,
    })
  }

  const gatewaySecret = secretOf(sources, 'gateway_env_secrets', 'GATEWAY_OIDC_CLIENT_SECRET')
  const consoleSecret = secretOf(sources, 'console_env_secrets', 'CONSOLE_CLIENT_SECRET')
  if (
    gatewaySecret !== undefined &&
    consoleSecret !== undefined &&
    gatewaySecret !== consoleSecret
  ) {
    findings.push({
      file: join(TEMPLATES, 'containerapps.tf'),
      message: `the console of the deployment reads the secret ${consoleSecret} of the vault and the gateway reads the secret ${gatewaySecret}, and the two of them are the one client of the tenant: the sign-in of the console fails with a request that is not valid`,
    })
  }

  const control = secretOf(sources, 'console_env_secrets', 'CONSOLE_CLIENT_SECRET')
  const token = /control_tokens\s*=\s*\{([^}]*)\}/.exec(sources.join('\n'))?.[1]
  const held = token === undefined ? undefined : /random_bytes\.(\w+)\.hex/.exec(token)?.[1]
  const client = control === undefined ? undefined : valueOfSecret(sources, control)
  const owner = client === undefined ? undefined : /random_bytes\.(\w+)\.hex/.exec(client)?.[1]
  if (held !== undefined && owner !== undefined && held === owner) {
    findings.push({
      file: join(TEMPLATES, 'locals.tf'),
      message: `the console of the deployment reads the secret of the client, and that secret is the token of the control plane: the service that the browsers reach holds a credential of the control plane`,
    })
  }

  const context = secretOf(sources, 'console_env_secrets', 'CONSOLE_ACCESS_CONTEXT_TOKEN')
  const value = context === undefined ? undefined : valueOfSecret(sources, context)
  const credential = value === undefined ? undefined : /random_bytes\.(\w+)\.hex/.exec(value)?.[1]
  const registered = /access_context_tokens\s*=\s*\{([^}]*)\}/.exec(sources.join('\n'))?.[1]
  const known = new Set<string>()
  for (const match of (registered ?? '').matchAll(/random_bytes\.(\w+)\.hex/g)) {
    known.add(match[1]!)
  }
  if (credential !== undefined && !known.has(credential)) {
    findings.push({
      file: join(TEMPLATES, 'locals.tf'),
      message: `the console of the deployment reads the credential of the access context and that credential is not registered at Access: the console reads no scope for the people that sign in, and it opens nothing`,
    })
  }

  return findings
}

/**
 * The files of a stack that belong to a deployment and not to the
 * repository.
 *
 * The state of a deployment and the plan of a deployment are the files
 * of one deployment, and the repository ignores them. The check holds
 * the directory of the templates to the files of the templates, and the
 * files of a deployment are not files of the templates.
 *
 * @param name the name of the file.
 */
function fileOfADeployment(name: string): boolean {
  return (
    name.endsWith('.tfstate') ||
    name.endsWith('.tfstate.backup') ||
    name.endsWith('.tfvars') ||
    name.endsWith('.tfplan') ||
    name.endsWith('.bin')
  )
}

/**
 * Checks that the directory of a stack holds the files of the stack.
 *
 * The tool that writes the deployment reads the whole directory of the
 * templates, and it reads a file it does not expect: a file that is
 * named `tests` and that is not a directory stops the tool with the
 * stack trace of the tool, and the operator is told nothing about the
 * file that is in the way. The check holds the directory to the files
 * of the stack, and the tool reads what the check knows.
 *
 * @param root the root of the repository.
 * @param stack the stack of the deployment.
 */
export async function checkFilesOfStack(
  root: string,
  stack: { directory: string; files: readonly string[] }
): Promise<DeployFinding[]> {
  const findings: DeployFinding[] = []
  const directory = join(root, stack.directory)
  if (!existsSync(directory)) return findings
  const allowed = new Set(stack.files)
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    // A dotted entry is the work of the tool: the directory of the
    // providers, the directory of the modules and the like.
    if (entry.name.startsWith('.')) continue
    // The documentation of the stack is a file of the stack.
    if (entry.name.endsWith('.md')) continue
    if (allowed.has(entry.name)) continue
    // The stack of the bootstrap lives in the directory of the
    // templates, and it is a stack of the deployment of its own.
    if (entry.isDirectory() && entry.name === 'bootstrap') continue
    // The files of a deployment are the files of one deployment.
    if (fileOfADeployment(entry.name)) continue
    findings.push({
      file: join(stack.directory, entry.name),
      message:
        'the file is not a file of the templates: the tool that writes the deployment reads the whole directory, and a file it cannot read stops the deployment',
    })
  }
  return findings
}

/**
 * Checks that the files of the templates that are tracked are the files
 * of the templates.
 *
 * The check reads the index of the repository and not the tree: the
 * files of a deployment are in the tree of the machine of the operator,
 * and they are never in the index.
 */
export function checkTrackedInfrastructure(root: string): DeployFinding[] {
  const findings: DeployFinding[] = []
  const result = git(['ls-files', '--', TOFU], root)
  if (result.status !== 0) return findings
  for (const line of result.stdout.split('\n')) {
    const file = line.trim()
    if (file === '') continue
    const name = file.slice(file.lastIndexOf('/') + 1)
    const allowed =
      name.endsWith('.tf') || name.endsWith('.md') || name === EXAMPLE || name === LOCK
    if (allowed) continue
    findings.push({
      file,
      message: 'the file is not a file of the templates of the platform',
    })
  }
  return findings
}

/** Checks the directory of the deployment. */
export async function checkDeploy(root: string): Promise<DeployFinding[]> {
  const version = readVersion(root)
  const findings: DeployFinding[] = []
  findings.push(...checkLayout(root))
  findings.push(...(await checkStacks(root)))
  findings.push(...(await checkFiles(root, version)))
  findings.push(...(await checkManifests(root, version)))
  findings.push(...(await checkMinimumEnvironment(root)))
  findings.push(...(await checkInfrastructure(root)))
  findings.push(...(await checkConsoleProbes(root)))
  findings.push(...(await checkConsoleCredentials(root)))
  findings.push(...checkTrackedInfrastructure(root))
  return findings
}

if (import.meta.main) {
  const root = process.cwd()
  const findings = await checkDeploy(root)
  if (findings.length === 0) {
    console.log('the directory of the deployment holds what it should hold')
    process.exit(0)
  }
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`)
  }
  console.error('the directory of the deployment does not hold what it should hold')
  process.exit(1)
}
