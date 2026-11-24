import { resolve } from 'node:path'
import { z } from 'zod'
import { ROOT, siteFiles } from '../site.ts'

export type Target = 'local' | 'k8s'
export type Answers = Record<string, string>

const name = z
  .string()
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'a name of letters, digits and hyphens')
const domain = z.string().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/, 'a domain name')
const port = z.coerce.number().int().min(1).max(65535)
const url = z.union([z.literal(''), z.url()])
const folder = z
  .string()
  .refine(
    (dir) => !dir || siteFiles(resolve(ROOT, dir)) !== null,
    'a folder that holds platform.json'
  )
export interface Setting {
  name: string
  on: Target[]
  question?: string
  fallback?: string | ((answers: Answers) => string)
  check?: z.ZodType
  /** Asked only of a deployment that deploys a site of its own. */
  ownSite?: boolean
  secret?: boolean
}
const both: Target[] = ['local', 'k8s']
/**
 * The pieces a deployment is made of — the domain, the sub-domains, the ports — kept in .env.
 * The addresses are not kept: the issuer, the relay and the database follow from the pieces
 * every time, so they never fall out of step with the domain.
 */
export const settings: Setting[] = [
  {
    name: 'PLATFORM_DOMAIN',
    on: ['local'],
    question: 'Domain of the deployment',
    fallback: 'localhost',
    check: domain,
  },
  { name: 'PLATFORM_DOMAIN', on: ['k8s'], question: 'Domain of the deployment', check: domain },
  {
    name: 'PLATFORM_IDP_HOST',
    on: both,
    question: 'Sub-domain for Dex, the issuer',
    fallback: 'idp',
    check: name,
  },
  {
    name: 'PLATFORM_API_HOST',
    on: both,
    question: 'Sub-domain for the relay, the API',
    fallback: 'api',
    check: name,
  },
  {
    name: 'PLATFORM_DB_HOST',
    on: both,
    question: 'Sub-domain for PostgreSQL',
    fallback: 'db',
    check: name,
  },
  { name: 'PLATFORM_IMAGE', on: ['k8s'], question: 'Relay image, in your registry' },
  {
    name: 'PLATFORM_PUBLIC_URL',
    on: both,
    question: 'URL of your site (empty to deploy one from a folder)',
    fallback: '',
    check: url,
  },
  {
    name: 'PLATFORM_SITE',
    on: both,
    ownSite: true,
    question: 'Folder of the site to deploy (empty for none)',
    fallback: '',
    check: folder,
  },
  {
    name: 'PLATFORM_APP_HOST',
    on: both,
    ownSite: true,
    question: 'Sub-domain for the site',
    fallback: 'app',
    check: name,
  },
  {
    name: 'EDGE_PORT',
    on: ['local'],
    question: 'Port for the edge, on this machine',
    fallback: '8080',
    check: port,
  },
  {
    name: 'EDGE_TLS_PORT',
    on: ['local'],
    question: 'Port for the edge with TLS',
    fallback: '4433',
    check: port,
  },
  {
    name: 'POSTGRES_PORT',
    on: ['local'],
    question: 'Port for PostgreSQL',
    fallback: '5432',
    check: port,
  },
  {
    name: 'DATABASE_PORT',
    on: ['k8s'],
    question: 'Port PostgreSQL listens on',
    fallback: '5432',
    check: port,
  },
  {
    name: 'DEX_PORT',
    on: ['local'],
    question: 'Port for Dex, behind the edge',
    fallback: '5556',
    check: port,
  },
  {
    name: 'RELAY_PORT',
    on: ['local'],
    question: 'Port for the relay, behind the edge',
    fallback: '8081',
    check: port,
  },
  {
    name: 'PLATFORM_ADMIN',
    on: ['local'],
    question: 'Administrator, as an address',
    fallback: (a) => `admin@${a.PLATFORM_DOMAIN ?? 'localhost'}`,
    // The address Dex knows the administrator by, and their role: admin@localhost is one.
    check: z.string().regex(/^[^@\s]+@[^@\s]+$/, 'an address, like admin@example.com'),
  },
  { name: 'PLATFORM_ADMIN_PASSWORD', on: ['local'], secret: true },
]
