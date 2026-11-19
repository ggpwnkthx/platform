---
name: Platform
description: A light headless-CMS data studio for PostgreSQL, where every right, filter and refusal on screen is the database's own answer.
colors:
  primary: "#f15a2b"
  primary-hover: "#e05428"
  primary-press: "#dd5227"
  primary-ink: "#ad401e"
  primary-wash: "#f9e0d9"
  primary-wash-2: "#f7cabc"
  on-primary: "#141414"
  info: "#449fd8"
  info-ink: "#2b6081"
  info-wash: "#e0edf5"
  info-wash-2: "#c7e1f0"
  ink: "#141414"
  ink-2: "#2c2c2c"
  ink-3: "#383838"
  module-icon: "#a9abae"
  text: "#1f1f1f"
  text-soft: "#383838"
  text-muted: "#5d5e5f"
  text-faint: "#717273"
  line: "#eaeaeb"
  line-soft: "#f3f3f4"
  line-strong: "#8b8d8f"
  grey: "#a9abae"
  bg: "#ffffff"
  bg-subdued: "#f4f4f5"
  bg-sunk: "#e8e9e9"
  bg-hover: "#eff0f0"
  success: "#3e702d"
  success-wash: "#e6f2e5"
  warning: "#7f5c24"
  warning-wash: "#f9eed9"
  danger: "#ab1d2b"
  danger-hover: "#8a1b26"
  danger-wash: "#f8d5d8"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss01\""
  body-small:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.5
  value:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.65
  privilege:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  4xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-press}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "38px"
  action-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.round}"
    size: "44px"
  action-secondary:
    backgroundColor: "{colors.bg-subdued}"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.round}"
    size: "44px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  search:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "38px"
  module-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.module-icon}"
    width: "64px"
  module-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    size: "44px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-ink}"
  table-header:
    backgroundColor: "{colors.bg-subdued}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "42px"
  table-row:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    padding: "0 14px"
    height: "46px"
  table-row-selected:
    backgroundColor: "{colors.primary-wash}"
  card:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.lg}"
    padding: "22px 24px 24px"
  badge:
    backgroundColor: "{colors.bg-sunk}"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  chip:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.pill}"
    padding: "0 4px 0 12px"
    height: "32px"
  statement:
    backgroundColor: "{colors.bg-subdued}"
    textColor: "{colors.ink-2}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  owner-badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "20px"
---

# Design System: Platform

## Overview

**Creative North Star: "The Granted Studio"**

A headless-CMS data studio in the line of Directus and Keystone's admin: white working surfaces on the palette's grey neutrals, a near-black module bar down the left edge, and one orange that means "act" or "chosen". It is dense on purpose. Tables run at 46px rows, the navigation pane and the collapsible right sidebar stay in view, and the header carries breadcrumb, title and round action buttons in one 76px band. Nothing is airy, nothing is playful, and the whole frame is light; this is not a dark developer console.

The system's character comes from what it shows rather than how it decorates. Every right is drawn in PostgreSQL's own privilege names with one full / half / empty mark; every change shows its SQL statement before it runs; every withheld field or filtered row says why. Interface text is Inter; anything the database owns (values, identifiers, SQL, privilege names, role names) is JetBrains Mono, so the reader can always tell the studio's voice from the database's.

Depth is mostly flat. Hairline borders and three tonal greys separate regions; shadows are reserved for things that float (menus, drawers, the off-canvas nav) and for the orange primary action's soft glow.

**Key Characteristics:**
- Light frame: white content, the palette's neutral greys, a near-black module bar.
- One orange primary for action and selection, nowhere else.
- Every hue on screen comes from the pinned palette in `packages/ui/color_palette.png`.
- Inter for interface, JetBrains Mono for every value the database owns.
- Dense sortable tables with a sticky first column and ellipsis clipping.
- PostgreSQL privilege names with full / half / empty marks as the only rights vocabulary.
- The statement is shown before it runs.
- Unboxed sections; a card is the only box.

## Colors

Every hue in the interface comes from one pinned palette, held in `packages/ui/color_palette.png`.
The palette's own greys carry the frame; its split-complementary trio — orange, green and blue —
carries meaning; and three muted status hues carry consequence only.

### The Palette

The palette holds sixteen chromatic families and five neutrals. The interface uses five of the
chromatic families — the orange, the blue, the green, the amber and the red — and keeps the rest
in the token layer as reserved families.

