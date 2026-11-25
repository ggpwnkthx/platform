/**
 * PostgreSQL's words in the reader's: a field's type, what a revision did, what a metadata key
 * is for. The interface leads with these; PostgreSQL's own stays in the tip, the SQL and the
 * forms that write it. A word with none here is shown as PostgreSQL has it.
 */
const types: [RegExp, string][] = [
  [/\[\]$/, 'List'],
  [/^(text|character varying|character|varchar|citext)\b/, 'Text'],
  [/^(smallint|integer|bigint)$/, 'Whole number'],
  [/^(numeric|decimal)\b/, 'Decimal number'],
  [/^(real|double precision)$/, 'Number'],
  [/^boolean$/, 'Yes or no'],
  [/^uuid$/, 'Identifier'],
  [/^date$/, 'Date'],
  [/^time\b/, 'Time of day'],
  [/^timestamp\b/, 'Date and time'],
  [/^interval\b/, 'Duration'],
  [/^jsonb?$/, 'JSON document'],
]
/** A type as format_type spells it, in a word; null where the type is the owner's own. */
export const typeWord = (type: string) => types.find(([spelled]) => spelled.test(type))?.[1] ?? null

/** What a revision did to its record, in the verbs the interface's buttons use. */
const operations: Record<string, string> = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Deleted' }
export const operationWord = (operation: string) => operations[operation] ?? operation

/** What the metadata keys the interface reads are for. */
const keys: Record<string, string> = {
  display_name: 'Name people read',
  display_field: 'Field that names a record',
  icon: 'Icon',
  color: 'Colour',
  views: 'Where it appears',
  renderers: 'How it is drawn',
}
export const metadataWord = (key: string) => keys[key] ?? null

/**
 * A column's default, as PostgreSQL keeps the expression, in words where it is a plain value or
 * a well-known function; null where it is the owner's own SQL, which is shown as it is.
 */
export function defaultWord(expression: string): string | null {
  const quoted = /^'((?:[^']|'')*)'(::[\w\s".]+)?$/.exec(expression)
  if (quoted) return `Starts as ${quoted[1]!.replaceAll("''", "'")}`
  if (/^-?\d+(\.\d+)?(::[\w\s]+)?$/.test(expression))
    return `Starts as ${expression.split('::')[0]}`
  if (/^(true|false)$/.test(expression)) return `Starts as ${expression === 'true' ? 'yes' : 'no'}`
  if (/^(now\(\)|CURRENT_TIMESTAMP|CURRENT_DATE)$/i.test(expression))
    return 'Starts as the moment it is written'
  if (/^(gen_random_uuid|uuidv[47])\(\)$/.test(expression)) return 'Starts as a new identifier'
  return null
}
