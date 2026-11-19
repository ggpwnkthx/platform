/** What PostgreSQL says about the signed-in reader. */
export interface Identity {
  username: string
  effective_role: string
  database: string
  platform_version: string | null
  server_version: string
  /** CREATE on the database: what a new workspace needs. */
  can_create_workspace: boolean
  /** The platform's own answer about roles: an operator may administer any of them. */
  is_operator: boolean
}
