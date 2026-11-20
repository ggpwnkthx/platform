# Renderers

A renderer is how a value is drawn. A field is not one thing drawn one way: the same column is
a cell in the records grid, a value in the record form and a value in the filter builder, and
each of those may want a different drawing. A uuid is eight characters in a cell and
thirty-six in a record. A JSON document is a clipped line in a cell and a document in a
record. A number is a column of digits in a cell and a number with its thousands marked in a
record.

This is where a field says so, in the reserved key `renderers` of its own metadata: one entry
per situation. The places a field appears are told in the reserved key `views` (see
[views](views.md)); this is the other half of that saying — not where a field is, but how its
values are drawn where it is.

## The three kinds of renderer

| Kind           | What it is                                                              | Where it comes from                                   |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| A default one  | The way the field's own type draws a value in that place                | `packages/ui/src/fields/builtin.tsx`                  |
| A custom one   | A renderer of the installation's own, or one the owner configures       | `registerRenderer`, or the options the renderer takes |
| A configurable | The choice of which renderer draws a value, in one place, for one field | The field's own metadata, under the key `renderers`   |

A renderer draws; it never decides. It never says who may read a value, never changes one and
never reaches for the database: PostgreSQL's own rights decided that before the renderer was
called. A renderer that grants nothing also grants no rights — it is presentation, like the
views of a field.

## The saying

A field says how its values are drawn in its own metadata, under the reserved key
`renderers`:

```json
{ "list": "truncate", "record": { "renderer": "template", "options": { "template": "» {value}" } } }
```

Each entry is a situation — `list`, `record`, `filter`, or a view of the owner's own — and the
drawing of the values in it. The drawing is either the name of a renderer, or the name of one
and the options it takes.

The saying is stored in the platform's metadata collection (`platform.item_metadata`), one row per field, under the key
`renderers`:

```
scope      = 'field'
schema_name = the workspace
table_name  = the collection
column_name = the field
key         = 'renderers'
value       = the saying, as jsonb
```

Its rights are the field's own: whoever holds a right on the column reaches the saying, and
only the owner of the collection may change it.

A field that says nothing is drawn as the platform draws it. That is not a fallback bolted on:
it is the rule, and it is why the platform does not write a saying for every field it makes.

## The renderers the platform holds

| Name        | Draws                                          | Fits                     | Options                                    |
| ----------- | ---------------------------------------------- | ------------------------ | ------------------------------------------ |
| `default`   | The platform's own way, by kind and by place   | Everything               | —                                          |
| `text`      | The text, in full                              | Text                     | —                                          |
| `truncate`  | The text, shortened with an ellipsis           | Text                     | `length`: characters to keep               |
| `paragraph` | The text, as it was typed, line breaks and all | Text                     | —                                          |
| `number`    | The number, with its thousands marked          | Numbers                  | —                                          |
| `boolean`   | Yes or no, in words                            | Booleans                 | —                                          |
| `moment`    | The whole moment, as PostgreSQL wrote it       | Moments, dates and times | —                                          |
| `uuid`      | The whole uuid                                 | UUIDs                    | —                                          |
| `json`      | The document, as a document                    | JSON                     | —                                          |
| `choice`    | The value, as the choice it is                 | Text                     | —                                          |
| `link`      | The text, as a link                            | Text                     | `href`: the address, with `{value}` in it  |
| `template`  | The value, as the owner wrote it               | Everything               | `template`: the text, with `{value}` in it |
| `bar`       | The number, as a bar of a whole                | Numbers                  | `max`: the whole                           |
| `raw`       | The value, as PostgreSQL wrote it              | Everything               | —                                          |

A renderer that does not fit the kind of value is not offered: a bar is of a number, and a
document is of a JSON value.

## The defaults, by place

The default renderer is not one drawing but a drawing that depends on where the value is.
The grid is narrow and the record is wide:

