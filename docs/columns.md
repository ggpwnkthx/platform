# Columns

A column is met in three situations: a cell in the grid, a
value or an input in the row form, a condition in the filters. PostgreSQL decides who may
read it and who may write it; a column type decides how it is drawn and typed in.

## What a column is

`columns/resolve.ts` reads a table's columns from the catalog and their metadata, and
gives each a type. After the columns come the relations read as rows:

- **A relation** is a foreign key over one column. It is drawn as the name of the row it
  points at, where the reader may read that row, and typed in by choosing one.
- **Links** are the rows a join table links a row to. A join table is a table with
  two foreign keys that are unique together; the table page makes one in a step. The
  form holds the linked rows' ids, and writing them is a transaction of its own.
- **Children** are the rows of another table that point at a row. They are counted
  beside the row, and the count leads to them.

A column PostgreSQL computes itself — generated, or an identity — is shown and never offered
as an input. A new column may be one: computed from the row's other columns by an expression
(`GENERATED ALWAYS AS (…) STORED`), or numbered by PostgreSQL (`GENERATED ALWAYS AS
IDENTITY`). The six columns every table is made with are shown beside the row.

A column that is there may be renamed, given another type — with an expression that converts
each value, or as PostgreSQL converts it — and given another default, as SQL. The six are
kept as they are. A rename carries the column's metadata, and the table's `display_column`
where the table is known by it.

## Column types

| Type                     | Claims                                  | Input                                                    |
| ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| text, other              | text columns; anything unclaimed        | a line; several lines for a body, notes or a description |
| integer, number          | whole and decimal numbers               | a number                                                 |
| boolean                  | boolean                                 | yes, no or empty                                         |
| date, time, moment, uuid | their PostgreSQL types                  | a line, with the browser's picker where it has one       |
| json                     | json and jsonb                          | a document, checked as JSON                              |
| choice                   | a text column with a `CHECK (… IN (…))` | one of the list                                          |
| relation, links          | a foreign key; a join table             | a row, or rows, chosen by name                           |

A new column may also be a duration, a network address, a list of text, searchable text
(`tsvector`) or one of a schema's own types; a type with no column type of its own is drawn as
`other`. The type that claims a column most strongly wins. A site registers its own:

```tsx
import { registerColumnType } from '@platform/ui/extensions'

registerColumnType({
  name: 'colour',
  label: 'Colour',
  claims: (column) => (column.name.endsWith('_colour') ? 50 : 0),
  draw: ({ value }) => <Swatch value={value} />,
  Input: ({ source, label }) => <TextInput source={source} label={label} />,
  operators: ['eq', 'neq', 'is_null', 'not_null'],
})
```

`Input` is a react-admin input bound by its `source`; it serves the row form and the value
of a filter's condition alike.

## Filters and search

A condition is a column, an operator and a value, kept in the address as
`filter={"status":{"op":"eq","value":"published"}}`. The operators are `eq`, `neq`,
`contains`, `matches`, `starts_with`, `ends_with`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_null`,
`not_null`, and for relations read as rows `has_any`, `has_none`, `has_all`. The search is
case-insensitive across the readable columns and follows a relation to the name of the row on
the other side. `matches` is full-text search: the column's words against what the reader typed,
read as a web search reads it (`"a phrase"`, `-not`, `or`), with the `simple` configuration.

## What the owner says of a column

A column's metadata is kept in `platform.item_metadata` and secured by the column's own rights:
whoever holds a right on the column reads it, and only the table's owner changes it. It
narrows the interface and grants nothing.

- **`display_name`** — the name people read. A reader who may not read a column never learns
  it.
- **`views`** — where the column appears: `{"list":"hide","row":"readonly","filter":"show"}`.
  The grid and the filters take `show` or `hide`; the row form also takes `readonly`. A
  column that says nothing appears everywhere, and nothing is written for it.
- **`renderers`** — how it is drawn in the grid and in the row:
  `{"list":{"renderer":"truncate","options":{"length":20}}}`.

All three are changed from the table's page, in the change surface, as statements.

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
on a schema or a table, and `display_column` for the column a row is known by.

## Constraints and indexes

The table page lists the constraints and indexes PostgreSQL holds, as PostgreSQL would
write them again, and adds unique keys, checks, foreign keys, exclusions and indexes. A
constraint carries PostgreSQL's own name (`<table>_<column>_fkey`) unless it is given one. A
foreign key made with a column is indexed. What happens when the row pointed at goes is the
key's `ON DELETE`, and when its id changes its `ON UPDATE`: restrict, cascade or set null. A key
may be checked when the transaction ends (`DEFERRABLE INITIALLY DEFERRED`), and a key or a
check may hold new rows only (`NOT VALID`) until it is validated. An index is over columns or
expressions, of any method PostgreSQL has, partial (`WHERE`) and covering (`INCLUDE`).
Constraints and indexes are renamed in place.

Beside them, the table's own triggers: a function of the schema that returns `trigger`,
called before or after rows are written, for each row or each statement, with an
optional `WHEN`. They are enabled, disabled, renamed and dropped. The triggers that stamp
rows and write their history are the platform's: they are not listed, and the guard keeps
them.

## What a schema holds beside its tables

- **Views.** A query under a name, read like a table and never written. A view reads as
  its reader (`security_invoker`) unless its owner turns that off, which the form warns of: read
  as its owner, it shows every reader what its owner may read. A materialized view keeps the
  rows its owner read when it was last refreshed, has no row security of its own, and is
  refreshed from its change.
- **Functions and procedures.** Arguments, result, language, volatility and body, written
  again with `CREATE OR REPLACE`. A function that runs as its owner (`SECURITY DEFINER`) has its
  search path fixed to `pg_catalog, pg_temp`, and the form says what that asks of its body.
- **Types.** Enums (a value added, or renamed; never taken away), domains, composites and
  ranges. A new column may be given any of them.
- **Sequences.** Made, restarted and changed, and dropped.
