/**
 * The forwarding of the requests of Access.
 *
 * The domain owns the rule of the address of the caller: the address of
 * the socket is the address of the peer, and a deployment that is behind
 * an ingress reads the address the ingress reports.
 */

export { callerAddress } from './address'