| Kind of value | In the grid (`list`)              | In the record (`record`)            |
| ------------- | --------------------------------- | ----------------------------------- |
| Text          | Clipped, with the whole in a hint | The text, wrapped where it falls    |
| Number        | As it was written, in digits      | With its thousands marked           |
| Yes or no     | A mark                            | Yes or no, in words                 |
| Moment        | To the minute                     | The whole moment, as it was written |
| UUID          | The first eight characters        | The whole uuid                      |
| JSON          | One clipped line                  | The document                        |
| A relation    | The name of the row it points at  | The name, and the id beside it      |
| A choice      | A chip, coloured by what it means | The choice itself                   |

These drawings belong to the field's own type — a text, a number, a choice, a relation — which
also owns the field's input and its filter; see [fields](fields.md). The `default` renderer
asks the type and draws what it says.

So a field that says nothing is already drawn differently in each place. The saying is for the
cases the platform's own drawing does not answer: a title that must be shortened to twenty
characters in a cell, a link that should be a link, a number that should be a bar.

The record form is half inputs: a field the reader may change is an input, and an input is
not a drawing. The record draws the values it shows rather than offers — a field the owner
has locked, a column PostgreSQL computes itself, and the facts in the sidebar — and those
are drawn the way the record says they are drawn.

## Pointing a field at a renderer

### In the interface

On the field's own drawer — the metadata button in the field table of the Data model page —
under **How it is drawn**: choose what draws the field in the list, in the record and in the
filters, and save. The statements that will run are shown before they run, as they are
everywhere else in the interface, and they run as you, in one transaction.

A renderer that takes options is given them under it. `truncate` takes the number of
characters to keep, `link` the address, `template` the text, `bar` the whole.

An option says how it is given. A text and a number are typed; an icon is picked from the
platform's own set, and a colour from its palette — the same pickers an item's own mark is
chosen with. Whichever it is, it is kept the same way: a name and a value under `options`,
an icon by its name (`"newspaper"`) and a colour by its family's (`"steel"`).

### In a manifest

The field carries the drawing it should have:

```json
{
  "name": "title",
  "type": "string",
  "renderers": {
    "list": "truncate",
    "record": { "renderer": "template", "options": { "template": "» {value}" } }
  }
}
```

The manifest is applied in one transaction with everything else it says.

### In SQL

As the owner of the collection, with the reader's own rights and PostgreSQL's own judgement:

```sql
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ('field', 'newsroom', 'articles', 'title', 'renderers',
        '{"list":"truncate"}'::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;
```

## A renderer that cannot be read

A renderer the field names that the platform does not hold draws nothing: the value is drawn
as the platform draws it. The same is true of a renderer that does not fit the kind of value
— a `bar` said of a text is not drawn. A field is never lost by a saying that cannot be
read, and a value is never lost either.

A name the installation has not registered yet is kept as it was said, so a saying may wait
for the renderer that will draw it.

## A renderer of the installation's own

An installation may add a renderer of its own. A renderer is one way of drawing a value: it
is given the value, the kind of value it is and the place it is drawn in, and it draws.

```tsx
// examples/newsroom/extensions.tsx
import { registerRenderer } from '@platform/ui/fields/renderers.tsx'
import { numberOf } from '@platform/ui/fields/text.ts'

registerRenderer({
  name: 'reading-time',
  label: 'As the time it takes to read',
  kinds: ['integer'],
  situations: [],
  render: ({ value }) => (
    <span>{Math.max(1, Math.round((numberOf(value) ?? 0) / 230))} min read</span>
  ),
})
```

The interface is one bundle of static files, so a renderer is added when it is built. The
interface imports `packages/ui/src/extensions.ts` before any page draws a field, and the
platform itself adds nothing there: that module is a seam. A site names a module of its own
in its `platform.json`, and the build puts it in the seam's place — in the prerendered pages
and in the bundle alike, in a development build and a production one:

```json
{ "mode": "development", "database": "install.ts", "extensions": "extensions.tsx", "out": ".dist" }
```