| Family | Base | Light step | Dark step | Role in the interface |
|---|---|---|---|---|
| Orange | `#f15a2b` | `#ee8a6a` | `#ad401e` | action, selection, focus |
| Blue | `#449fd8` | `#7eb5d7` | `#3379a5` | information |
| Green | `#6cbe4f` | `#8af464` | `#3e702d` | success |
| Amber | `#f1ad29` | `#f0d22b` | `#7f5c24` | warning |
| Red | `#ee2a3d` | `#ed6875` | `#ab1d2b` | danger |
| Mint | `#65c081` | `#bcdeb1` | `#366745` | reserved |
| Steel | `#5379a3` | `#7ab2f1` | `#2f445c` | reserved |
| Cyan | `#43c1d8` | `#7ac8d7` | `#2a7785` | reserved |
| Teal | `#60c5bc` | `#a8deeb` | `#346c67` | reserved |
| Pink | `#ed2c8f` | `#e86ca9` | `#861b51` | reserved |
| Purple | `#aa519f` | `#d17fb5` | `#66305f` | reserved |
| Violet | `#8553a2` | `#ae85bc` | `#5a3a6d` | reserved |
| Indigo | `#5e54a3` | `#968edb` | `#3b3567` | reserved |
| Olive | `#bebf4f` | `#f6f868` | `#6f6f2e` | reserved |
| Bronze | `#be964e` | `#fcc967` | `#574422` | reserved |
| Clay | `#bf704e` | `#f59266` | `#804a33` | reserved |

The neutrals are `#fafafa`, `#a9abae`, `#383838`, `#2c2c2c` and `#141414`.

**The Reserved Palette Rule.** A reserved family enters the chrome only when the product has
categorical data that deserves a colour of its own. It never decorates: not a heading, not a
border at rest, not an empty state. A workspace and a collection are categorical data — each
one is an item with its own name and its own mark — so the reserved families have their job
now: an item's colour.

### Primary
- **Studio Orange** (primary): the round create button, primary buttons, the active module tile, the focus border on inputs, the active tab underline, the brand mark's tile, and the filled privilege mark. Hover deepens to **Orange Deep** (primary-hover) and active to **Orange Press** (primary-press).
- **Orange Ink** (primary-ink): orange text on orange washes: the active nav item, active tab label, chips, "applies to you" badges.
- **Orange Wash** (primary-wash): selected rows, the active nav item's ground, chips, tile icons. **Orange Wash Deep** (primary-wash-2) is the focus ring (3px) and the empty half of the half privilege mark.
- **Palette Black** (on-primary): the label on a bright fill. Orange is too light to carry white text, so a filled orange takes the palette's own black.

### Information
- **Signal Blue** (info): the palette's blue, the split-complementary partner of the accent, for what the system says rather than what you do: the information notice, the row-security state, the policy statements that apply to you, and the "Updated" revision.
- **Blue Ink** (info-ink): blue text and icons on the blue washes, and the tone for a listed value that carries no judgement of its own. **Blue Wash** (info-wash) and **Blue Wash Deep** (info-wash-2) are its grounds.

### Neutral
- **Module Ink** (ink): the module bar, the owner badge, the toast. **Module Ink Raised** (ink-2) is the brand cell at the top of the bar, module hover, and the colour of SQL text in statements. ink-3 is the deepest neutral step below it.
- **Palette Grey** (grey): the palette's own mid grey — the module's inactive icons, the empty privilege ring, the revision dot, the toggle track, the scrollbar and the quiet outline badge.
- **Text** (text), **Soft Text** (text-soft), **Muted Text** (text-muted), **Faint Text** (text-faint): body, secondary labels and nav items, captions and table headers, placeholders and the "not held" privilege name.
- **Hairline** (line), **Soft Hairline** (line-soft), **Strong Hairline** (line-strong): region borders, row dividers, control strokes. The strong hairline clears 3:1 on paper so a control's boundary is visible without one.
- **Paper** (bg), **Subdued Grey** (bg-subdued), **Sunk Grey** (bg-sunk), **Hover Grey** (bg-hover): content ground; navigation pane, sidebar, table header and sign-in art panel; neutral badges and pressed ghost states; row hover.

### Status
- **Success Green** / wash, **Warning Amber** / wash, **Danger Red** / wash (with danger-hover): toasts, notices, destructive buttons, and the word-meaning tones of choice badges. Always text-on-wash, never a solid status fill except the danger button. Each is the palette's darkest step of its family, so the tone stays legible at text size.

