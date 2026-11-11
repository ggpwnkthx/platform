/**
 * The catalog of the providers of the platform.
 *
 * Every provider of a tenant is an OpenID Connect provider, and there is
 * no vendor in the code of the login. The catalog is what the platform
 * supports out of the box, and it is a table of defaults and not a table
 * of drivers: a preset fills the issuer, the scopes and the algorithms
 * of a provider, and it says how the client of Access is registered at
 * the vendor.
 *
 * The catalog lives in Access: the platform answers the presets it
 * supports, and the CLI reads them there. The shape of a preset is
 * written in the client of the platform (`@platform/client`), like every
 * other shape the CLI reads.
 */

export type { CatalogEntry } from '@platform/client'
