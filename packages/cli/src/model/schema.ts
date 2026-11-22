import { z } from 'zod'
import { renderersKey, viewsKey } from '@platform/vocabulary'

/**
 * The types a manifest may name. The platform's own are here; any other name is a type of
 * the database — `geometry` and `geography` where PostGIS is installed, an enum or a domain
 * of the installation's own — and is written as it is, qualified with the schema it lives in.
 * Two names are the platform's own under another name: `string` is a text and `m2o` is a
 * relation, which is a uuid. The storage type is written once, for the manifests and the
 * interface alike.
 */
/** A type name: one of the platform's own, or a name of the database's, qualified or not. */
const typeName = z
  .string()
  .min(1)
  .refine((name) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name), {
    message: 'A type is a name, or a name qualified with the schema it lives in.',
  })
/**
 * What an item says of itself: the keys of its own metadata and their values, as they are
 * kept in `platform.item_metadata`. `display_name`, `icon` and `color` are the ones the
 * platform reads; any other key is kept and handed back.
 */
export const metadataSchema = z.record(z.string().min(1), z.unknown()).default({})
export const fieldSchema = z.object({
  name: z.string().min(1),
  type: typeName,
  /** The type's own modifiers: `Point, 4326` for a geometry. */
  modifiers: z.array(z.string().min(1)).default([]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  default: z.unknown().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  /**
   * Where the field appears: `list`, `record` and `filter`, and any view of the owner's own.
   * A field that says nothing gets the platform's default views.
   */
  views: z
    .record(z.string(), z.enum(['show', 'hide', 'readonly']))
    .optional()
    .default({}),
  /**
   * How the field's values are drawn, in each of the situations: the name of a renderer, or
   * the name of one and the options it takes. A field that says nothing is drawn as the
   * platform draws it.
   */
  renderers: z.record(z.string(), z.unknown()).optional().default({}),
  /** What the field says of itself, beside where it appears and how it is drawn. */
  metadata: metadataSchema.refine(
    (metadata) => !(viewsKey in metadata) && !(renderersKey in metadata),
    { message: 'A field says where it appears in `views` and how it is drawn in `renderers`.' }
  ),
  relation: z
    .object({
      collection: z.string(),
      on_delete: z.enum(['restrict', 'cascade', 'set_null']).default('restrict'),
    })
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
  name: z.string().min(1),
  fields: z.array(fieldSchema).default([]),
  label: z.string().optional(),
  /** What the collection is for: the comment PostgreSQL keeps on the table. */
  note: z.string().optional(),
  /**
   * Whether the collection asks for row policies. A collection is made asking for them;
   * false is one everybody who may read it reads whole. Omitted leaves it as it is.
   */
  row_security: z.boolean().optional(),
  /** What the collection says of itself. */
  metadata: metadataSchema,
})
export type Field = z.infer<typeof fieldSchema>
