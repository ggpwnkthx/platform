/**
 * The forwarding of the requests of the console.
 *
 * The domain owns the rule of the address of the caller: the console
 * passes the address the gateway reports to Access, and the audit of
 * Access names the operator that made the change.
 */

export { callerAddress } from './address'
