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
| `link`                | The catalog: the rows a record is linked to, and how it reaches them                 |
| `system`, `computed`  | The catalog: a column every collection is made with, or one PostgreSQL writes itself |
| `label`, `named`      | The field's metadata, under `display_name` — or the column's own name                |
| `views`, `hasViews`   | The field's metadata, under `views`; see [views](views.md)                           |
| `renderers`           | The field's metadata, under `renderers`; see [renderers](renderers.md)               |
| `type`                | The field type that claims the column most strongly                                  |

Both answers are the reader's own. PostgreSQL returned the columns they may reach and the
sayings they may read, so a field this reader may not reach has no saying here.

## What a relation is, in the interface

A relation is a foreign key, and PostgreSQL holds it. The interface reads it three ways,
and the shape of the schema says which is which — nothing is declared, and nothing is
guessed at:

| The relation | What the catalog sees                                    | The field it is                                           |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------- |
| Many to one  | A column with a foreign key                              | `relation`: one row, held by its id                       |
| One to many  | A foreign key in another table that points at this one   | `children`: the rows that point here, read and counted    |
| Many to many | A table of two foreign keys and a unique index over both | `links`: the rows on the other side, written as join rows |

A table is a join table when it is made of two keys and nothing else, and a unique index
covers both of them. The pair is then one link, and it may be written with `ON CONFLICT
DO NOTHING`. A table with a third column of its own is not a join table: it is a
collection like any other, and the interface treats it as one.

`children` and `links` have no column of their own — they are **virtual fields**, read and
written as rows. They are shown in the record form and in the filters, and kept out of the
grid: a grid of links would ask every row of every page for a count of its own.

## What type a field is

Nothing is stored about a field's type. It is asked of what PostgreSQL says of the column, and
every type says how strongly it claims such a column:

| Type                                                                             | Claims                                     | Weight |
| -------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| `relation`                                                                       | A column that is a foreign key             | 30     |
| `links`, `children`                                                              | A relation read as rows, not as a column   | 30     |
| `choice`                                                                         | A column a CHECK holds to a list of values | 20     |
| `text`, `integer`, `number`, `boolean`, `date`, `time`, `moment`, `uuid`, `json` | A column that holds that kind of value     | 10     |
| `other`                                                                          | Every column: the type of last resort      | 1      |

The type with the greatest weight is the field's. Of two that claim a column alike, the one
added last wins, so an installation's own type takes a column from the platform's at the same
weight.

## What a field type says

| It says       | For                                                                                                    | Without it          |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------- |
| `draw.list`   | The cell in the records grid                                                                           | —                   |
| `draw.record` | The value in the record and in a filter's chip: a locked field, a computed column, the sidebar's facts | —                   |
| `numeric`     | Setting the column to the right in the grid                                                            | Set to the left     |
| `Input`       | The input in the record form                                                                           | —                   |
| `toForm`      | What the form holds for a stored value                                                                 | The value as text   |
| `fromForm`    | The value a column receives from what the form holds, or the error under the field                     | What the form holds |
| `operators`   | The operators the filter builder offers                                                                | —                   |
| `parseFilter` | The value a condition carries, from what was typed                                                     | The text itself     |
| `FilterInput` | The input a condition is given, when text is not enough to say it                                      | A text input        |

The drawings are what the `default` renderer draws. A field that names another renderer for a
situation is drawn by that one instead; its input and its filter are still its type's.

A relation's `FilterInput` is the same picker the form offers: the reader picks rows by
their names, and the condition carries their ids. A condition that crosses a relation — is
linked to any of them, to none of them, or to all of them — is asked of the table that holds
the links, with `EXISTS`.

A condition may be on the rows a relation reaches rather than on the rows themselves: the
filter builder offers **…by the rows it reaches**, and the reader picks one of their own
columns and says what it should be. The reach of the field says how the rows are found — a
column of the record's own table, or a table of links — and the same reach is used for the
search, which follows the names of the rows on the other side.

## A field type of the installation's own

The interface is one bundle of static files, so a type is added when it is built. An
installation registers it in the module its `platform.json` names as `extensions`, which the
build puts in the place of the module `virtual:platform-site` (`packages/ui/vite.config.ts`) — the seam the interface imports
before any page draws a field (see [renderers](renderers.md)):

```tsx
import { fieldTypeNamed, registerFieldType } from '@platform/ui/extensions'

// Every column of the domain `public.email` is an address: a link in the grid and in the
// record, with the input and the filters of a text.
registerFieldType({
  ...fieldTypeNamed('text')!,
  name: 'email',
  label: 'Email address',
  claims: (field) => (field.column.type === 'public.email' ? 15 : 0),
  draw: {
    list: ({ value }) => <a href={`mailto:${value}`}>{String(value)}</a>,
    record: ({ value }) => <a href={`mailto:${value}`}>{String(value)}</a>,
  },
})
```

A type that takes the name of one the platform holds replaces it. A type draws and reads; it
is given the value and the field, never a connection, and it grants nothing.

## Where it is

| What                                  | Where                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- |
| What a field and a field type are     | `packages/ui/src/fields/types.ts`                                           |
| The fields of a collection            | `packages/ui/src/fields/resolve.ts` → `resolveFields`                       |
| The types the platform holds          | `packages/ui/src/fields/basic.tsx`                                          |
| The types held, and whose a column is | `packages/ui/src/fields/registry.ts` → `registerFieldType`                  |
| The relations, and the rows of them   | `packages/ui/src/fields/links.tsx`, `packages/ui/src/fields/relation.tsx`   |
| Between the form and the database     | `packages/ui/src/fields/filters.ts` → `filterValue`                         |
| The inputs the types share            | `packages/ui/src/fields/basic.tsx`, `packages/ui/src/fields/picker.tsx`     |
| The renderers, and `Value`            | `packages/ui/src/fields/renderers.tsx`                                      |
| An installation's own                 | The module `platform.json` names as `extensions`                            |
| The records grid and the filters      | `packages/ui/src/content/records.tsx`, `packages/ui/src/content/filter.tsx` |
| The record form                       | `packages/ui/src/content/form.tsx`                                          |
| The rows that point at a record       | `packages/ui/src/content/related.tsx`                                       |
