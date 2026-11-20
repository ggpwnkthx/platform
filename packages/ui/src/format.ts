/** Values as the screen shows them. Nothing is rounded or moved between time zones. */

export function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const numberFormat = new Intl.NumberFormat('en-US')

export function count(value: number): string {
  return numberFormat.format(value)
}

/** A timestamp the database wrote, shortened to the minute: 2026-11-18 16:42. */
export function moment(value: unknown): string {
  if (typeof value !== 'string') return display(value)
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : value
}

/** How long ago, in words, for a timestamp the database wrote. */
export function ago(value: string): string {
  const then = Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isNaN(then)) return value
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return moment(value)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`
}

const shortTypes: Record<string, string> = {
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  'character varying': 'varchar',
  'double precision': 'float8',
}

/** A type as the database's format_type writes it, in the short form people type. */
export function shortType(type: string): string {
  for (const [long, short] of Object.entries(shortTypes))
    if (type.startsWith(long)) return short + type.slice(long.length)
  return type
}
