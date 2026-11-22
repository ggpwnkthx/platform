export class PgError extends Error {
  readonly code: string
  readonly severity: string
  readonly detail?: string
  readonly hint?: string
  readonly position?: number
  readonly schema?: string
  readonly table?: string
  readonly column?: string
  readonly constraint?: string
  constructor(fields: Map<string, string>) {
    super(fields.get('M') ?? 'PostgreSQL refused the request')
    this.name = 'PgError'
    this.code = fields.get('C') ?? ''
    this.severity = fields.get('V') ?? fields.get('S') ?? 'ERROR'
    this.detail = fields.get('D')
    this.hint = fields.get('H')
    const position = fields.get('P')
    this.position = position ? Number(position) : undefined
    this.schema = fields.get('s')
    this.table = fields.get('t')
    this.column = fields.get('c')
    this.constraint = fields.get('n')
  }
}

/** The stream failed before PostgreSQL could answer: the relay or the server is unreachable. */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}
