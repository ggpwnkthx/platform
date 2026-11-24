import { type Expression, sql, type SqlBool } from 'kysely'
import {
  asText,
  condition,
  type Eb,
  type Filter,
  isRelationOperator,
  pattern,
  type RelationReach,
  type RelationOperator,
} from './query.ts'

/**
 * The rows a relation reaches, and how the record reaches them. The tables are derived
 * and named, so that neither of them can be mistaken for the table being read — a row
 * that points at a row of its own table is the case that needs it.
 */

/**
 * A condition on a relation: what a record is linked to. It is a question about other
 * rows, so it is asked with EXISTS over the table that holds the links.
 */
function relationCondition(
  eb: Eb,
  base: { schema: string; table: string },
  reach: RelationReach,
  op: RelationOperator,
  values: string[]
): Expression<SqlBool> {
  const wanted = values.filter((value) => value !== '')
  // No rows to be linked to: nothing is linked to any of them, and nothing is linked to
  // none of them either.
  if (!wanted.length) return eb.lit(op !== 'has_any')
  // A column that points at one row: the condition is on the column itself.
  if (reach.kind === 'column') {
    const column = `${base.schema}.${base.table}.${reach.column}`
    if (op === 'has_any') return eb(column, 'in', wanted)
    // A row with no link is linked to none of them: a column with nothing in it says so.
    if (op === 'has_none') return eb.or([eb(column, 'is', null), eb(column, 'not in', wanted)])
    // All of them: a column holds one row, so it is linked to all of them only if there is
    // one of them, and it points at that one.
    if (wanted.length === 1) return eb(column, '=', wanted[0])
    return eb.lit(false)
  }
  const rel = eb.selectFrom(`${reach.schema}.${reach.table}`).selectAll().as('rel')
  const linked = eb.exists(
    eb
      .selectFrom(rel)
      .select(sql.lit(1).as('one'))
      .where(eb.ref(`rel.${reach.fk}`), '=', eb.ref(`${base.schema}.${base.table}.id`))
      .where(eb.ref(`rel.${reach.target}`), 'in', wanted)
  )
  switch (op) {
    case 'has_any':
      return linked
    case 'has_none':
      return eb.not(linked)
    case 'has_all': {
      // Every one of them: as many of the links as were asked for.
      const counted = eb
        .selectFrom(rel)
        .select(eb.fn.count(`rel.${reach.target}`).distinct().as('held'))
        .where(eb.ref(`rel.${reach.fk}`), '=', eb.ref(`${base.schema}.${base.table}.id`))
        .where(eb.ref(`rel.${reach.target}`), 'in', wanted)
      return eb(counted, '=', wanted.length)
    }
  }
}

/**
 * The names of the rows a relation reaches, searched along with the columns of the table
 * being read: a story is found by the name of its section, or of one of its tags.
 */
function labelCondition(
  eb: Eb,
  base: { schema: string; table: string },
  reach: RelationReach,
  term: string
): Expression<SqlBool> | null {
  const label = reach.label
  if (!label) return null
  const found = pattern(term, 'any')
  const key = reach.target_column ?? 'id'
  if (reach.kind === 'column') {
    const rel = eb.selectFrom(`${reach.schema}.${reach.table}`).selectAll().as('rel')
    return eb.exists(
      eb
        .selectFrom(rel)
        .select(sql.lit(1).as('one'))
        .where(eb.ref(`rel.${key}`), '=', eb.ref(`${base.schema}.${base.table}.${reach.column}`))
        .where((eb2) => eb2(asText(`rel.${label}`), 'ilike', found))
    )
  }
  const rel = eb.selectFrom(`${reach.schema}.${reach.table}`).selectAll().as('rel')
  const other = eb.selectFrom(`${reach.target_schema}.${reach.target_table}`).selectAll().as('t')
  return eb.exists(
    eb
      .selectFrom(rel)
      .innerJoin(other, `t.${key}`, `rel.${reach.target}`)
      .select(sql.lit(1).as('one'))
      .where(eb.ref(`rel.${reach.fk}`), '=', eb.ref(`${base.schema}.${base.table}.id`))
      .where((eb2) => eb2(asText(`t.${label}`), 'ilike', found))
  )
}

/**
 * The filters, the search of every readable column as text, and the names of the rows a
 * relation reaches. A condition on a relation is asked of the table that holds the links,
 * and needs the reach that finds them.
 */
export const predicate =
  (options: {
    filter: Filter
    search: string
    searchable: readonly string[]
    base?: { schema: string; table: string }
    /** How each relation of the collection is reached. */
    reaches?: Record<string, RelationReach>
  }) =>
  (eb: Eb) => {
    const { filter, search, searchable, base } = options
    const paths = options.reaches ?? {}
    const term = search.trim()
    const named = base
      ? Object.values(paths)
          .map((reach) => labelCondition(eb, base, reach, term))
          .filter((one): one is Expression<SqlBool> => !!one)
      : []
    return eb.and([
      ...Object.entries(filter).map(([column, one]) => {
        const reach = paths[column]
        if (isRelationOperator(one.op)) {
          if (!reach || !base) return eb.lit(false)
          return relationCondition(eb, base, reach, one.op, [one.value].flat().map(String))
        }
        return condition(eb, column, one)
      }),
      ...(term && searchable.length
        ? [
            eb.or([
              ...searchable.map((c) => eb(asText(c), 'ilike', pattern(term, 'any'))),
              ...named,
            ]),
          ]
        : []),
    ])
  }
