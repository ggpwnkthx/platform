/**
 * The wire the platform speaks to PostgreSQL: the messages it sends, and what they carry.
 */
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
