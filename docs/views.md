# Views

A view is a place a field is drawn: the records grid, the record form, the filter builder.
The owner of a collection says where each of its fields belongs, and the interface draws them
accordingly. This is the whole of it — how the saying is written, where it lives, how the
default is changed, how a view of your own is added, and how a field is pointed at a view
other than the default.

The pages that draw the fields are described in [interface](interface.md), and the manifest
that carries a saying is described in [applying changes](apply.md).

## The saying

A field says where it appears in its own metadata, under the reserved key `views`:

```json
{ "list": "show", "record": "show", "filter": "show" }
```

Three situations are the ones the interface draws:

| Situation | Where it is drawn  | Modes it may be told       |
| --------- | ------------------ | -------------------------- |
| `list`    | the records grid   | `show`, `hide`             |
| `record`  | the record form    | `show`, `readonly`, `hide` |
| `filter`  | the filter builder | `show`, `hide`             |

`readonly` means shown, but never as an input: the record shows the value and the reader
cannot change it there. Only the record form may be locked; a cell and a filter are read
either way, and a saying of `readonly` for one of them is read as `show`.

Any other name in the object is a view of the owner's own — an export, a print sheet, a
screen of your own making. The platform keeps it and hands it back; it draws only the three
situations above. See [adding a view](#adding-a-view).

The saying is stored in `platform.item_metadata`, one row per field, under the key `views`:

```
scope      = 'field'
schema_name = the workspace
table_name  = the collection
column_name = the field
key         = 'views'
value       = the saying, as jsonb
```

Its rights are the field's own: whoever holds a right on the column reaches the saying, and
only the owner of the collection may change it. A reader who may not read a column never
learns what it is called, and never learns where it is drawn.

The saying narrows the interface and grants nothing. A field hidden from the grid is still
PostgreSQL's to read and to write, and the reader may still reach it in psql.

## Every field carries its own

A field that says nothing appears everywhere — but that is a fallback, not the rule. The
platform writes a saying for every field it makes: the collection's own fields, and the six
fields every collection is made with (`id`, `created_at`, `updated_at`, `created_by`,
`updated_by`, `version`). The saying is written in the same statements that make the field,
in the same transaction, so a field and its saying arrive together or not at all.

A collection made before this was true can be given the sayings it lacks, in one statement,
from the Data model page: **Give every field its own views**, on the collection's Fields tab.
Only the fields that say nothing are given one; the fields that already say something keep
what they say.

## The default views

The default saying is written in one place:

```
packages/sql/src/core.ts    defaultViews
```

```ts
export const defaultViews = { list: 'show', record: 'show', filter: 'show' } as const
```

It is the one the interface and the operator's tools both build their statements from, so
changing it changes what the platform writes when it makes a field. A saying of the owner's
own is laid over it: the three situations are always there.

### Changing it

1. Edit `defaultViews` in `packages/sql/src/core.ts`. Nothing else in the interface or the
   CLI has to change — both build their statements from it.
2. The seed of the development build carries the same saying, written out in
   `packages/ui/src/dev/seed.sql`. Update the rows there too: the test
   `packages/ui/test/seed.test.ts` holds the seed to the default and fails until you do.
3. Fields that already carry a saying keep it. The default is what a field is _given_, not
   what it is _held to_.

### Applying a new default to the fields that carry the old one

The fields that say nothing get the new default from **Give every field its own views**. The
fields that already say something keep what they say, so a change of the default does not
reach them. To put the new default on every field of a collection, write it yourself, as the
owner of the collection:

```sql
UPDATE platform.item_metadata
   SET value = '{"list":"show","record":"show","filter":"show"}'::jsonb
 WHERE scope = 'field' AND schema_name = 'newsroom' AND table_name = 'articles'
   AND key = 'views';
```

The platform's own trigger stamps the row: the version moves on, and the writer and the time
are recorded. It is one transaction, and PostgreSQL's own rights decide whether it runs.

## Adding a view

### A view of your own

A view of the owner's own needs no code. It is a name and a mode, in the saying of a field.

In the interface, on the field's own drawer — the metadata button in the field table of the
Data model page, which opens _Metadata of the field_ — under **Where it appears**: name it
under _Name a view of your own_, choose its mode, and save. The name may carry letters,
digits, underscores and dashes, and may not take the name of a situation the interface draws.

In a manifest, in the field itself:

```json
{ "name": "title", "type": "string", "views": { "export": "hide" } }
```

The manifest is applied in one transaction with everything else it says, and the saying is
laid over the default: the three situations keep the default, and the view of your own is
added to them.

In SQL, as the owner of the collection:

```sql
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ('field', 'newsroom', 'articles', 'title', 'views',
        '{"list":"show","record":"show","filter":"show","export":"hide"}'::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;
```

The platform keeps what it is told: the view is read back with the field's metadata, by
whoever may read the column, and it is shown in the field table beside the three situations
the interface draws.

### The code of each view

A view is a place, and a place is drawn by a component. This is where each of them is drawn,
and what the saying does there:

| Situation | The place          | The TSX that draws it                                   | What the saying does there                                                                                                                                                                               |
| --------- | ------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`    | the records grid   | `packages/ui/src/content/records.tsx`                   | `inList` picks the columns the grid shows: the sortable header cells and the cell of every row. A field kept out of the grid is not a column of it; it is still readable, and the search still reads it. |
| `record`  | the record form    | `packages/ui/src/content/item.tsx`                      | `inRecord` picks the fields the form offers, `isLocked` shows a field without offering it as an input, and the fields the owner keeps out are named under _Not in the record_.                           |
| `filter`  | the filter builder | `packages/ui/src/content/records.tsx` → `FilterBuilder` | `inFilter` picks the fields the builder offers. A field kept out of the filters cannot be filtered on.                                                                                                   |
| —         | the field table    | `packages/ui/src/model/model.tsx`                       | The saying is drawn as a small word per situation, struck through where the field is kept out, with the views of the owner's own beside them.                                                            |
| —         | the field's drawer | `packages/ui/src/metadata/metadata.tsx` → `ViewsEditor` | Where the owner says it: the three situations, the views of the owner's own, and the statements that will run.                                                                                           |

Every one of them reads the same saying, in the same way: the field's own metadata, read
under PostgreSQL's row security, so the fields it names are the ones the reader may reach.

```ts
const views = indexViews(loaded.data?.described ?? [])
const listed = readable.filter((c) => inList(viewsOf(views, c.name)))
```

`indexViews` files every field's saying by the column it names; `viewsOf` reads one field's
saying, and answers for a field that says nothing. The helpers — `inList`, `inRecord`,
`inFilter` — are the questions a place asks about a field.

A view of the owner's own has no component in the platform: the platform draws the three it
knows, and the saying is the handover. Drawing a custom view is the deployment's business —
its own component, reading the same saying, wherever it lives.

### A new situation the interface draws

A view the interface itself draws is a situation, and a situation is code. These are the
places that hold one:

| What                                          | Where                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| The situations and the order they are offered | `packages/ui/src/metadata/views.ts` → `situations`                               |
| What each situation is called                 | `packages/ui/src/metadata/views.ts` → `situationLabels`                          |
| What a situation may be told                  | `packages/ui/src/metadata/views.ts` → `modeLabels`, and the rule in `parseViews` |
| The default saying                            | `packages/sql/src/core.ts` → `defaultViews`                                      |
| The editor                                    | `packages/ui/src/metadata/metadata.tsx` → `ViewsEditor`                          |
| The records grid                              | `packages/ui/src/content/records.tsx` → `inList`                                 |
| The record form                               | `packages/ui/src/content/item.tsx` → `inRecord`, `isLocked`                      |
| The filter builder                            | `packages/ui/src/content/records.tsx` → `inFilter`                               |
| The marks in the field table                  | `packages/ui/src/model/model.tsx` → the situation marks                          |

To add one:

1. Name it in `situations`, and say what it is called in `situationLabels`.
2. Give it a default in `defaultViews`.
3. Say what the interface does with it: the three helpers — `inList`, `inRecord`, `inFilter`
   — answer for the three situations the interface draws today, so a new one needs its own
   helper and a place that draws it.
4. Add it to the editor, so the owner may say where a field belongs in it.
5. Say whether it may be locked. `parseViews` reads a saying of `readonly` for any situation
   but the record as `show`; a situation that may be locked is changed there.
6. Cover it in `packages/ui/test/views.test.ts`.

A new situation is read and written like any other: `parseViews` reads every name in
`situations`, and `viewsValue` writes them all back. The owner's own views are kept beside
them.

### What a new view needs of the interface

A new situation is a place, and a place is a component and a page. To draw one:

1. **A component** that draws the fields of the view, in the domain it belongs to — beside
   the records grid, the record form or the filter builder, or on a page of its own.
2. **A helper** beside `inList`, `inRecord` and `inFilter`, so that every place that draws a
   view asks the same question of a field's saying:

   ```ts
   /** Is the field drawn in the print sheet? */
   export const inPrint = (views: FieldViews): boolean => views.print !== 'hide'
   ```

3. **The saying**, read the way every other place reads it — `indexViews` over the field's
   metadata, and `viewsOf` for one field — so the fields the new view names are the ones the
   reader may reach, by PostgreSQL's own row security.
4. **The editor**, so the owner may say where a field belongs in it: a choice in
   `ViewsEditor`, with the modes the view takes.
5. **A route**, if the view is a page of its own: `packages/ui/src/routes.ts` names the pages
   the generator writes — one file each — and `packages/ui/src/app.tsx` routes them.

A view that is only a place in a page — a section of the record page, say — needs no route
of its own: the component is drawn where the page draws it, and the saying says which fields
it takes.

## Pointing a field at another view

### In the interface

On the field's own drawer, under **Where it appears**: choose what the field does in
the list, in the record and in the filters, and save. The statements that will run are shown
before they run, as they are everywhere else in the interface, and they run as you, in one
transaction. The catalog is read again afterwards.

A field of a type PostgreSQL computes itself — a generated column, an identity column — is
shown and locked whatever the owner says, because the database writes it.

### In a manifest

The field carries the saying it should have:

```json
{
  "name": "internal_notes",
  "type": "string",
  "views": { "list": "hide", "record": "show", "filter": "hide" }
}
```

`apply` writes it with the field, in the same transaction as the column. A field that is
already in place keeps the saying it has — including none at all: a field made before the
platform wrote sayings is given the default by **Give every field its own views**, not by
the manifest. Apply adds and adjusts, and it never retypes a column.

### In SQL

As the owner of the collection, with the reader's own rights and PostgreSQL's own
judgement:

```sql
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ('field', 'newsroom', 'articles', 'internal_notes', 'views',
        '{"list":"hide","record":"show","filter":"hide"}'::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;
```

To change a saying that is already there, guarded by the version it carried — so that a
change made elsewhere is not silently overwritten:

```sql
UPDATE platform.item_metadata SET value = $1::jsonb
 WHERE scope = 'field' AND schema_name = 'newsroom' AND table_name = 'articles'
   AND column_name = 'internal_notes' AND key = 'views' AND version = $2;
```

The interface writes the same statement with the literal escaped — `E'...'` — and shows it
before it runs, as it shows every statement that changes the model or access.

### What the platform does with it

The records grid shows the fields whose `list` is not `hide`. The record form shows the
fields whose `record` is not `hide`, locks the ones whose `record` is `readonly`, and says
which fields the owner keeps out of it. The filter builder offers the fields whose `filter`
is not `hide`. The search still reads every readable column: a search is a question to the
database, not a view of it.
