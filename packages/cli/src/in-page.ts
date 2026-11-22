/**
 * PostgreSQL in the process: what a folder applies, installed in a PostgreSQL that runs where
 * the code does, and the database a development build puts in the interface's seam.
 *
 * The first half is the installation, and a folder's tests ask their questions of it. The
 * second half is the page's: a development build of a folder that applies something replaces
 * the interface's own connection with what `inPage` makes of what the folder applies.
 *
 * The files are installed as a deployment installs them. The platform's own installation
 * scripts, the ones `migrate` runs and in their order, then the folder's files through the
 * operator's own tools: the models for the schema, the migration for what a manifest cannot
 * say, the demonstration for the records and their history.
 *
 * Nothing here is any one folder's: its files are handed in, and so is the PostgreSQL.
 */
export { client } from './in-page/client.ts'
export { fingerprintFor, fingerprintOf } from './in-page/fingerprint.ts'
export { install, installPlatform } from './in-page/install.ts'
export { peopleOf } from './in-page/people.ts'
export { sessionAuthorization } from './in-page/session.ts'
export { inPage } from './in-page/page.ts'
