---
name: Platform Studio
description: The interface of the Platform — a light headless-CMS data studio where every right, filter and refusal on screen is PostgreSQL's own answer.
colors:
  studio-orange: "#f15a2b"
  studio-orange-ink: "#ad401e"
  orange-wash: "#f9e0d9"
  orange-wash-deep: "#f7cabc"
  signal-blue: "#449fd8"
  signal-blue-ink: "#3379a5"
  signal-blue-wash: "#e0edf5"
  signal-blue-wash-deep: "#c7e1f0"
  success-green: "#6cbe4f"
  success-green-ink: "#3e702d"
  success-green-wash: "#e6f2e5"
  warning-amber: "#f1ad29"
  warning-amber-ink: "#7f5c24"
  warning-amber-wash: "#f9eed9"
  danger-red: "#ee2a3d"
  danger-red-ink: "#ab1d2b"
  danger-red-wash: "#f8d5d8"
  garden-mint: "#65c081"
  garden-mint-ink: "#366745"
  storm-steel: "#5379a3"
  storm-steel-ink: "#2f445c"
  pool-cyan: "#43c1d8"
  pool-cyan-ink: "#2a7785"
  lagoon-teal: "#60c5bc"
  lagoon-teal-ink: "#346c67"
  orchid-pink: "#ed2c8f"
  orchid-pink-ink: "#861b51"
  grape-purple: "#aa519f"
  grape-purple-ink: "#66305f"
  aubergine-violet: "#8553a2"
  aubergine-violet-ink: "#5a3a6d"
  night-indigo: "#5e54a3"
  night-indigo-ink: "#3b3567"
  field-olive: "#bebf4f"
  field-olive-ink: "#6f6e2e"
  cast-bronze: "#be964e"
  cast-bronze-ink: "#574422"
  terracotta-clay: "#bf704e"
  terracotta-clay-ink: "#804a33"
  paper: "#ffffff"
  subdued-grey: "#f4f4f5"
  hairline: "#eaeaeb"
  palette-grey: "#a9abae"
  faint-text: "#717273"
  muted-text: "#5d5e5f"
  soft-text: "#383838"
  ink-raised: "#2c2c2c"
  module-ink: "#141414"
  studio-black: "#1f1f1f"
typography:
  display:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: '"cv11", "ss01"'
  body-small:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.5
  badge:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.5
  control:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  value:
    fontFamily: "'JetBrains Mono', ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "'JetBrains Mono', ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.65
  privilege:
    fontFamily: "'JetBrains Mono', ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  xs: "2px"
  sm: "6px"
  md: "10px"
  pill: "999px"
  round: "50%"
spacing:
  xs: "10px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.studio-orange}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.control}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.control}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.soft-text}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.control}"
  button-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.control}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.body-small}"
  search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.body}"
  badge:
    backgroundColor: "{colors.subdued-grey}"
    textColor: "{colors.soft-text}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "20px"
    typography: "{typography.badge}"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.soft-text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.body}"
  module-tile:
    backgroundColor: "{colors.module-ink}"
    textColor: "{colors.palette-grey}"
    rounded: "{rounded.sm}"
    size: "44px"
  statement:
    backgroundColor: "{colors.subdued-grey}"
    textColor: "{colors.ink-raised}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
    typography: "{typography.code}"
  privilege-mark:
    backgroundColor: "{colors.studio-orange}"
    rounded: "{rounded.round}"
    size: "14px"
---

# Design System: Platform Studio

## Overview

**Creative North Star: "The Granted Studio"**

The Platform is the whole project: PostgreSQL as the identity and authorization system, the
relay that carries bytes, the CLI that installs and hardens, and the studio — the interface a
reader works in. This file describes the studio. The database decides every right, and the
studio's work is to show that answer: which columns a reader may read, which rows a policy
lets them see, what a change will run, and what PostgreSQL said when it refused.

The studio is a working surface, not a canvas. It is light and dense on purpose: a near-black
module bar down the left edge, a navigation pane that names the workspace in view, a sticky
header carrying the page's actions, and the page itself. Tables are the floor of the product —
most of a reader's day is a grid of records, a form, a filter, a statement — so the grid is
given the space and everything else recedes.

