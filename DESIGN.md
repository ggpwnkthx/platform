---
name: Platform
description: A light headless-CMS data studio for PostgreSQL, where every right, filter and refusal on screen is the database's own answer.
colors:
  primary: "#5b3ee6"
  primary-hover: "#4b2fd3"
  primary-press: "#4027b8"
  primary-ink: "#3b23a8"
  primary-wash: "#f0edfe"
  primary-wash-2: "#e3ddfd"
  ink: "#141c27"
  ink-2: "#263243"
  ink-3: "#3a475a"
  module-icon: "#9fabbc"
  text: "#17202c"
  text-soft: "#354153"
  text-muted: "#5a6779"
  text-faint: "#6b788b"
  line: "#dfe4eb"
  line-soft: "#ebeef3"
  line-strong: "#c6cfdb"
  bg: "#ffffff"
  bg-subdued: "#f4f6f9"
  bg-sunk: "#eaeef3"
  bg-hover: "#eef1f6"
  success: "#16794c"
  success-wash: "#e6f5ed"
  warning: "#965a00"
  warning-wash: "#fff3dc"
  danger: "#c52f2b"
  danger-hover: "#ab2522"
  danger-wash: "#fdeceb"
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
    textColor: "{colors.bg}"
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
    textColor: "{colors.bg}"
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

A headless-CMS data studio in the line of Directus and Keystone's admin: white working surfaces on cool slate neutrals, a dark slate module bar down the left edge, and one violet that means "act" or "chosen". It is dense on purpose. Tables run at 46px rows, the navigation pane and the collapsible right sidebar stay in view, and the header carries breadcrumb, title and round action buttons in one 76px band. Nothing is airy, nothing is playful, and the whole frame is light; this is not a dark developer console.

The system's character comes from what it shows rather than how it decorates. Every right is drawn in PostgreSQL's own privilege names with one full / half / empty mark; every change shows its SQL statement before it runs; every withheld field or filtered row says why. Interface text is Inter; anything the database owns (values, identifiers, SQL, privilege names, role names) is JetBrains Mono, so the reader can always tell the studio's voice from the database's.

Depth is mostly flat. Hairline borders and three tonal greys separate regions; shadows are reserved for things that float (menus, drawers, the off-canvas nav) and for the violet primary action's soft glow.

**Key Characteristics:**
- Light frame: white content, cool slate neutrals, dark slate module bar.
- One violet primary for action and selection, nowhere else.
- Inter for interface, JetBrains Mono for every value the database owns.
- Dense sortable tables with a sticky first column and ellipsis clipping.
- PostgreSQL privilege names with full / half / empty marks as the only rights vocabulary.
- The statement is shown before it runs.
- Unboxed sections; a card is the only box.

## Colors

Cool slate neutrals carry the frame; a single saturated violet carries intent; three muted status hues carry meaning only.

### Primary
- **Studio Violet** (primary): the round create button, primary buttons, the active module tile, the focus border on inputs, active tab underline, the brand mark's tile, and the filled privilege mark. Hover deepens to **Pressed Violet** (primary-hover) and active to primary-press.
- **Violet Ink** (primary-ink): violet text on violet washes: the active nav item, active tab label, chips, link buttons, "applies to you" badges.
- **Violet Wash** (primary-wash): selected rows, the active nav item's ground, chips, tile icons, info notices. **Violet Wash Deep** (primary-wash-2) is the focus ring (3px) and the empty half of the half privilege mark.

### Neutral
- **Module Ink** (ink): the module bar, the owner badge. **Module Ink Raised** (ink-2) is the brand cell at the top of the bar, module hover, and the colour of SQL text in statements. ink-3 is the deepest neutral step below it.
- **Module Icon Grey** (module-icon): inactive module icons on the dark bar.
- **Text** (text), **Soft Text** (text-soft), **Muted Text** (text-muted), **Faint Text** (text-faint): body, secondary labels and nav items, captions and table headers, placeholders and the "not held" privilege name.
- **Hairline** (line), **Soft Hairline** (line-soft), **Strong Hairline** (line-strong): region borders, row dividers, control strokes and the empty privilege ring.
- **Paper** (bg), **Subdued Slate** (bg-subdued), **Sunk Slate** (bg-sunk), **Hover Slate** (bg-hover): content ground; navigation pane, sidebar, table header and sign-in art panel; neutral badges and pressed ghost states; row hover.