### Named Rules
**The One Orange Rule.** Orange means "do this" or "this is chosen". It never decorates a heading, a border at rest, or an empty state; if an element is neither an action nor a selection (nor a held privilege), it is grey or blue.

**The Bright Fill Rule.** A family's bright step fills; its dark step carries the text and the small marks that sit on light grounds. Orange fills with the palette's black for its label, because the palette's own white cannot sit on its bright steps: white on orange is 3.4:1, black on orange is 5.5:1.

**The Action-and-Information Rule.** Orange is what the reader can act on; blue is what the system is telling them. A notice, a policy statement or a row-security state is blue, even where an orange badge calls out what applies to you inside it.

**The Palette-Only Rule.** No colour enters the interface that the pinned palette does not hold. A step the palette does not name is mixed from one it does, and says so in the token layer.

**The Word-Meaning Tone Rule.** A listed value's badge colour follows what the word means, not its position in the list: settled words (published, active, paid, done) are green, ended or refused words (lost, rejected, closed, blocked) are red, in-progress words (review, negotiate, partner) are amber, starting words (draft, new, pending) are grey, and anything else is blue. The accent never takes a value's tone: the palette's orange and red are near neighbours, so a value that means nothing in particular takes blue and stays clear of the red that means refusal.

**The Item Colour Rule.** A workspace or a collection may carry a colour of its own, chosen by
its owner and stored with its metadata. The colour fills that item's mark — the small tile
that carries its icon — and nowhere else: never a heading, never a border, never a ground, and
never the accent, which keeps meaning "do this" and "chosen". The colour comes from the pinned
palette, the reserved families first, since they carry no meaning of their own; the studio's
own five are offered too, but last, because they already mean action, information and status.
A colour the palette does not hold is drawn as the family nearest to it, so the interface stays
inside its own palette whatever the owner asks for. The ink on the fill is the palette's black
or its white, whichever reads.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui)
**Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo)

**Character:** A tight, slightly negative-tracked Inter for the studio's own words, with stylistic sets cv11 and ss01 on; a plain JetBrains Mono for everything that belongs to the database.

### Hierarchy
- **Display** (700, 28px, -0.025em): the sign-in heading only.
- **Headline** (650, 22px, -0.02em): the page title in the header; drops to 18px under 520px. The drawer title sits between at 19px.
- **Title** (650, 16px, -0.01em): section, card and tile headings.
- **Body** (400, 14px, 1.5): interface text and table cells (cells at 13.5px).
- **Body Small** (400, 13px, 1.55): subtitles, section descriptions (max 72ch), notes.
- **Label** (600, 12.5px): table headers, breadcrumbs, statement captions; the nav group title is 12px.
- **Value** (JetBrains Mono 400, 13px): identifiers, UUIDs, numbers, timestamps, role names.
- **Code** (JetBrains Mono 400, 12.5px, 1.65): SQL in statements and policy expressions.
- **Privilege** (JetBrains Mono 500, 12px): SELECT, INSERT, UPDATE, DELETE beside their marks.

### Named Rules
**The Database Speaks Mono Rule.** If PostgreSQL owns the text (a value, a name, a privilege, a statement), it is set in JetBrains Mono; if the studio wrote it, it is Inter.

## Layout

A four-column frame: the module bar (64px, 52px under 520px), the navigation pane (264px, 240px under 1280px), the main column, and on collection pages a right sidebar (312px, 280px under 1280px). The module bar, nav and sidebar are each full-height and sticky; the header is sticky at the top of the main column with a 94% white, blurred ground.

Spacing runs on a 4px base: 8 and 12 inside controls, 16 and 20 between blocks, 24 and 32 for page gutters (body padding 24px 32px 48px; header and toolbar 12px 32px). Tiles fill an auto grid of minimum 280px with 16px gaps.

Responsive behaviour: under 1080px the sidebar drops below the content; under 860px the nav becomes an off-canvas panel over a dark scrim with a toggle in the header, gutters shrink to 16px, two-column forms and splits stack, and sign-in stacks its art above the form.

**The Unboxed Section Rule.** A page section is a heading, a short description and a hairline above it; it is never a bordered box. A card (panel, tile, table wrapper) is the only box on the page, so boxes never nest inside boxes.

**The Sticky First Column Rule.** In a record table the checkbox and the first field stay pinned while the rest scrolls, with a fading edge shadow showing there is more to the right. A value longer than its column ends in an ellipsis, and the whole value is in its tooltip.

