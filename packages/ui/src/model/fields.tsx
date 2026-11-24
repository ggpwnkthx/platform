import {
  dropFieldStatement,
  dropNotNullStatement,
  fieldMetadata,
  fieldStatements,
  fieldTarget,
  fieldViewsStatement,
  ident,
  InvalidName,
  lit,
  metadataRemoval,
  metadataStatement,
  notNullStatement,
  renderersKey,
  renderersValue,
  stmt,
  sql,
} from '@platform/core'
import { defineKind } from '../data/kinds.ts'
import { resolveFields } from '../fields/resolve.ts'
import { Mono, Privilege, Tag } from '../kit/marks.tsx'
import { ownsTable, type Place } from './collections.tsx'

import { type FieldForm, NewField, places, type Row, SaidOfField, words } from './field-inputs.tsx'

/** The fields of a collection, as a kind: what PostgreSQL holds, and what the owner says of each. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const said = (text?: string | null) => text?.trim() || null
export const fields = defineKind<Row, Place, FieldForm>({
  name: 'fields',
  title: 'Fields',
  note: 'A field is a column. PostgreSQL holds its type and its rules; what the owner says of it — its name for people, where it appears, how it is drawn — is its metadata.',
  noun: 'field',
  empty: 'This collection has no field that you may reach.',
  read: async (db, { schema, table }, { catalog, presentations }) =>
    resolveFields(catalog, schema, table, await fieldMetadata(db, schema, table), presentations)
      .filter((f) => f.column)
      .map((f) => ({ ...f, type_name: f.column!.type })),
  key: (row) => row.name,
  columns: [
    {
      source: 'name',
      label: 'Field',
      render: (row) => (
        <>
          <Mono>{row.name}</Mono> {row.label !== row.name && row.label}
        </>
      ),
    },
    {
      source: 'type_name',
      label: 'Type',
      render: (row) => (
        <Mono>{row.relation ? `→ ${row.relation.target_table}` : row.type_name}</Mono>
      ),
    },
    {
      source: 'required',
      label: 'Rules, and where it appears',
      render: (row) => (
        <>
          {row.column!.required && <Tag>required</Tag>} {row.system && <Tag>system</Tag>}{' '}
          {row.computed && <Tag>computed</Tag>}{' '}
          {row.choices && <Tag>{row.choices.join(' · ')}</Tag>}{' '}
          {row.column!.default && !row.system && <Mono>= {row.column!.default}</Mono>}{' '}
          {Object.entries(places)
            .filter(([place]) => row.views[place] !== 'show')
            .map(([place, where]) => (
              <Tag
                key={place}
                color="info"
              >{`${words[row.views[place] as keyof typeof words]} ${where.toLowerCase()}`}</Tag>
            ))}
        </>
      ),
    },
    {
      source: 'column',
      label: 'You may',
      wide: true,
      render: (row) => (
        <>
          <Privilege name="SELECT" held={row.column!.can_select} />
          <Privilege name="INSERT" held={row.column!.can_insert} />
          <Privilege name="UPDATE" held={row.column!.can_update} />
        </>
      ),
    },
  ],
  may: ownsTable,
  Inputs: ({ where, row }) => (row ? <SaidOfField row={row} /> : <NewField where={where} />),
  defaults: (_where, row) =>
    row
      ? {
          display_name: row.label === row.name ? '' : row.label,
          note: row.column!.comment ?? '',
          required: row.column!.required,
          views: { ...row.views } as Record<string, string>,
          renderers: { ...row.renderers } as FieldForm['renderers'],
        }
      : { type: 'text', on_delete: 'restrict', required: false, unique: false, indexed: false },
  create(form, { schema, table }) {
    if (!form.name?.trim()) throw new InvalidName('Name the field.')
    if (form.type === 'relation' && !form.relation)
      throw new InvalidName('Choose the collection the field points at.')
    return fieldStatements(schema, table, {
      name: form.name.trim(),
      type: form.type,
      required: form.required,
      unique: form.unique,
      indexed: form.indexed,
      default: form.default,
      maxLength: form.max_length ?? undefined,
      choices: form.choices
        ?.split(',')
        .map((one) => one.trim())
        .filter(Boolean),
      min: form.min ?? undefined,
      max: form.max ?? undefined,
      note: form.note,
      relation: form.type === 'relation' ? form.relation : null,
      onDelete: form.on_delete,
    })
  },
  update(form, { schema, table }, row) {
    const target = fieldTarget(schema, table, row.name)
    const out: string[] = []
    const name = said(form.display_name)
    if (name !== (row.label === row.name ? null : row.label))
      out.push(
        name
          ? metadataStatement(target, 'display_name', name)
          : metadataRemoval(target, 'display_name')
      )
    if (said(form.note) !== said(row.column!.comment))
      out.push(
        stmt`COMMENT ON COLUMN ${sql.raw(ident(schema, table, row.name))} IS ${lit(said(form.note))}`
      )
    if (!!form.required !== row.column!.required)
      out.push((form.required ? notNullStatement : dropNotNullStatement)(schema, table, row.name))
    if (!same(form.views, row.views)) out.push(fieldViewsStatement(target, form.views))
    const drawn = Object.fromEntries(
      Object.entries(form.renderers ?? {})
        .filter(([, choice]) => choice?.renderer)
        .map(([place, choice]) => [
          place,
          { renderer: choice.renderer, options: choice.options ?? {} },
        ])
    )
    if (!same(renderersValue(drawn), renderersValue(row.renderers)))
      out.push(
        Object.keys(drawn).length
          ? metadataStatement(target, renderersKey, renderersValue(drawn))
          : metadataRemoval(target, renderersKey)
      )
    if (!out.length) throw new Error('Nothing is changed yet.')
    return out
  },
  remove: (row, { schema, table }) => {
    if (row.system) throw new InvalidName(`${row.name} is made with every collection, and stays.`)
    return [dropFieldStatement(schema, table, row.name)]
  },
})