The module is the site's: it is kept beside the site's configuration, it is compiled as the
site's own `tsconfig.json` says (so its JSX is Preact's when the site says so, as the
example does), and it registers with what `@platform/ui` publishes —
`@platform/ui/fields/renderers.tsx` and `@platform/ui/fields/registry.ts`, with the types in
`@platform/ui/fields/types.ts` and the shared helpers in `@platform/ui/fields/text.ts` and
`@platform/ui/fields/inputs.tsx`. A site that draws with JSX depends on `preact` itself. The
example's renderer is said of `newsroom.articles.word_count` in the grid by the example's
`models.json`.

### Icons and colours

The platform holds no renderer that draws an icon or a colour, but it publishes what one is
drawn with: its icon set (`@platform/ui/ui/icons.tsx` → `itemIcons`, `iconFor`) and its
palette (`@platform/ui/metadata/color.ts` → `familyOf`, `toneClass`; the `tone-<family>`
classes give `--tone-fill` and `--tone-ink`). The example registers three:

| Name     | Draws                                                | Fits       | Options                                |
| -------- | ---------------------------------------------------- | ---------- | -------------------------------------- |
| `icon`   | A text that names an icon, as the icon               | Text       | —                                      |
| `colour` | A text that names a colour, as a swatch beside it    | Text       | —                                      |
| `marked` | Any value, with an icon and a colour the owner picks | Everything | `icon`, `colour`: picked in the drawer |

In the first two the value carries the name. In the third the owner does, and picks it: an
option a renderer declares with `type: 'icon'` or `type: 'colour'` is drawn as a picker in
the field's drawer, not as a line of text.

```tsx
registerRenderer({
  name: 'marked',
  label: 'With an icon and a colour you pick',
  kinds: [],
  situations: [],
  options: [
    { name: 'icon', label: 'The icon beside the value', type: 'icon' },
    { name: 'colour', label: 'The colour it is drawn in', type: 'colour' },
  ],
  render: ({ value, options }) => {
    /* iconFor(options.icon), toneClass(options.colour) */
  },
})
```

A value that is itself chosen from a list needs neither: a text column with a CHECK is a
choice, with a select for its input and a chip for its drawing.

The name is then offered in the editor, and a field may say it in any situation, like any
other. A renderer is asked to draw one kind of value in one place at a time, and it is given
what it needs: the value, the field it belongs to, the name of the row a relation points at,
the values a choice may take, and the options the owner gave it.

## Where it is drawn

| What                             | Where                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------- |
| The renderers the platform holds | `packages/ui/src/fields/renderers.tsx` → `registerRenderer`                   |
| The drawings of each field type  | `packages/ui/src/fields/builtin.tsx` → `draw`                                 |
| The saying of a field            | `packages/vocabulary/src/metadata.ts` → `parseRenderers`                      |
| The fields of a collection       | `packages/ui/src/fields/resolve.ts` → `resolveFields`                         |
| The drawing of a value           | `packages/ui/src/fields/renderers.tsx` → `Value`                              |
| The records grid                 | `packages/ui/src/content/records.tsx` → `Value`, with `situation="list"`      |
| The record form                  | `packages/ui/src/content/item.tsx` → `Value`, with `situation="record"`       |
| The editor                       | `packages/ui/src/metadata/editors/renderers.tsx` → `RenderersEditor`          |
| The pickers of an option         | `packages/ui/src/metadata/editors/pickers.tsx` → `IconPicker`, `ColourPicker` |
| The marks in the field table     | `packages/ui/src/model/model.tsx` → the _Drawn as_ column                     |
| The key of the saying            | `packages/vocabulary/src/core.ts` → `renderersKey`                            |
| An installation's own            | The module `platform.json` names as `extensions`                              |

Every one of them reads the same saying, in the same way: the field's own metadata, read
under PostgreSQL's row security, so the fields it names are the ones the reader may reach.