The system's character comes from what it shows rather than how it decorates. Every right is
drawn in PostgreSQL's own privilege names with one full / half / empty mark; every change shows
its SQL statement before it runs; every withheld field or filtered row says why. Interface text
is Inter; anything the database owns — values, identifiers, SQL, privilege names, role names —
is JetBrains Mono, so the reader can always tell the studio's voice from the database's.

Depth is mostly flat. Hairline borders and three tonal greys separate regions; shadows are
reserved for things that float and for the orange primary action's glow.

**Key Characteristics:**

- Light frame: paper content, the palette's neutral greys, a near-black module bar.
- One orange primary, for action and selection, and nowhere else.
- Inter for the interface; JetBrains Mono for everything the database owns.
- Rights drawn as PostgreSQL privilege names with full / half / empty marks, and a legend beside.
- The statement is shown before the change runs.
- Unboxed sections; a card is the only box.
- A pinned palette of sixteen families, eleven of them reserved for an item's own colour.

**What this file is.** Colours and depth are the system's law: the pinned palette in
`packages/ui/src/bits/palette.ts` and the four shadows below are what the studio must look
like. Measurements are as built — the frame, the type scale, the control sizes and the radii are
what the interface does today. Where the build has not yet reached the law, the gap is named
under **Drift to Close**, at the end of this file, rather than smoothed over.

## Colors

Sixteen families, each with a bright step that fills and a dark step that carries text, held in
`packages/ui/src/bits/palette.ts`. Five of them are the studio's own; eleven are reserved for
categorical data — an item that carries its own colour.

### Primary

- **Studio Orange** — the fill of the primary action, the active module tile, the held
  privilege, the focus border on an input, the mark of a collection that has no colour of its
  own. Orange says "do this" or "this is chosen", and nothing else.
- **Orange Ink** — the dark step: orange text on an orange ground (the active nav item, a chip,
  a badge that says what applies to you), and the ink on a Studio Orange fill, because the
  palette's own white cannot sit on its bright step.
- **Orange Wash** and **Orange Wash Deep** — the grounds orange text sits on: the selected row,
  the active nav item, the empty half of a half privilege mark.

### Secondary

- **Signal Blue** — what the system is telling the reader rather than what the reader may do:
  the information notice, the row-security state, the policy statements that apply to you.
- **Blue Ink** — the dark step of the blue family, and the tone for a listed value that carries
  no judgement of its own.
- **Blue Wash** and **Blue Wash Deep** — the grounds blue text sits on.

### Tertiary

The status trio, and only ever as a status:

- **Success Green** / Green Ink — settled: published, active, paid, done. Its wash is the ground
  its ink sits on.
- **Warning Amber** / Amber Ink — in progress: review, negotiation, partner. Its wash likewise.
- **Danger Red** / Red Ink — refused: lost, rejected, closed, blocked. The destructive button
  is the only solid status fill; every other red is ink on its wash.

### Neutral

- **Paper** — the content ground, and the ground of a card, an input, a button.
- **Subdued Grey** — the navigation pane, the right sidebar, a statement figure, the header of a
  table.
- **Hairline** — region borders, row dividers, control strokes.
- **Palette Grey** — the inactive module icon, the empty privilege ring, the quiet marks.
- **Faint Text**, **Muted Text**, **Soft Text** — captions and placeholders, section notes and
  table headers, and the studio's own secondary words.
- **Ink Raised** and **Module Ink** — the module bar and its raised cells, the owner badge, and
  the SQL text in a statement.
- **Studio Black** — the theme's own black, the base of every near-black surface.

### Reserved Families

Eleven families are held for categorical data and never decorate. A workspace and a collection
are categorical data — each one is an item with its own name and its own mark — so the reserved
families have their job: the colour of the mark.

