/**
 * The signature of the values of the cookies of the console.
 *
 * A cookie of the console holds an identifier and nothing else, and the
 * identifier is signed: a browser that invents an identifier presents a
 * value whose signature does not hold, and the console never looks it
 * up.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Signs a value with the secret of the console. */
export function sign(value: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(value).digest('base64url')
  return `${value}.${mac}`
}

/** Answers the value of a signed value, or null when the signature does not hold. */
export function unsign(signed: string | undefined, secret: string): string | null {
  if (!signed) return null
  const index = signed.lastIndexOf('.')
  if (index <= 0) return null
  const value = signed.slice(0, index)
  const expected = Buffer.from(sign(value, secret).slice(index + 1))
  const presented = Buffer.from(signed.slice(index + 1))
  if (expected.length !== presented.length) return null
  return timingSafeEqual(expected, presented) ? value : null
}
