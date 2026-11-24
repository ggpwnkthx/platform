import type { Catalog, ColumnInfo, RelationInfo, TableInfo } from '@platform/core'

/**
 * A small installation: two collections joined by a third, and a collection of children.
 * It is the shape the catalog hands the interface, and nothing more.
 */
const schema = 'newsroom'
const table = (name: string): TableInfo => ({
  schema,
  name,
  kind: 'r',
  rls: false,
  force_rls: false,
  owner: 'admin',
  comment: null,
  system: false,
  can_select: true,
  can_insert: true,
  can_update: true,
  can_delete: true,
  can_truncate: true,
  can_alter: true,
})
const column = (
  of: string,
  name: string,
  type: string,
  more: Partial<ColumnInfo> = {}
): ColumnInfo => ({
  schema,
  table: of,
  name,
  position: 1,
  type,
  required: false,
  default: null,
  comment: null,
  generated: null,
  identity: null,
  can_select: true,
  can_insert: true,
  can_update: true,
  ...more,
})
const relation = (of: string, name: string, target: string): RelationInfo => ({
  schema,
  table: of,
  column: name,
  target_schema: schema,
  target_table: target,
  target_column: 'id',
  on_delete: 'a',
})

export const catalog: Catalog = {
  schemas: [{ name: schema, owner: 'admin', kind: 'user', can_create: true, can_alter: true }],
  tables: ['articles', 'tags', 'article_tags', 'corrections'].map(table),
  columns: [
    column('articles', 'id', 'uuid', { identity: 'a', can_insert: false, can_update: false }),
    column('articles', 'title', 'text'),
    column('tags', 'id', 'uuid', { identity: 'a', can_insert: false, can_update: false }),
    column('tags', 'name', 'text'),
    column('article_tags', 'id', 'uuid', { identity: 'a', can_insert: false, can_update: false }),
    column('article_tags', 'article', 'uuid', { required: true }),
    column('article_tags', 'tag', 'uuid', { required: true }),
    column('corrections', 'id', 'uuid', { identity: 'a', can_insert: false, can_update: false }),
    column('corrections', 'article', 'uuid', { required: true }),
  ],
  relations: [
    relation('article_tags', 'article', 'articles'),
    relation('article_tags', 'tag', 'tags'),
    relation('corrections', 'article', 'articles'),
  ],
  constraints: [],
  types: [],
  indexes: [
    {
      schema,
      table: 'article_tags',
      name: 'article_tags_article_tag_idx',
      columns: ['article', 'tag'],
      unique: true,
      primary: false,
    },
  ],
  joins: [
    {
      schema,
      table: 'article_tags',
      left: {
        column: 'article',
        target_schema: schema,
        target_table: 'articles',
        target_column: 'id',
      },
      right: { column: 'tag', target_schema: schema, target_table: 'tags', target_column: 'id' },
      uniquePair: true,
      payload: [],
    },
  ],
}
