/** What PostgreSQL says about the rights on a workspace's schema. */

export interface SchemaGrantInfo {
  schema: string
  grantee: string
  privilege: string
  grantable: boolean
}
