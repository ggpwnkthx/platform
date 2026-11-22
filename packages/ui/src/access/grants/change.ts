/**
 * The statements a change would make, and the problem the database would have with them: a
 * statement that cannot be made is caught here, before the reader is asked to run it.
 */
export interface Change {
  /** The statements to run, in the order they are to run in. */
  statements: string[]
  /** What the database would refuse, when it would refuse it. */
  problem: string | null
}

/** The statements a change makes, and the problem the database would have with them. */
export function changeOf(make: () => string[]): Change {
  try {
    return { statements: make(), problem: null }
  } catch (error) {
    return { statements: [], problem: error instanceof Error ? error.message : String(error) }
  }
}