### Status
- **Success Green** / wash, **Warning Amber** / wash, **Danger Red** / wash (with danger-hover): toasts, notices, destructive buttons, and the word-meaning tones of choice badges. Always text-on-wash, never a solid status fill except the danger button.

### Named Rules
**The One Violet Rule.** Violet means "do this" or "this is chosen". It never decorates a heading, a border at rest, or an empty state; if an element is neither an action nor a selection (nor a held privilege), it is slate.

**The Word-Meaning Tone Rule.** A listed value's badge colour follows what the word means, not its position in the list: settled words (published, active, paid, done) are green, ended or refused words (lost, rejected, closed, blocked) are red, in-progress words (review, negotiate, partner) are amber, starting words (draft, new, pending) are grey, and anything else is violet.

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

Responsive behaviour: under 1080px the sidebar drops below the content; under 860px the nav becomes an off-canvas panel over a slate scrim with a toggle in the header, gutters shrink to 16px, two-column forms and splits stack, and sign-in stacks its art above the form.

**The Unboxed Section Rule.** A page section is a heading, a short description and a hairline above it; it is never a bordered box. A card (panel, tile, table wrapper) is the only box on the page, so boxes never nest inside boxes.

**The Sticky First Column Rule.** In a record table the checkbox and the first field stay pinned while the rest scrolls, with a fading edge shadow showing there is more to the right. A value longer than its column ends in an ellipsis, and the whole value is in its tooltip.

## Elevation & Depth

