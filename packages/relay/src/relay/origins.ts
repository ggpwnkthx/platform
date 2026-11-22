function originOf(request: Request): string | null {
  const header = request.headers.get('origin')
  if (!header) return null
  try {
    const url = new URL(header)
    return url.origin
  } catch {
    return null
  }
}

/**
 * Whether the handshake comes from an allowed origin. A request with no Origin header is
 * refused when there is a list: only a browser sends one, and it is the page's own origin
 * that a cross-site page cannot forge.
 */
export function originAllowed(request: Request, allowed: string[]): boolean {
  if (!allowed.length) return true
  const origin = originOf(request)
  return origin !== null && allowed.includes(origin)
}

/** An address as it is compared: an IPv4 address carried in IPv6 is the IPv4 address. */
