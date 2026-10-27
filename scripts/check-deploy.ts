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
 *
 *   bun run deploy:check
 */

import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseAllDocuments } from 'yaml'

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

/** Checks the directory of the deployment. */
export async function checkDeploy(root: string): Promise<DeployFinding[]> {
  const version = readVersion(root)
  const findings: DeployFinding[] = []
  findings.push(...checkLayout(root))
  findings.push(...(await checkStacks(root)))
  findings.push(...(await checkFiles(root, version)))
  findings.push(...(await checkManifests(root, version)))
  findings.push(...(await checkMinimumEnvironment(root)))
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