Flat by default. Regions are separated by hairlines and the three slate grounds; rows by soft hairlines. Shadows appear only on things that float above the page or ask to be pressed.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgb(20 28 39 / 6%), 0 1px 1px rgb(20 28 39 / 4%)`): primary buttons and the sign-in diagram cards.
- **Lift** (`0 4px 12px rgb(20 28 39 / 8%), 0 1px 3px rgb(20 28 39 / 6%)`): a tile on hover.
- **Float** (`0 16px 40px rgb(20 28 39 / 16%), 0 4px 12px rgb(20 28 39 / 8%)`): menus, drawers, the off-canvas nav.
- **Violet Glow** (`0 4px 12px rgb(91 62 230 / 30%)`): the round primary action only.

**The Float-Only Shadow Rule.** A surface that sits in the page has no shadow; a surface that sits over the page has Float.

## Shapes

Gently rounded rectangles (6px) for controls, nav items and statements; softer corners (10px) for cards, tables, menus and person rows; full pills for search, chips, badges and choice badges; full circles for the header's action buttons, initials and privilege marks. Borders are 1px hairlines everywhere; the only heavier strokes are the 2px active-tab underline and the 1.5px empty privilege ring.

## Components

### Buttons
- **Shape:** gently rounded (6px), 38px tall (32px small, 46px on sign-in), 600 weight.
- **Primary:** Studio Violet with white text and the Rest shadow; hover and press deepen the violet.
- **Secondary:** Paper with a strong hairline; hover darkens the stroke and greys the ground.
- **Ghost:** no ground, soft text; hover takes Sunk Slate. **Danger:** solid red.
- **Round actions:** the header's actions are 44px circles (38px under 520px). The primary one (create, save) is violet with the Violet Glow and lifts 1px on hover; secondary ones are Subdued Slate; destructive ones are red-on-wash and fill red on hover.

### Inputs / Fields
- **Style:** 40px, strong hairline, 6px radius, Paper ground; mono inputs at 13px.
- **Focus:** violet border plus a 3px Violet Wash Deep ring. **Search** is a 38px pill with the same focus and a `/` key hint.
- **Disabled:** Subdued Slate ground, soft hairline.

### Chips and Badges
- **Filter chips:** 32px violet-wash pills with a round remove button.
- **Badges:** 22px pills, 12px semibold, text-on-wash in neutral, violet, green, amber or red; an outline variant for quiet tags.
- **Choice badges:** 22px pills with a 7px dot in the text colour, toned by The Word-Meaning Tone Rule.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Paper, 1px hairline, no shadow at rest (tiles take Lift on hover).
- **Internal Padding:** 22px 24px 24px for panels; 18px for tiles. A plain table inside a panel bleeds to its edges.

### Navigation
- **Module bar:** dark slate column of 44px icon tiles; hover takes ink-2, the active module is a violet tile with a white icon; the user's initials sit at the foot.
- **Navigation pane:** Subdued Slate with a workspace switcher at the top and 36px items; the active item is Violet Wash with Violet Ink text and a violet icon.
- **Tabs:** 48px, semibold muted labels; active is Violet Ink with a 2px violet underline.

### Data Table
Header row on Subdued Slate (42px, label type), body rows 46px with soft hairline dividers, row hover in Hover Slate, selected rows in Violet Wash, numbers right-aligned in mono, null as faint mono "null". Columns sort from the header. Follows The Sticky First Column Rule.

### Privilege Marks (signature)
A privilege is drawn the same way everywhere: a 16px circle that is solid violet (held on the whole collection), half violet / half Violet Wash Deep (held on some fields), or an empty strong-hairline ring (not held), beside its PostgreSQL name in mono. A legend of the three marks appears wherever they do. Compact rows shrink the mark to 11px; the matrix uses one mark per privilege per collection. Owning a collection is a separate dark ink "owner" pill.

**The One Rights Vocabulary Rule.** Rights are named only by PostgreSQL's privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE) and drawn only with the full / half / empty mark; never with checkmarks, toggles or invented role words.

### Statement (signature)
A figure with a hairline, 6px corners and Subdued Slate ground: a white caption band ("Runs as you") over the SQL in Code type. It appears in every drawer and confirmation that changes something, live-updating as the form changes, and policy expressions use the same mono-on-slate treatment.

**The Statement First Rule.** Nothing changes the database without its SQL on screen first, in the same view as the button that runs it.

### Drawers and Menus
Drawers slide in from the right (560px, 760px wide) on Paper with Float, a header band, scrolling body and a right-aligned footer. Menus are 10px-cornered, 6px padded, Float-shadowed and drop 4px into place.

### Sign-in
The sign-in is light like the rest: a Subdued Slate art panel on the left with a three-step diagram (your sign-in, PostgreSQL in violet, your role and rows) joined by hairlines, and a white panel on the right with the Display heading, a lead paragraph and full-width person rows (10px corners, mono address, violet border and wash ring on hover).

## Do's and Don'ts

### Do:
- **Do** use Studio Violet only for actions, selection, focus and held privileges.
- **Do** set every database-owned string in JetBrains Mono and every studio-written string in Inter.
- **Do** draw rights with PostgreSQL privilege names and the full / half / empty mark, with the legend nearby.
- **Do** show the statement in a "Runs as you" figure before the button that runs it.
- **Do** pin the first column of record tables, clip long values with an ellipsis, and put the full value in the tooltip.
- **Do** separate page sections with a heading and a hairline; let the card be the only box.
- **Do** tone choice badges by what the word means.
- **Do** keep the frame light, sign-in included; the only dark surface is the module bar.

### Don't:
- **Don't** nest a bordered box inside a section box or a card inside a card.
- **Don't** introduce a second accent hue or use violet decoratively.
- **Don't** describe rights with checkmarks, toggles or words other than PostgreSQL's privileges.
- **Don't** run a change whose statement the reader has not been shown.
- **Don't** colour choice badges by their position in the list.
- **Don't** give in-page surfaces a shadow; shadows are for floating layers and the primary action.
- **Don't** return to a dark console frame.
