/** Kubernetes: the relay's manifests, and what kubectl does with them. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parseAllDocuments } from 'yaml'
import { ROOT } from './runtime.ts'

/** What a manifest is rendered from: the image, the addresses, and the database it reads. */
type ManifestOptions = {
  image: string
  publicUrl: string
  oidcIssuer: string
  databaseHost: string
  databasePort: string
  namespace?: string
}

/**
 * The first of the values that is given: the flag the operator wrote, then the setting that
 * was saved, then the default. A value that is empty is a value: it is the operator's, and
 * it is what is asked about.
 */
export function firstGiven(...values: (string | undefined | null)[]): string {
  for (const value of values) if (value !== undefined && value !== null) return value
  return ''
}

/** The image the relay runs: the operator's own, and never one of the placeholders. */
function checkImage(options: ManifestOptions): void {
  if (!options.image || options.image.includes('YOUR_REGISTRY') || /[\s\0]/.test(options.image))
    throw new Error('--image or PLATFORM_IMAGE must specify your built/pushed image')
}

/** The address the site is served from: an HTTPS address, and nothing else. */
function checkSite(options: ManifestOptions): void {
  if (!options.publicUrl) throw new Error('--public-url or PUBLIC_URL is required')
  const url = new URL(options.publicUrl)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Kubernetes PUBLIC_URL must be an HTTPS URL without credentials')
}

/** The issuer the readers sign in through: an address, and nothing else. */
function checkIssuer(options: ManifestOptions): void {
  if (!options.oidcIssuer) throw new Error('--oidc-issuer or OIDC_ISSUER is required')
  const issuer = new URL(options.oidcIssuer)
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search)
    throw new Error('Kubernetes OIDC_ISSUER must be an HTTPS URL without credentials')
}

/** The database the relay reads: a host, a name, and a port. */
function checkDatabase(options: ManifestOptions): void {
  if (!options.databaseHost || options.databaseHost === 'postgres.example.com')
    throw new Error('--database-host or DATABASE_HOST is required')
  // The relay is told where to connect in one argument: a host name, an IPv4 address, or an
  // IPv6 address in brackets, and nothing that could become another argument.
  if (!/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/.test(options.databaseHost))
    throw new Error('--database-host must be a host name or an IP address')
  if (
    !/^\d+$/.test(options.databasePort) ||
    Number(options.databasePort) < 1 ||
    Number(options.databasePort) > 65535
  )
    throw new Error('Invalid database port')
}

/**
 * What the manifests need, checked before anything is rendered: an address that cannot be
 * right is refused here, and the deployment is never half-written.
 */
function checkManifest(options: ManifestOptions, namespace: string): void {
  checkImage(options)
  checkSite(options)
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63)
    throw new Error('Invalid namespace')
  checkIssuer(options)
  checkDatabase(options)
}

/**
 * The relay's manifests, as the deployment is to have them: the image it runs, the address
 * it reaches PostgreSQL at, the origin it allows, and the namespace it is deployed to.
 *
 * The manifests are YAML, and they are changed as YAML: the values are set where they
 * belong, so that a value that is not the one the operator gave cannot become another
 * setting, and the comments the manifests carry are kept.
 */
export function renderKubernetes(options: ManifestOptions): string {
  const namespace = options.namespace ?? 'default'
  checkManifest(options, namespace)
  const documents = parseAllDocuments(
    readFileSync(join(ROOT, 'deploy/k8s/deployment.yaml'), 'utf8')
  )
  const deployment = documents[0]
  if (!deployment) throw new Error("The relay's manifests are missing")
  // Every document of the deployment is in the namespace it is deployed to.
  for (const document of documents) document.setIn(['metadata', 'namespace'], namespace)
  const container = deployment.getIn(['spec', 'template', 'spec', 'containers', 0])
  if (!isMap(container)) throw new Error("The relay's manifest has no container")
  container.set('image', options.image)
  const environment = container.get('env')
  if (!isSeq(environment)) throw new Error("The relay's manifest has no environment")
  const setting = (name: string, value: string) => {
    for (const entry of environment.items)
      if (isMap(entry) && entry.get('name') === name) entry.set('value', value)
  }
  // The database the relay forwards to, and the one origin it opens a session for.
  setting('RELAY_UPSTREAM', `${options.databaseHost}:${options.databasePort}`)
  setting('RELAY_ORIGINS', options.publicUrl)
  // The documents are written one after the other, each of them a document of its own.
  return documents.map((document) => document.toString().replace(/^---\r?\n/, '')).join('\n---\n')
}
