/**
 * The credentials of the access context contract.
 *
 * The value of `ACCESS_CONTEXT_TOKENS` is a map: every key is a bearer
 * token and every value holds the tenants the token may ask about. The
 * value `null` is the credential of the platform: it may ask about every
 * tenant.
 *
 * The module owns the reading of the map, and the environment and the
 * composition read it through it: the environment refuses a map it does
 * not understand and the composition builds the credentials of it. A
 * deployment that sees the map read in two places reads it in two ways,
 * and the credential of the contract is the credential of the platform.
 */

/** The scope of a credential of the access context. */
export interface AccessContextCredentialScope {
  /** The bearer token of the credential. */
  readonly token: string
  /** The tenants the credential may ask about, or null for every tenant. */
  readonly tenants: string[] | null
}

/**
 * Reads the map of the credentials of the access context.
 *
 * A map that cannot be understood is refused: a credential that is not
 * understood is a credential that is not scoped.
 */
export function parseAccessContextCredentials(
  raw: string | undefined
): AccessContextCredentialScope[] {
  if (!raw || raw.trim().length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ACCESS_CONTEXT_TOKENS must be a json object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ACCESS_CONTEXT_TOKENS must be a json object')
  }
  const credentials: AccessContextCredentialScope[] = []
  for (const [token, scope] of Object.entries(parsed as Record<string, unknown>)) {
    if (token.length < 16) {
      throw new Error('a credential of the access context is at least 16 characters long')
    }
    if (scope === null) {
      credentials.push({ token, tenants: null })
      continue
    }
    if (!Array.isArray(scope) || scope.some((entry) => typeof entry !== 'string')) {
      throw new Error('the scope of a credential of the access context is a list of tenants')
    }
    credentials.push({ token, tenants: scope as string[] })
  }
  return credentials
}