| Family | Fill | Ink | Family | Fill | Ink |
|---|---|---|---|---|---|
| Garden Mint | Mint | Deep Mint | Grape Purple | Purple | Deep Purple |
| Storm Steel | Steel | Deep Steel | Aubergine Violet | Violet | Deep Violet |
| Pool Cyan | Cyan | Deep Cyan | Night Indigo | Indigo | Deep Indigo |
| Lagoon Teal | Teal | Deep Teal | Field Olive | Olive | Deep Olive |
| Orchid Pink | Pink | Deep Pink | Cast Bronze | Bronze | Deep Bronze |
| | | | Terracotta Clay | Clay | Deep Clay |

The fill and the ink of each are in the frontmatter, as `family` and `family-ink`. A colour that
is not one of the sixteen is drawn as the family nearest to it, so the studio stays inside its
own palette whatever the owner asks for. The ink on a fill is the palette's black or its white,
whichever reads.

### Named Rules

**The One Orange Rule.** Orange means "do this" or "this is chosen". It never decorates a
heading, a border at rest, or an empty state; if an element is neither an action nor a
selection (nor a held privilege), it is grey or blue.

**The Bright Fill Rule.** A family's bright step fills; its dark step carries the text and the
small marks that sit on light grounds. Orange fills with the palette's black for its label.

**The Action-and-Information Rule.** Orange is what the reader can act on; blue is what the
system is telling them. A notice, a policy statement or a row-security state is blue, even
where an orange badge calls out what applies to you inside it.

**The Palette-Only Rule.** No colour enters the interface that the pinned palette does not
hold — in the chrome as well as in the data.

**The Word-Meaning Tone Rule.** A listed value's badge colour follows what the word means, not
its position in the list: settled words are green, ended or refused words are red, in-progress
words are amber, starting words are grey, and anything else is blue. The accent never takes a
value's tone.

**The Item Colour Rule.** A workspace or a collection may carry a colour of its own, stored with
its metadata. The colour fills that item's mark — the small tile that carries its icon — and
nowhere else: never a heading, never a border, never a ground, and never the accent, which
keeps meaning "do this" and "chosen".

## Typography

**Display Font:** Inter Variable (with Inter, ui-sans-serif, system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo, Consolas)

**Character:** A tight, slightly negative-tracked Inter for the studio's own words, with the
stylistic sets cv11 and ss01 on; a plain JetBrains Mono for everything that belongs to the
database. The pairing is not decorative — it is how the reader knows, at a glance, whether they
are reading the studio's sentence or PostgreSQL's.

### Hierarchy

- **Display** (650, 28px, -0.025em): the sign-in heading only.
- **Headline** (650, 22px, -0.02em): the page title in the header, clamped to one line.
- **Title** (650, 16px): section and card headings.
- **Body** (400, 14px): interface text, table cells, control labels.
- **Body Small** (400, 13px): subtitles, section notes (to a maximum of 72 characters a line),
  captions.
- **Label** (600, 12.5px): breadcrumbs, table headers, statement captions, group titles.
- **Control** (600, 13px): the label on a button and a control the reader presses.
- **Badge** (700, 11px): a listed value's pill, 600 where the studio sets it.
- **Value** (JetBrains Mono 400, 13px): identifiers, UUIDs, numbers, timestamps, role names.
- **Code** (JetBrains Mono 400, 12.5px, 1.65): SQL in statements and policy expressions.
- **Privilege** (JetBrains Mono 500, 12px): SELECT, INSERT, UPDATE, DELETE beside their marks.

### Named Rules

**The Database Speaks Mono Rule.** If PostgreSQL owns the text (a value, a name, a privilege, a
statement), it is set in JetBrains Mono; if the studio wrote it, it is Inter.

## Layout

A four-column frame: the module bar (64px), the navigation pane (264px), the main column, and
on collection pages a right sidebar (312px). The bar and the pane are one container of 328px;
the users-and-groups page has no workspace in view and drops the pane, leaving the bar alone.

The header is sticky at the top of the main column: at least 76px tall, padded 12px 32px, a 94%
white ground blurred by 6px with a hairline beneath, carrying the breadcrumbs, the title and the
page's actions in one band. The page body is padded 24px 32px 48px.

