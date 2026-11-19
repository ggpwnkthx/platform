/**
 * Runs statements as one transaction: all of them happen, or none.
 *
 * The transaction itself is the platform's own, written once for the operator's tools and
 * the interface alike.
 */
export { transaction } from '@platform/sql'
