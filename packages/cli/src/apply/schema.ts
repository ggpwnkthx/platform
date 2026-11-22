import { z } from 'zod'
import { schemaPrivilegeNames, tablePrivilegeNames } from '@platform/vocabulary'
import { collectionSchema, metadataSchema, relationSchema } from '../model.ts'

const name = z.string().min(1)
const state = z.enum(['present', 'absent']).default('present')
const userSchema = z.strictObject({
  name,
  state,
  login: z.boolean().default(true),
  /** The bootstrap administrator's rights: create roles, create workspaces, admit users. */
  admin: z.boolean().optional(),
  /**
   * The most sessions the role may hold at once, on the whole server: PostgreSQL's own
   * CONNECTION LIMIT, which every relay together cannot exceed. -1 is no limit; omitted
   * leaves the role's as it is.
   */
  connections: z.number().int().min(-1).optional(),
  groups: z.array(name).default([]),
  /**
   * The groups the user may admit others to, and take them out of: PostgreSQL's own ADMIN
   * OPTION on the membership. The user is a member of each as well.
   */
  admits: z.array(name).default([]),
})
const groupSchema = z.strictObject({ name, state })
/** The privileges a grant may name: those of a collection and those of a workspace. */
const grantPrivileges = z.enum([...new Set([...schemaPrivilegeNames, ...tablePrivilegeNames])] as [
  string,
  ...string[],
])
const grantSchema = z.strictObject({
  to: z.union([name, z.array(name).min(1)]),
  privileges: z.array(grantPrivileges).min(1),
  /** Without a collection the grant is on the workspace itself. */
  collection: name.optional(),
  columns: z.array(name).min(1).optional(),
  state,
})
const policySchema = z.strictObject({
  collection: name,
  name,
  state,
  for: z.enum(['all', 'select', 'insert', 'update', 'delete']).default('all'),
  to: z.array(name).min(1).default(['public']),
  using: name.optional(),
  check: name.optional(),
  restrictive: z.boolean().default(false),
})
const workspaceSchema = z.strictObject({
  slug: name,
  name: z.string().optional(),
  owner: name.optional(),
  /** What the workspace says of itself: the name it is shown under, its icon, its colour. */
  metadata: metadataSchema,
  collections: z.array(collectionSchema).default([]),
  relations: z.array(relationSchema).default([]),
  grants: z.array(grantSchema).default([]),
  policies: z.array(policySchema).default([]),
})
export const manifestSchema = z
  .strictObject({
    format: z.literal(1).optional(),
    users: z.array(userSchema).default([]),
    groups: z.array(groupSchema).default([]),
    workspaces: z.array(workspaceSchema).default([]),
    // A model file is a manifest of one workspace, written with its contents at the top level.
    workspace: workspaceSchema
      .pick({ slug: true, name: true, owner: true, metadata: true })
      .optional(),
    collections: z.array(z.unknown()).optional(),
    relations: z.array(z.unknown()).optional(),
    grants: z.array(z.unknown()).optional(),
    policies: z.array(z.unknown()).optional(),
  })
  .transform(({ workspace, collections, relations, grants, policies, ...rest }, ctx) => {
    const contents = { collections, relations, grants, policies }
    if (workspace) rest.workspaces.push(workspaceSchema.parse({ ...workspace, ...contents }))
    else if (Object.values(contents).some(Boolean))
      ctx.addIssue({
        code: 'custom',
        message: 'collections, relations, grants and policies belong to a workspace',
      })
    return rest
  })

export type Manifest = z.infer<typeof manifestSchema>
export type ApplyResult = { changes: string[]; unchanged: number }
export type User = z.infer<typeof userSchema>
export type Group = z.infer<typeof groupSchema>
export type Grant = z.infer<typeof grantSchema>
export type Policy = z.infer<typeof policySchema>
export type Workspace = z.infer<typeof workspaceSchema>

/** The roles the platform keeps for itself: they are not managed here. */
export const reserved = (role: string) =>
  /^(pg_.*|platform_core|platform_users|platform_admins)$/.test(role)

/** The manifest, parsed and checked: what an operator's file says. */
export const parseManifest = (raw: unknown): Manifest => manifestSchema.parse(raw)