The sidebar carries what is known about the collection in view — its information, the reader's
rights on it, the policies that apply to it — padded 20px on the same Subdued Grey as the
navigation pane, with a hairline on its left. The body of the page and the sidebar sit side by
side as a `1fr / 312px` grid.

Spacing runs on the library's scale — 10, 12, 16, 20, 32 — with the studio's own 24, 28 and 48
for page gutters, section gaps and the sign-in.

**Responsive behaviour.** Under 1080px the sidebar drops below the content and becomes a
bordered block of its own. Under 860px the gutters shrink to 16px and the sign-in stacks its art
above the form. The navigation pane is off-canvas under 768px, opened by a burger in the header,
so the module bar stays and the pane is drawn over the page.

**The Unboxed Section Rule.** A page section is a heading, a short description and a hairline
above it; it is never a bordered box. A card (panel, tile, table wrapper) is the only box on the
page, so boxes never nest inside boxes.

**The Sticky First Column Rule.** In a record table the first field stays pinned while the rest
scrolls, once there are more than three columns. A value longer than its column ends in an
ellipsis at 320px, and the whole value is in its title.

## Elevation & Depth

Flat by default. Regions are separated by hairlines and three tonal greys; rows by soft
hairlines. Shadows appear only on things that float above the page and on the primary action.

### Shadow Vocabulary

- **Rest** (`0 1px 2px rgb(20 20 20 / 6%), 0 1px 1px rgb(20 20 20 / 4%)`): a primary button at
  rest, and a card that asks to be pressed.
- **Lift** (`0 4px 12px rgb(20 20 20 / 8%), 0 1px 3px rgb(20 20 20 / 6%)`): a tile on hover.
- **Float** (`0 16px 40px rgb(20 20 20 / 16%), 0 4px 12px rgb(20 20 20 / 8%)`): drawers, menus,
  the off-canvas pane.
- **Orange Glow** (`0 4px 12px rgb(241 90 43 / 32%)`): the primary action only.

### Named Rules

**The Float-Only Shadow Rule.** A surface that sits in the page has no shadow; a surface that
sits over the page has Float. A card, a panel and a sign-in step are in the page, and a shadow on
any of them is a mistake.

## Shapes

Gently rounded rectangles for controls, nav items and statements (6px); softer corners for
cards, tables, menus and the sign-in's steps (10px); full pills for search, chips, badges and
choice badges; full circles for the module bar's tiles, the account avatar and the privilege
marks. Borders are 1px hairlines everywhere; the only heavier strokes are the 1.5px empty
privilege ring.

A statement is a figure with 6px corners and a white caption band over a Subdued Grey ground.
An item's mark is a rounded tile of its own colour carrying its own icon, and the ink on that
tile is the palette's black or its white.

## Components

### Buttons

- **Shape:** gently rounded (6px), 36px tall, 12px of padding either side (18px before a
  leading icon), 13px text at 600 weight.
- **Primary:** Studio Orange; its label is white today, where the law is the palette's black —
  see Drift to Close. Hover deepens to the orange's darker step.
- **Secondary (default):** Paper with a hairline stroke; hover greys the ground.
- **Ghost (subtle):** no ground, soft text; hover takes the Subdued Grey.
- **Light:** a tint of the colour it carries, for a choice that is offered rather than taken.
- **Danger:** solid Danger Red, and it appears only where something is destroyed.

### Inputs / Fields

- **Style:** 36px, 12px of padding, 6px radius, Paper ground, a hairline stroke at 13px; values
  are set in JetBrains Mono at 13px when PostgreSQL owns them.
- **Focus:** the stroke takes the orange, with the focus ring in Orange Wash Deep.
- **Search:** a full pill, 36px tall and 320px wide, with a 16px search icon at the left and
  the placeholder "Search every readable column".
- **Disabled:** Subdued Grey ground, soft stroke.

### Chips and Pills

- **Filter chips:** a 28px pill in the neutral grey with a remove button, naming the field,
  the operator and the value it is set to.
