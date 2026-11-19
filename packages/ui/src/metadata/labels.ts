import type { Mode, Situation } from '@platform/sql'

/**
 * What the interface calls the situations a field appears in, the modes it may be told to
 * appear by, and how long a name may be.
 *
 * The saying itself — where a field appears, and how its values are drawn — is the
 * platform's own, and is written once in `@platform/sql`. What is left here is the wording
 * the interface shows: the names people read, the titles that say where a field is being
 * talked about, and the measure the interface keeps.
 */

/** What each situation is called, in a sentence. */
export const situationLabels: Record<Situation, string> = {
  list: 'the list',
  record: 'the record',
  filter: 'the filters',
}

/** What each situation is called where a field is told of it. */
export const situationTitles: Record<Situation, string> = {
  list: 'In the list',
  record: 'In the record',
  filter: 'In filters',
}

/** What a situation may be told, in words the interface shows. */
export const modeLabels: Record<Mode, string> = {
  show: 'Shown',
  hide: 'Hidden',
  readonly: 'Shown, locked',
}

/** The longest display name the interface shows without truncating it in the navigation pane. */
export const displayNameLimit = 80
