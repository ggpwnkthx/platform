import { platformFieldTypes } from './builtin.tsx'
import type { FieldFacts, FieldType } from './types.ts'

/**
 * The field types the interface holds: the platform's own, and the installation's.
 *
 * What type a field is, is asked of PostgreSQL's own answer about the column — its type, the
 * row it points at, the values a CHECK allows — and every type says how strongly it claims
 * such a column. Nothing is stored about it: a domain of the installation's own is a type of
 * field the moment a field type claims it.
 */

/** The types held, by name, in the order they were added. */
const held = new Map<string, FieldType>(platformFieldTypes.map((type) => [type.name, type]))

/**
 * Adds a field type of the installation's own, or replaces one the platform holds by taking
 * its name. A type that claims a column more strongly than the platform's own becomes the
 * type of that field: its cell, its value, its input and its filter.
 */
export function registerFieldType(type: FieldType): void {
  held.set(type.name, type)
}

/** The field type of that name, if there is one. */
export function fieldTypeNamed(name: string): FieldType | null {
  return held.get(name) ?? null
}

/** Every field type held, in the order they were added. */
export function knownFieldTypes(): FieldType[] {
  return [...held.values()]
}

/**
 * The type of a field: the one that claims its column most strongly. Of two that claim it
 * alike, the one added last is the field's, so an installation's own wins over the
 * platform's at the same weight.
 */
export function fieldTypeFor(facts: FieldFacts): FieldType {
  let best: FieldType | null = null
  let weight = 0
  for (const type of held.values()) {
    const claim = type.claims(facts)
    if (claim > 0 && claim >= weight) {
      best = type
      weight = claim
    }
  }
  // The platform's type of last resort claims every column, so there is always one.
  return best ?? held.get('other')!
}
