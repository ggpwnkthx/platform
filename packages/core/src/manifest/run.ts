import type { Db } from '../db.ts'
import type { MetadataTarget } from '../sql/metadata.ts'
import { membershipStatement } from '../sql/roles.ts'
import { metadataStatementOnce } from '../sql/metadata.ts'

export interface ApplyResult {
  changes: string[]
  unchanged: number
  notes: string[]
}
/** What an apply did and what it found in place. Every step converges: a second run changes nothing. */
export class Run implements ApplyResult {
  changes: string[] = []
  unchanged = 0
  notes: string[] = []
  constructor(readonly db: Db) {}
  async one<Row = Record<string, unknown>>(text: string, params?: unknown[]) {
    return (await this.db.query<Row>(text, params)).rows[0]
  }
  async all(statements: string[]) {
    for (const statement of statements) await this.db.query(statement)
  }
  changed(what: string) {
    this.changes.push(what)
  }
  /** Runs statements and says whether what the probe reads is different afterwards. */
  async converge(what: string, probe: string, params: unknown[], statements: string[]) {
    const read = async () => JSON.stringify((await this.db.query(probe, params)).rows)
    const before = await read()
    await this.all(statements)
    if ((await read()) === before) this.unchanged++
    else this.changed(what)
  }
  async member(role: string, group: string, admin = false) {
    const found = await this.one<{ member: boolean }>(
      admin
        ? `SELECT pg_has_role($1,$2,'MEMBER WITH ADMIN OPTION') AS member`
        : 'SELECT platform.is_member($1,$2) AS member',
      [role, group]
    )
    if (found?.member) return void this.unchanged++
    await this.db.query(membershipStatement({ role: group, member: role, admin }))
    this.changed(admin ? `let ${role} admit others to ${group}` : `add ${role} to ${group}`)
  }
  async describe(target: MetadataTarget, metadata: Record<string, unknown>) {
    const said: string[] = []
    for (const [key, value] of Object.entries(metadata)) {
      // Written once: what an owner has since said of the item is theirs to keep.
      const { text, params } = metadataStatementOnce(target, key, value)
      const written = await this.db.query(text, params)
      if (written.rowCount) said.push(key)
      else this.unchanged++
    }
    const item = [target.schema, target.table, target.column].filter(Boolean).join('.')
    if (said.length) this.changed(`describe ${target.scope} ${item}: ${said.join(', ')}`)
  }
}