- **Badges:** a light ground in the family's tint with the family's dark step as the text, a
  full pill 20px tall at 11px and padded 0 10px, never uppercase, 700 weight, or 600 where the
  studio sets it.
- **Choice badges:** a light pill, toned by the Word-Meaning Tone Rule.

### Cards / Containers

- **Corner Style:** 10px.
- **Background:** Paper, 1px hairline, no shadow at rest.
- **Internal Padding:** 12px for a card; a table inside one bleeds to its edges.

### Navigation

- **Module bar:** a near-black column of 44px icon tiles, 6px apart, each a 6px-cornered square
  with a 20px icon in the palette's grey. Hover takes the raised ink; the active module is an
  orange tile with the palette's black icon. The brand cell sits at the top in the raised ink
  with the database mark in orange, and the reader's initials sit at the foot.
- **Navigation pane:** Subdued Grey with a hairline on the right, padded 12px. The workspace
  switcher is at the top; the collections and the workspace's own links follow under 12px grey
  group titles. A link is padded 8px 12px and stands about 38px tall with no corner rounding;
  hover takes the greyer ground, and the active link takes the orange's light ground with the
  orange's darkest step as its text.
- **Tabs:** 13px labels in the studio's own text colour, 35px tall, padded 10px 16px; the active
  tab is underlined in orange.

### Data Table

A bordered table with 10px corners, rows about 41px tall and cells padded 7px 10px, rows
highlighted on hover, the first column pinned when there are more than three columns, numeric
columns right-aligned and set in mono, a null shown as a faint mono `null`. Columns sort from
their header. The table wrapper is a card: it is the only box on the page.

### Privilege Marks (signature)

A privilege is drawn the same way everywhere: a 14px disc that is solid orange (held on the
whole collection), half orange and half Orange Wash Deep (held on some fields), or an empty
grey ring (not held), beside its PostgreSQL name in mono. A legend of the three marks appears
wherever they do. A half mark carries its count beside it — the fields it covers of the fields
there are, eleven of twelve. Where the question is who holds a field, the answer is the roles
by name: small tags in mono, a role that holds the whole collection quieter than one granted
the field by name. A role is drawn the same wherever access is read: a person, a group or
everyone as its icon, and its name in mono.

The marks describe; they do not edit. A grant is changed in a drawer, where each privilege is
chosen as not held, the whole collection or chosen fields, and the mark beside the privilege
follows the choice, so the drawer reads like the table it came from.

**The One Rights Vocabulary Rule.** Rights are named only by PostgreSQL's privileges (SELECT,
INSERT, UPDATE, DELETE, TRUNCATE) and drawn only with the full / half / empty mark; never with
checkmarks, toggles or invented role words.

### Statement (signature)

A figure with a hairline, 6px corners and a Subdued Grey ground: a white caption band reading
"Runs as you, in one transaction" over the SQL in Code type. It appears in every drawer and
confirmation that changes something, live-updating as the form changes, and policy expressions
use the same mono-on-grey treatment.

**The Statement First Rule.** Nothing changes the database without its SQL on screen first, in
the same view as the button that runs it.

### Item Marks (signature)

A workspace or a collection may present itself: a display name, an icon and a colour, kept in
its own metadata and drawn by the interface wherever the item appears. The mark is a rounded
tile — 34px on a collection tile, 44px in a page header — filled with the item's colour and
carrying its icon in the ink that reads on it. Without a colour the mark keeps the ground its
place gives it: ink in the switcher, orange wash on a tile, Subdued Grey in a header. The icon
set is the studio's own, one stroke and one weight, named by the metadata (`newspaper`,
`file-text`, `building-2`); an icon the studio does not draw falls back to the generic mark. The
navigation pane keeps its list quiet: the item's icon there, in the neutral grey, and the colour
in the places where the item is presented.

### Field Names

A field may carry a display name: the word the interface shows for a column where people read
it — the header of a records table, the label of a record's own field. The name is the studio's
word for the column, so it is set in Inter; the column's own name stays in JetBrains Mono
beside it, in the address and in the SQL. The name reaches only the readers who may read the
column: PostgreSQL does not return the metadata of a field they may not reach, so a hidden
field keeps its raw name and nothing else.

