import type pg from 'pg'

/**
 * The world the operator's own commands are tested against: a client that answers nothing,
 * and the environment as it was.
 */

/** A client that answers nothing: a command that reaches the database has gone wrong here. */
export const silent = {
  query: async () => {
    throw new Error('The database was asked a question it should not have been asked')
  },
} as unknown as pg.Client

/** The environment as it was, so that a test that changes it can put it back. */
const kept = { ...process.env }

/** Puts the environment back as it was. */
export function restore() {
  for (const name of Object.keys(process.env)) if (!(name in kept)) delete process.env[name]
  for (const [name, value] of Object.entries(kept)) process.env[name] = value
}
