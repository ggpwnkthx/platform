# Fields

A field is a column PostgreSQL holds, met in three situations: a cell in the records grid, a
value or an input in the record form, a condition in the filters. PostgreSQL decides who may
read it and who may write it; a field type decides how it is drawn and typed in.

## What a field is

`fields/resolve.ts` reads a collection's columns from the catalog and their metadata, and
gives each a type. After the columns come the relations read as rows:

- **A relation** is a foreign key over one column. It is drawn as the name of the row it
  points at, where the reader may read that row, and typed in by choosing one.
- **Links** are the rows a join table links a record to. A join table is a collection with
  two foreign keys that are unique together; the collection page makes one in a step. The
  form holds the linked rows' ids, and writing them is a transaction of its own.
- **Children** are the rows of another collection that point at a record. They are counted
  beside the record, and the count leads to them.

A column PostgreSQL computes itself — generated, or an identity — is shown and never offered
as an input. The six columns every collection is made with are shown beside the record.

## Field types

| Type                     | Claims                                  | Input                                                    |
| ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| text, other              | text columns; anything unclaimed        | a line; several lines for a body, notes or a description |
| integer, number          | whole and decimal numbers               | a number                                                 |
| boolean                  | boolean                                 | yes, no or empty                                         |
| date, time, moment, uuid | their PostgreSQL types                  | a line, with the browser's picker where it has one       |
| json                     | json and jsonb                          | a document, checked as JSON                              |
| choice                   | a text column with a `CHECK (… IN (…))` | one of the list                                          |
| relation, links          | a foreign key; a join table             | a row, or rows, chosen by name                           |

The type that claims a field most strongly wins. A site registers its own:

```tsx
import { registerFieldType } from '@platform/ui/extensions'

registerFieldType({
  name: 'colour',
  label: 'Colour',
  claims: (field) => (field.name.endsWith('_colour') ? 50 : 0),
  draw: ({ value }) => <Swatch value={value} />,
  Input: ({ source, label }) => <TextInput source={source} label={label} />,
  operators: ['eq', 'neq', 'is_null', 'not_null'],
})
```

`Input` is a react-admin input bound by its `source`; it serves the record form and the value
of a filter's condition alike.

## Filters and search

A condition is a field, an operator and a value, kept in the address as
`filter={"status":{"op":"eq","value":"published"}}`. The operators are `eq`, `neq`,
`contains`, `starts_with`, `ends_with`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_null`,
`not_null`, and for relations read as rows `has_any`, `has_none`, `has_all`. The search is
case-insensitive across the readable columns and follows a relation to the name of the row on
the other side.

## What the owner says of a field

A field's metadata is kept in `platform.item_metadata` and secured by the field's own rights:
whoever holds a right on the column reads it, and only the collection's owner changes it. It
narrows the interface and grants nothing.

- **`display_name`** — the name people read. A reader who may not read a column never learns
  it.
- **`views`** — where the field appears: `{"list":"hide","record":"readonly","filter":"show"}`.
  The grid and the filters take `show` or `hide`; the record form also takes `readonly`. A
  field that says nothing appears everywhere, and nothing is written for it.
- **`renderers`** — how it is drawn in the grid and in the record:
  `{"list":{"renderer":"truncate","options":{"length":20}}}`.

All three are changed from the collection's page, in the change surface, as statements.

## Renderers

The platform holds `text`, `truncate`, `paragraph`, `number`, `boolean`, `json`, `choice`,
`link`, `template`, `bar` and `raw`. A site registers its own:

```tsx
import { registerRenderer, numberOf } from '@platform/ui/extensions'

registerRenderer({
  name: 'reading-time',
  label: 'As the time it takes to read',
  kinds: ['integer'],
  options: [{ name: 'pace', label: 'Words read in a minute', type: 'number' }],
  render: ({ value, options }) =>
    `${Math.round(numberOf(value)! / (numberOf(options.pace) || 230))} min read`,
})
```

`examples/newsroom/extensions.tsx` registers four. A listed value's tone follows what the
word means (DESIGN.md), and an item's icon and colour are its own metadata: `icon` and `color`
on a workspace or a collection, and `display_field` for the field a record is known by.

## Keys and rules

The collection page lists the constraints and indexes PostgreSQL holds and adds unique keys,
checks, foreign keys and indexes. A constraint carries PostgreSQL's own name
(`<table>_<field>_fkey`). A foreign key made with a field is indexed. What happens when the
row pointed at goes is the key's `ON DELETE`: restrict, cascade or set null.
