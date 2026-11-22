/**
 * The wire the platform speaks to PostgreSQL: the messages it sends, and what they carry.
 *
 * The messages themselves are `pg-protocol`'s — the same ones node-postgres writes, so
 * that the protocol is spoken by the one implementation that has been speaking it for
 * years. What is here is what the platform makes of them.
 */
import './wire/buffer.ts'
export { Connection } from './wire/connection.ts'
export { ConnectionError, PgError } from './wire/errors.ts'
export { parseArray, parseValue, serialize } from './wire/codec.ts'
export type {
  Field,
  Login,
  LoginOptions,
  Result,
  Transport,
} from './wire/types.ts'
