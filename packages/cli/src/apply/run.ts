import type pg from 'pg'
import { membershipStatement } from '@platform/vocabulary'
import type { Report } from '../model.ts'
import { reserved } from './schema.ts'

/**
 * The run of a manifest: what it changed, and what the database already said. A statement
 * that is safe to repeat is run and reported only if the catalog moved.
 */
export class Run implements Report {
  changes: string[] = []
  unchanged = 0
  constructor(readonly q: pg.Client) {}
  changed(what: string) {
    this.changes.push(what)
  }
  same() {
    this.unchanged++
  }
  /** Runs statements that are safe to repeat, and reports them only if the catalog moved. */
  async converge(what: string, probe: string, params: unknown[], statements: string[]) {
    const read = async () => JSON.stringify((await this.q.query(probe, params)).rows)
    const before = await read()
    for (const sql of statements) await this.q.query(sql)
    if ((await read()) === before) this.same()
    else this.changed(what)
  }
  async role(role: string): Promise<{ login: boolean; connection_limit: number } | undefined> {
    if (reserved(role)) throw new Error(`${role} is a reserved role and is not managed here`)
    // The platform answers for itself: the role catalog is not readable by ordinary sessions.
    const found = await this.q.query('SELECT * FROM platform.role_attributes($1)', [role])
    return found.rows[0]
  }
  /** Checked first: an operator who cannot grant a membership may still find it in place. */
  async member(role: string, group: string, adminOption = false) {
    // The membership graph is not readable by ordinary connections, so the platform answers
    // for itself: an operator reads the truth, and anyone else only about themselves.
    const found = await this.q.query('SELECT platform.is_member($1,$2) AS member', [role, group])
    if (found.rows[0]?.member) return this.same()
    await this.q.query(membershipStatement({ role: group, member: role, admin: adminOption }))
    this.changed(`add ${role} to ${group}`)
  }
  /** The right to admit others to a group, and to take them out again. */
  async admits(role: string, group: string) {
    if (reserved(group)) throw new Error(`${group} is a reserved role and is not managed here`)
    // PostgreSQL answers for the role itself, whoever asks: no catalog is read.
    const found = await this.q.query(
      "SELECT pg_has_role($1,$2,'MEMBER WITH ADMIN OPTION') AS admits",
      [role, group]
    )
    if (found.rows[0]?.admits) return this.same()
    await this.q.query(membershipStatement({ role: group, member: role, admin: true }))
    this.changed(`let ${role} admit others to ${group}`)
  }
  /** A user is a role and nothing else: who may claim it is the identity provider's business. */
}