## Elevation & Depth

Flat by default. Regions are separated by hairlines and the three grey grounds; rows by soft hairlines. Shadows appear only on things that float above the page or ask to be pressed.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgb(20 20 20 / 6%), 0 1px 1px rgb(20 20 20 / 4%)`): primary buttons and the sign-in diagram cards.
- **Lift** (`0 4px 12px rgb(20 20 20 / 8%), 0 1px 3px rgb(20 20 20 / 6%)`): a tile on hover.
- **Float** (`0 16px 40px rgb(20 20 20 / 16%), 0 4px 12px rgb(20 20 20 / 8%)`): menus, drawers, the off-canvas nav.
- **Orange Glow** (`0 4px 12px rgb(241 90 43 / 32%)`): the round primary action only.

**The Float-Only Shadow Rule.** A surface that sits in the page has no shadow; a surface that sits over the page has Float.

## Shapes

Gently rounded rectangles (6px) for controls, nav items and statements; softer corners (10px) for cards, tables, menus and person rows; full pills for search, chips, badges and choice badges; full circles for the header's action buttons, initials and privilege marks. Borders are 1px hairlines everywhere; the only heavier strokes are the 2px active-tab underline and the 1.5px empty privilege ring.

## Components

### Buttons
- **Shape:** gently rounded (6px), 38px tall (32px small, 46px on sign-in), 600 weight.
- **Primary:** Studio Orange with the palette's black for its label and the Rest shadow; hover and press deepen the orange.
- **Secondary:** Paper with a strong hairline; hover darkens the stroke and greys the ground.
- **Ghost:** no ground, soft text; hover takes Sunk Grey. **Danger:** solid red.
- **Round actions:** the header's actions are 44px circles (38px under 520px). The primary one (create, save) is orange with the Orange Glow and lifts 1px on hover; secondary ones are Subdued Grey; destructive ones are red-on-wash and fill red on hover.

### Inputs / Fields
- **Style:** 40px, strong hairline, 6px radius, Paper ground; mono inputs at 13px.
- **Focus:** orange border plus a 3px Orange Wash Deep ring. **Search** is a 38px pill with the same focus and a `/` key hint.
- **Disabled:** Subdued Grey ground, soft hairline.

### Chips and Badges
- **Filter chips:** 32px orange-wash pills with a round remove button.
- **Badges:** 22px pills, 12px semibold, text-on-wash in neutral, orange, blue, green, amber or red; an outline variant for quiet tags.
- **Choice badges:** 22px pills with a 7px dot in the text colour, toned by The Word-Meaning Tone Rule.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Paper, 1px hairline, no shadow at rest (tiles take Lift on hover).
- **Internal Padding:** 22px 24px 24px for panels; 18px for tiles. A plain table inside a panel bleeds to its edges.

### Navigation
- **Module bar:** near-black column of 44px icon tiles; hover takes ink-2, the active module is an orange tile with a black icon; the user's initials sit at the foot.
- **Navigation pane:** Subdued Grey with a workspace switcher at the top and 36px items; the active item is Orange Wash with Orange Ink text and an orange icon.
- **Tabs:** 48px, semibold muted labels; active is Orange Ink with a 2px orange underline.

### Item Marks (signature)
A workspace or a collection may present itself: a display name, an icon and a colour, kept in
its own metadata and drawn by the interface wherever the item appears. The mark is a small
rounded tile — 36px in the workspace switcher, 34px on a collection tile, 44px in a page
header — filled with the item's colour and carrying its icon in the ink that reads on it.
Without a colour the mark keeps the ground its place gives it: ink in the switcher, Orange Wash
on a tile, Subdued Grey in a header. The icon set is the platform's own, one stroke and one
weight, named by the metadata (`newspaper`, `file-text`, `building-2`); an icon the platform
does not draw falls back to the generic mark. The navigation pane keeps its list quiet: the
item's icon there, in the neutral grey, and the colour in the places where the item is
presented.

### Field Names
A field may carry a display name: the word the interface shows for a column where people read
it — the header of a records table, the label of a record's own field. The name is the studio's
word for the column, so it is set in Inter; the column's own name stays in JetBrains Mono
beside it, in the address and in the SQL. The name reaches only the readers who may read the
column: PostgreSQL does not return the metadata of a field they may not reach, so a hidden
field keeps its raw name and nothing else.

### Where a Field Appears
A field is drawn in three places: the records table, the record form and the filter builder.
The owner of a collection says which of them a field belongs to, in the field's own metadata,
so PostgreSQL keeps the rules: only the owner changes it, and it narrows the interface
without granting anything. Every field carries its own saying; the editor is a drawer
section of three choices — shown, hidden, and, in the record, shown and locked — with the
statements that will run below them, like every other change. The owner may name views of
their own beside the three, an export or a print sheet, and say whether the field appears in
them; they are listed under the three, each with its own choice, and the model's field table
says the same thing at a glance: three small words, struck through where the field is kept
out, and any view of the owner's own beside them. A column PostgreSQL computes itself — a
generated column, an identity column — is shown and locked whatever the owner says, because
the database writes it.

### Presentation Panel
The panel where an item's presentation is set: a preview of the mark as it will read, the
display name in a field, the icon as a grid of choices, and the colour as the palette's
families — the reserved ones first, the studio's own five after a hairline. The panel shows
the statements that will run before the button that runs them, like every other change.

### Data Table
Header row on Subdued Grey (42px, label type), body rows 46px with soft hairline dividers, row hover in Hover Grey, selected rows in Orange Wash, numbers right-aligned in mono, null as faint mono "null". Columns sort from the header. Follows The Sticky First Column Rule.

### Privilege Marks (signature)
A privilege is drawn the same way everywhere: a 16px circle that is solid orange (held on the whole collection), half orange / half Orange Wash Deep (held on some fields), or an empty Palette Grey ring (not held), beside its PostgreSQL name in mono. A legend of the three marks appears wherever they do. Compact rows shrink the mark to 11px; the matrix uses one mark per privilege per collection. Owning a collection is a separate dark ink "owner" pill.

**The One Rights Vocabulary Rule.** Rights are named only by PostgreSQL's privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE) and drawn only with the full / half / empty mark; never with checkmarks, toggles or invented role words.

### Statement (signature)
A figure with a hairline, 6px corners and Subdued Grey ground: a white caption band ("Runs as you") over the SQL in Code type. It appears in every drawer and confirmation that changes something, live-updating as the form changes, and policy expressions use the same mono-on-grey treatment.

**The Statement First Rule.** Nothing changes the database without its SQL on screen first, in the same view as the button that runs it.

### Drawers and Menus
Drawers slide in from the right (560px, 760px wide) on Paper with Float, a header band, scrolling body and a right-aligned footer. Menus are 10px-cornered, 6px padded, Float-shadowed and drop 4px into place.

### Sign-in
The sign-in is light like the rest: a Subdued Grey art panel on the left with a three-step diagram (your sign-in, PostgreSQL in orange, your role and rows) joined by hairlines, and a white panel on the right with the Display heading, a lead paragraph and full-width person rows (10px corners, mono address, orange border and wash ring on hover).

## Do's and Don'ts

### Do:
- **Do** use Studio Orange only for actions, selection, focus and held privileges.
- **Do** use Signal Blue only for what the system is telling the reader.
- **Do** keep a value's tone clear of the accent, so an orange wash and a red wash are never side by side.
- **Do** take every colour from the pinned palette, and mix a step from a palette colour when the palette does not name one.
- **Do** set every database-owned string in JetBrains Mono and every studio-written string in Inter.
- **Do** draw rights with PostgreSQL privilege names and the full / half / empty mark, with the legend nearby.
- **Do** show the statement in a "Runs as you" figure before the button that runs it.
- **Do** pin the first column of record tables, clip long values with an ellipsis, and put the full value in the tooltip.
- **Do** separate page sections with a heading and a hairline; let the card be the only box.
- **Do** tone choice badges by what the word means.
- **Do** let an item carry its own name, icon and colour, and draw them as its mark alone.
- **Do** keep the frame light, sign-in included; the only dark surface is the module bar.

### Don't:
- **Don't** nest a bordered box inside a section box or a card inside a card.
- **Don't** introduce a second accent hue or use orange decoratively.
- **Don't** put a reserved palette family into the chrome while no categorical data asks for it.
- **Don't** let an item's colour spread past its mark, or take the accent's place.
- **Don't** describe rights with checkmarks, toggles or words other than PostgreSQL's privileges.
- **Don't** run a change whose statement the reader has not been shown.
- **Don't** colour choice badges by their position in the list.
- **Don't** give in-page surfaces a shadow; shadows are for floating layers and the primary action.
- **Don't** return to a dark console frame.
