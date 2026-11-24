# Constraints

A constraint is a rule PostgreSQL holds about the rows of a collection: the key that points
at another collection, the pair that is unique, the check every row is held by, the emptiness
a field may not have. The platform writes none of them twice: it asks PostgreSQL's catalog
what is there, and it writes the statements that make a rule or take it away.

Everything here is shown before it runs. The interface writes the SQL, shows it, and runs it
as the reader, in one transaction; PostgreSQL is the judge of it, and its refusal is shown
as PostgreSQL's own words and SQLSTATE.

## Where they are managed

A collection's model page holds a **Constraints** tab, beside its fields, its metadata and
its access. It lists what PostgreSQL holds and offers the one change that may be made to
each:

| What is listed  | What it holds                              | What may be done                                    |
| --------------- | ------------------------------------------ | --------------------------------------------------- |
| Foreign keys    | the collections this one points at         | change what happens when the row goes; drop the key |
| Unique keys     | the fields a row is held once by           | drop the key                                        |
| Checks          | the expression every row is held by        | drop the check                                      |
| Required fields | the fields a row may not leave empty       | make a field required or optional                   |
| Indexes         | the ways the rows are found without a scan | drop the index                                      |

A constraint is added with **New constraint**: a unique key over one field or several, a
check with its own SQL, or a foreign key with the collection it points at and what happens
when that row goes.

## The names they are given

A constraint the platform writes is named the way PostgreSQL names its own, so a constraint
written here and one written by hand read the same in the catalog:

| Constraint                 | Name                        |
| -------------------------- | --------------------------- |
| A unique key over `title`  | `articles_title_key`        |
| A check about `word_count` | `articles_word_count_check` |
| A foreign key on `section` | `articles_section_fkey`     |

A name of your own is used when one is given. Names are held to the length PostgreSQL holds
names to: 63 bytes, cut on a character.

## What happens when the row goes

A foreign key says what happens to a row that points at a row that goes away:

| The rule   | What PostgreSQL does                                           |
| ---------- | -------------------------------------------------------------- |
| `restrict` | refuses the delete while a row points at it                    |
| `cascade`  | the rows that point at it go with it                           |
| `set null` | the rows that point at it are let go, and the field is emptied |

The rule is changed by dropping the key and making it again with the new rule, in the one
transaction the change runs in. The rows are left as they are.

## Keys are indexed

PostgreSQL makes no index for a foreign key. The platform makes one when the key is made,
because the rows that point at another are found by it: a scan of the whole table for every
row that points at this one, and the same scan when the parent row goes away.

The index is made once and left alone. Where a unique key already covers the lookup — the
first field of a pair that is unique together — no second index is made for it.

## A manifest says what a key does

A manifest may say what a relation is and what happens when the row goes:

```json
{
  "workspaces": [
    {
      "slug": "newsroom",
      "relations": [
        {
          "collection": "articles",
          "field": "section",
          "related": "sections",
          "on_delete": "restrict"
        }
      ]
    }
  ]
}
```

An apply converges on it: a key that points elsewhere, or that goes another way, is brought
to what the manifest says, and the change is named in the report. A key that is already
what the manifest says is left alone, and a second apply changes nothing.

## What a key may point at

A key points at a **column**, and it is read as the column it names.

| The key points at                            | What the platform does                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The `id` of another collection               | The ordinary case: the row is found by its id                                                                                         |
| Another column — a code, a number of its own | The row is found by that column: the names of the rows, the conditions that cross the key and the search that follows them all use it |
| A collection of another workspace            | The key is read as it is written: the collection is named with its schema                                                             |
| More than one column                         | The key is read as a **constraint**, not as a relation: there is no single row of it to reach, and the model page says so             |

The last one is the boundary of what a relation can be. A key over several columns is a real
PostgreSQL key and the catalog holds it, but there is no one row on the other side of it for
the interface to reach, so it is listed among the constraints and left there. It is written and
dropped as any other key, and PostgreSQL holds every row to it.

A key made by hand is read exactly as a key made by manifest: the platform asks the catalog
which column the key points at, and nowhere assumes it is the target's `id`.

## The links of a record

The links of a record — the rows it is linked to through a join table — are written inside a
transaction, and are refused outside one. The write reads the links that are held, takes the
rows that were asked for, and writes the difference; a lock is held while it does so, so two
editors of the same record cannot undo each other's work. The lock is an advisory one, taken
on the record's own name, and it is held until the transaction ends: outside a transaction it
would be gone before the write began, which is why the links are refused there.

The rows of a record themselves are guarded by the version the reader saw, and say so when
somebody else wrote first. The links are not: they are written as they are read, and the
second writer's set is the one that is held.

## The owner and row security

A collection's owner is exempt from its row security unless it is forced: the policies of a
collection do not reach its owner while it is exempt. The access tab says which of the two
a collection is in, and offers the change either way.

Forcing row security holds the owner to the policies as well. A collection with row security
on, no policy and a forced owner is a collection nobody reaches: it needs a policy before it
is of use to anyone.
