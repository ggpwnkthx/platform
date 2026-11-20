/**
 * The installation's own field types and renderers.
 *
 * The interface is one bundle of static files, so what an installation adds to it is added
 * when it is built: this module is imported before any page draws a field, and whatever it
 * registers is held beside the platform's own. The platform itself adds nothing here.
 *
 * This module is a seam. A site that has a `platform.json` names a module of its own there —
 * `"extensions": "extensions.tsx"` — and the build puts that module in this one's place, in
 * the prerendered pages and in the bundle alike. A site's module is written against what
 * the interface publishes:
 *
 *   import { fieldTypeNamed, registerFieldType } from '@platform/ui/fields/registry.ts'
 *   import { registerRenderer } from '@platform/ui/fields/renderers.tsx'
 *
 *   // A way of drawing a value, which a field may name in any situation.
 *   registerRenderer({ name: 'initials', label: 'As initials', kinds: ['text'], situations: [], render })
 *
 *   // A type of field: its cell, its value, its input and its filter. It claims the columns
 *   // the database says are its own — here, every column of the domain `public.email`.
 *   registerFieldType({ ...fieldTypeNamed('text')!, name: 'email', claims, Input })
 *
 * See docs/fields.md and docs/renderers.md.
 */
export {}
