/** A URL: what the site, the issuer and the relay are named by. */
export function aUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol ? undefined : 'must be a URL'
  } catch {
    return 'must be a URL'
  }
}

/** An HTTPS URL: what a Kubernetes deployment is named by. */
export function anHttpsUrl(value: string): string | undefined {
  const problem = aUrl(value)
  if (problem) return problem
  return new URL(value).protocol === 'https:' ? undefined : 'must be an HTTPS URL'
}

/** A port: what a service is published on. */
export function aPort(value: string): string | undefined {
  if (!/^\d+$/.test(value)) return 'must be a port between 1 and 65535'
  const port = Number(value)
  return port >= 1 && port <= 65535 ? undefined : 'must be a port between 1 and 65535'
}

/**
 * A person, as the issuer names them: an address. It is their role's name in PostgreSQL
 * too, so it is no longer than a name there may be, and has nothing in it that the
 * server's authentication rules could not carry.
 */
export function anAddress(value: string): string | undefined {
  if (!/^[^\s"'\\,@]+@[^\s"'\\,@]+$/.test(value))
    return 'must be an address, such as admin@localhost'
  return value.length <= 63
    ? undefined
    : 'must be 63 characters or fewer: it names a PostgreSQL role'
}

/** A domain name: the domain a deployment is named by. */
export function aDomain(value: string): string | undefined {
  if (!value || value.length > 253) return 'must be a domain name'
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/i.test(value)
    ? undefined
    : 'must be a domain name'
}

/** A sub-domain: the name one service answers on. */
export function aSubDomain(value: string): string | undefined {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/i.test(value) ? undefined : 'must be a sub-domain name'
}

/** The name a service answers on: its sub-domain on the deployment's domain. */
export function serviceName(answers: Record<string, string>, sub: string): string | undefined {
  const host = answers[sub]
  const domain = answers.PLATFORM_DOMAIN
  return host && domain ? `${host}.${domain}` : undefined
}