### Where a Field Appears

A field is drawn in three places — the records table, the record form and the filter builder —
and the owner of a collection says which of them a field belongs to, in the field's own
metadata, so PostgreSQL keeps the rules: only the owner changes it, and it narrows the interface
without granting anything. Every field carries its own saying; the editor is a drawer section
of three choices — shown, hidden, and, in the record, shown and locked — with the statements
that will run below them, like every other change. A column PostgreSQL computes itself — a
generated column, an identity column — is shown and locked whatever the owner says, because the
database writes it.

### Drawers and Menus

Drawers slide in from the right at 560px on Paper, with a 19px title, a scrolling body and a
right-aligned footer of buttons. Menus are 10px-cornered, float-shadowed, and open from the
element that owns them.

### Sign-in

The sign-in is light like the rest: a Subdued Grey art panel with three steps — your sign-in,
PostgreSQL, your role and rows — each in a bordered card, the middle one outlined in orange
with "PostgreSQL" in the orange's dark step; and a white panel with the Display heading, a lead
paragraph and the people who may sign in.

## Do's and Don'ts

### Do:

- **Do** use Studio Orange only for actions, selection, focus and held privileges.
- **Do** use Signal Blue only for what the system is telling the reader.
- **Do** take every colour from the pinned palette, including the chrome.
- **Do** set every database-owned string in JetBrains Mono and every studio-written string in
  Inter.
- **Do** draw rights with PostgreSQL privilege names and the full / half / empty mark, with the
  legend nearby.
- **Do** show the statement in a "Runs as you" figure before the button that runs it.
- **Do** pin the first column of record tables, clip long values with an ellipsis, and keep the
  whole value in the title.
- **Do** separate page sections with a heading and a hairline; let the card be the only box.
- **Do** tone choice badges by what the word means.
- **Do** let an item carry its own name, icon and colour, and draw them as its mark alone.
- **Do** keep the frame light, sign-in included; the only dark surface is the module bar.

### Don't:

- **Don't** nest a bordered box inside a section box or a card inside a card.
- **Don't** introduce a second accent hue or use orange decoratively.
- **Don't** put a reserved family into the chrome while no categorical data asks for it.
- **Don't** let an item's colour spread past its mark, or take the accent's place.
- **Don't** describe rights with checkmarks, toggles or words other than PostgreSQL's
  privileges.
- **Don't** run a change whose statement the reader has not been shown.
- **Don't** colour choice badges by their position in the list.
- **Don't** give an in-page surface a shadow; shadows are for floating layers and the primary
  action.
- **Don't** return to a dark console frame.

## Drift to Close

Where the built interface has not yet reached the law above. Each item names what the build
does today, what the law says, and what closing it means.

1. **Status and information tones.** Refusals, notices, toasts, tags and the word-meaning
   badges run on the component library's named colours — red, blue, yellow, grey — rather than
   the pinned families, their dark steps and their washes, which are the law for status. The
   words still map to the right meaning; the hues are the library's. Closing it means mapping
   each status to its family: ink on wash, never a solid fill except the destructive button.
2. **Depth.** The interface has no bespoke shadows: drawers, menus and the sign-in's cards take
   the library's scale. The four shadows above are the law, and the sign-in cards in particular
   carry a shadow on a surface that sits in the page, which the Float-Only Shadow Rule forbids.
3. **The chrome's greys.** Input strokes, the hover ground of a navigation link and a few
   library surfaces take the library's grey scale rather than the palette's hairline and
   subdued grey. The Palette-Only Rule covers the chrome as well as the data.
4. **The primary button's label.** The orange button labels itself in white, which is 3.4:1
   against Studio Orange — under the 4.5:1 that body text needs, and against the system's own
   reason for the rule that the palette's white cannot sit on its bright step. The law is the
   palette's black on orange, 5.5:1. Closing it is one line in the theme: the label's colour.
5. **The active link's ink.** The active item in the navigation pane takes the orange's lightest
   step as its text, one step darker than the Orange Ink the palette holds.
