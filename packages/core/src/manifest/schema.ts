import { z } from 'zod'
import { type FieldSpec, onDeleteActions } from '../sql/columns.ts'
import { renderersKey, viewsKey } from '../sql/metadata.ts'
import { schemaPrivileges, tablePrivileges } from '../sql/privileges.ts'
const name = z.string().min(1)
const state = z.enum(['present', 'absent']).default('present')
/** The ways a row that points at another may go: the ones the statements know. */
const onDelete = z.enum(
  Object.keys(onDeleteActions) as [
    keyof typeof onDeleteActions,
    ...(keyof typeof onDeleteActions)[],
  ]
)
const metadataSchema = z.record(name, z.unknown()).default({})
const fieldSchema = z.object({
  name,
  type: name.regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/, {
    message: 'A type is a name, or a name qualified with the schema it lives in.',
  }),
  modifiers: z.array(name).default([]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  default: z.unknown().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  views: z.record(z.string(), z.enum(['show', 'hide', 'readonly'])).default({}),
  renderers: z.record(z.string(), z.unknown()).default({}),
  metadata: metadataSchema.refine((m) => !(viewsKey in m) && !(renderersKey in m), {
    message: 'A field says where it appears in `views` and how it is drawn in `renderers`.',
  }),
  relation: z
    .object({ collection: z.string(), on_delete: onDelete.default('restrict') })
    .optional(),
  options: z
    .object({
      max_length: z.number().int().positive().optional(),
      choices: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .default({}),
})
export const collectionSchema = z.object({
  name,
  fields: z.array(fieldSchema).default([]),
  /** Columns that are unique together: the pair a join table is made of. */
  unique: z.array(z.array(name).min(2)).default([]),
  label: z.string().optional(),
  note: z.string().optional(),
  row_security: z.boolean().optional(),
  metadata: metadataSchema,
})
export const relationSchema = z.object({
  collection: name,
  field: name,
  related: name,
  on_delete: onDelete.optional(),
  onDelete: onDelete.optional(),
})
const userSchema = z.strictObject({
  name,
  state,
  login: z.boolean().default(true),
  admin: z.boolean().optional(),
  connections: z.number().int().min(-1).optional(),
  groups: z.array(name).default([]),
  admits: z.array(name).default([]),
})
const groupSchema = z.strictObject({ name, state })
const privilegeNames = [...schemaPrivileges, ...tablePrivileges, 'ALL'].map((p) => p.toLowerCase())
const grantSchema = z.strictObject({
  to: z.union([name, z.array(name).min(1)]),
  privileges: z.array(z.enum(privilegeNames)).min(1),
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
export const workspaceSchema = z.strictObject({
  slug: name,
  name: z.string().optional(),
  owner: name.optional(),
  metadata: metadataSchema,
  collections: z.array(collectionSchema).default([]),
  relations: z.array(relationSchema).default([]),
  grants: z.array(grantSchema).default([]),
  policies: z.array(policySchema).default([]),
})
/** Users, groups and workspaces; a lone `workspace` with its contents beside it is one more. */
export const manifestSchema = z
  .strictObject({
    format: z.literal(1).optional(),
    users: z.array(userSchema).default([]),
    groups: z.array(groupSchema).default([]),
    workspaces: z.array(workspaceSchema).default([]),
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
export type Field = z.infer<typeof fieldSchema>
export type Collection = z.infer<typeof collectionSchema>
export type Relation = z.infer<typeof relationSchema>
export type Workspace = z.infer<typeof workspaceSchema>
export type User = z.infer<typeof userSchema>
export const parseManifest = (raw: unknown): Manifest => manifestSchema.parse(raw)

export const fieldSpec = (field: Field): FieldSpec => ({
  name: field.name,
  type: field.type,
  modifiers: field.modifiers,
  required: field.required,
  unique: field.unique,
  indexed: field.indexed,
  default: field.default,
  maxLength: field.options.max_length,
  choices: field.options.choices,
  min: field.options.min,
  max: field.options.max,
  note: field.note ?? field.label,
  relation: field.relation?.collection ?? null,
  onDelete: field.relation?.on_delete,
  views: field.views,
  renderers: field.renderers,
})
