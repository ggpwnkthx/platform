import { presentationKeys, renderersKey, viewsKey } from '@platform/vocabulary'
import type { MetadataKeyEditor } from '../registry.ts'
import { PresentationEditor } from './presentation.tsx'
import { RenderersEditor } from './renderers.tsx'
import { ViewsEditor } from './views.tsx'

/**
 * The key editors the platform holds: one for each of the keys it reads for itself. A key
 * that has an editor is changed in a form made for it; every other key is a row of the
 * metadata collection, changed in the record form like any other row.
 */

/** How an item presents itself: its name, its icon and its colour, three keys edited as one. */
const presentation: MetadataKeyEditor = {
  name: 'presentation',
  title: 'Presentation',
  note: (target) =>
    `How this ${target.scope} is named and marked. It is kept in its own metadata, so PostgreSQL keeps its rules: only its owner may change it.`,
  keys: presentationKeys,
  scopes: ['workspace', 'collection', 'field'],
  Editor: ({ target, owner }) => <PresentationEditor target={target} owner={owner} />,
}

/** Where a field appears: the list, the record and the filters. */
const views: MetadataKeyEditor = {
  name: 'views',
  title: 'Where it appears',
  note: () =>
    'The list, the record and the filters. A field may be shown in one and hidden in another; PostgreSQL still decides who may read it and who may write it.',
  keys: [viewsKey],
  scopes: ['field'],
  Editor: ViewsEditor,
}

/** How a field's values are drawn, in each place they appear. */
const renderers: MetadataKeyEditor = {
  name: 'renderers',
  title: 'How it is drawn',
  note: () =>
    'A value may be drawn differently in each place it appears: a uuid is eight characters in the grid and thirty-six in the record. The saying is the field’s own metadata, so PostgreSQL keeps its rules.',
  keys: [renderersKey],
  scopes: ['field'],
  Editor: RenderersEditor,
}

/** The key editors the platform holds, in the order they are shown. */
export const platformKeyEditors: MetadataKeyEditor[] = [presentation, views, renderers]
