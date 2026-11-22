import { metadataValue } from '../../metadata/value.tsx'
import type { FieldType } from '../field.ts'
import { boolean, integer, number, text } from './text.tsx'
import { date, json, time, timestamp, uuid } from './time.tsx'
import { choice, other, relation } from './choice.tsx'

/**
 * The field types the platform holds: one for every kind of value the database told it of, one
 * for a value chosen from a list and one for a value that points at another row.
 *
 * Each says the whole of what the interface does with such a field. A page that shows fields
 * holds no list of kinds: a kind the platform does not know yet is one more entry here, and
 * a type of the installation's own is one more `registerFieldType`.
 */

/** The field types the platform holds. */
export const platformFieldTypes: FieldType[] = [
  text,
  integer,
  number,
  boolean,
  date,
  time,
  timestamp,
  uuid,
  json,
  choice,
  relation,
  other,
  // The platform's own collections have fields of their own.
  metadataValue,
]
