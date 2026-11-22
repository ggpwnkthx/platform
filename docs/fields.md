# Fields

A field is a column PostgreSQL holds, and the interface meets it in three situations: as a
cell in the records grid, as a value or an input in the record form, and as a condition in
the filter builder. A **field type** owns all of it. It says how a value is drawn in each
situation, which input changes it, what text the form holds for it and which operators a
filter may use — so the pages that show fields ask the field, and none of them asks what kind
of column it is drawing.

Keystone gives every field type a view for each situation and a controller between the form
and the store. The platform keeps that shape, and keeps its own rule: a field type draws and
reads, and PostgreSQL still decides who may read a value and who may write it.

## What a field is

`resolveFields(catalog, schema, table, rows)` reads every field of a collection once, from the
two things the reader was already given: the catalog, and the fields' own metadata.

| A field carries       | Where it comes from                                                                  |
| --------------------- | ------------------------------------------------------------------------------------ |
| `column`, `kind`      | The catalog: the column, and the kind of value its type holds                        |
| `relation`, `choices` | The catalog: a foreign key, and the values a CHECK allows                            |
| `system`, `computed`  | The catalog: a column every collection is made with, or one PostgreSQL writes itself |
| `label`, `named`      | The field's metadata, under `display_name` — or the column's own name                |
| `views`, `hasViews`   | The field's metadata, under `views`; see [views](views.md)                           |
| `renderers`           | The field's metadata, under `renderers`; see [renderers](renderers.md)               |
| `type`                | The field type that claims the column most strongly                                  |

Both answers are the reader's own. PostgreSQL returned the columns they may reach and the
sayings they may read, so a field this reader may not reach has no saying here.

## What type a field is

Nothing is stored about a field's type. It is asked of what PostgreSQL says of the column, and
every type says how strongly it claims such a column:

| Type                                                                             | Claims                                     | Weight |
| -------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| `relation`                                                                       | A column that is a foreign key             | 30     |
| `choice`                                                                         | A column a CHECK holds to a list of values | 20     |
| `text`, `integer`, `number`, `boolean`, `date`, `time`, `moment`, `uuid`, `json` | A column that holds that kind of value     | 10     |
| `other`                                                                          | Every column: the type of last resort      | 1      |

The type with the greatest weight is the field's. Of two that claim a column alike, the one
added last wins, so an installation's own type takes a column from the platform's at the same
weight.

## What a field type says

| It says            | For                                                                             | Without it                       |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------- |
| `draw.list`        | The cell in the records grid                                                    | —                                |
| `draw.record`      | The value in the record: a locked field, a computed column, the sidebar's facts | —                                |
| `draw.filter`      | The value in a filter's chip                                                    | Drawn as the record is           |
| `numeric`          | Setting the column to the right in the grid                                     | Set to the left                  |
| `Input`            | The input in the record form                                                    | —                                |
| `toText`           | The text the form holds for a stored value                                      | The value as the screen shows it |
| `fromText`         | The value a column receives from what was typed, or the error under the field   | The text, trimmed                |
| `wide`             | Whether the field takes the whole width of the form                             | Its name decides                 |
| `filter.operators` | The operators the filter builder offers                                         | —                                |
| `filter.Input`     | The input a condition's value is typed in                                       | A line of text                   |
| `filter.parse`     | The value a condition carries, from what was typed                              | The text itself                  |
| `filter.initial`   | The value a new condition starts with                                           | Empty                            |

The drawings are what the `default` renderer draws. A field that names another renderer for a
situation is drawn by that one instead; its input and its filter are still its type's.

## A field type of the installation's own

The interface is one bundle of static files, so a type is added when it is built. An
installation registers it in the module its `platform.json` names as `extensions`, which the
build puts in the place of `packages/ui/src/extensions.ts` — the seam the interface imports
before any page draws a field (see [renderers](renderers.md)):

```tsx
import { fieldTypeNamed, registerFieldType } from '@platform/ui/fields/registry.ts'
import { lineInput } from '@platform/ui/fields/inputs.tsx'

// Every column of the domain `public.email` is an address: a link in the grid and in the
// record, an input the browser knows is an email, and the filters of a text.
registerFieldType({
  ...fieldTypeNamed('text')!,
  name: 'email',
  label: 'Email address',
  claims: ({ column }) => (column.type === 'public.email' ? 15 : 0),
  draw: {
    list: ({ value }) => <a href={`mailto:${value}`}>{String(value)}</a>,
    record: ({ value }) => <a href={`mailto:${value}`}>{String(value)}</a>,
  },
  Input: lineInput({ inputMode: 'email', mono: false }),
})
```

A type that takes the name of one the platform holds replaces it. A type draws and reads; it
is given the value and the field, never a connection, and it grants nothing.

## Where it is

| What                                  | Where                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- |
| What a field and a field type are     | `packages/ui/src/fields/field.ts`                                           |
| The fields of a collection            | `packages/ui/src/fields/resolve.ts` → `resolveFields`                       |
| The types the platform holds          | `packages/ui/src/fields/types/platform.tsx`                                 |
| The types held, and whose a column is | `packages/ui/src/fields/registry.ts` → `registerFieldType`, `fieldTypeFor`  |
| Between the form and the database     | `packages/ui/src/fields/edit.ts` → `fieldText`, `fieldValue`, `filterValue` |
| The inputs the types share            | `packages/ui/src/fields/inputs.tsx`, `packages/ui/src/fields/relation.tsx`  |
| The renderers, and `Value`            | `packages/ui/src/fields/renderers/renderers.tsx`                            |
| An installation's own                 | The module `platform.json` names as `extensions`                            |
| The records grid and the filters      | `packages/ui/src/content/records/records.tsx`                               |
| The record form                       | `packages/ui/src/content/item/item.tsx` → `RecordField`                     |
