/**
 * The version of the CLI.
 *
 * The version of the CLI is the version of the platform it is released
 * with, and it is written in one place: a CLI that answers another
 * version than the one it was built with is a CLI that lies about what
 * it does.
 */

/** The version of the CLI. */
export const VERSION = '1.0.0'

/** The name of the program. */
export const NAME = 'platformctl'

/**
 * The repository the releases of the platform live in.
 *
 * A release carries the digest of every image it published, and the
 * wizard of a deployment reads that release: a deployment pins the
 * digest of the image it runs, and the digest of a release does not
 * move.
 */
export const REPOSITORY = 'ggpwnkthx/platform'
