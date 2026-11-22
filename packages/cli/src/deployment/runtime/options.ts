/**
 * The options the deployment's commands take.
 *
 * They are read by node's own parser, so that `--engine=docker` and `--engine docker` are
 * the same everywhere, and an option that is given twice is refused rather than read as
 * the last one.
 */

/** The options the local stack takes. */
export const LOCAL_OPTIONS = {
  engine: { type: 'string' },
  timeout: { type: 'string' },
  domain: { type: 'string' },
} as const

/** The options a Kubernetes deployment takes. */
export const KUBERNETES_OPTIONS = {
  namespace: { type: 'string' },
  timeout: { type: 'string' },
  domain: { type: 'string' },
  image: { type: 'string' },
  'public-url': { type: 'string' },
  'oidc-issuer': { type: 'string' },
  'database-host': { type: 'string' },
  'database-port': { type: 'string' },
} as const

/** The actions whose arguments belong to another program: the logs of a deployment, and
 * the things an operator asks of it. What is left after the options are read is theirs. */
export const PASSTHROUGH_ACTIONS = ['logs', 'down', 'admin']

/** The timeout a deployment waits for, in seconds. */
export function seconds(value: string | undefined): number {
  const n = Number(value ?? 120)
  if (!Number.isInteger(n) || n < 1 || n > 1800) throw new Error('--timeout must be 1–1800 seconds')
  return n
}
