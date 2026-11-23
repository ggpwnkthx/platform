import { newsroomAccess } from './newsroom-access.ts'
import { newsroomTags } from './newsroom-tags.ts'

/**
 * The newsroom's own schema: its collections, what each role may do with them, and the
 * row policies that decide which articles a role reaches.
 */
export const newsroom = (admin: string) => ({
  slug: 'newsroom',
  owner: admin,
  metadata: {
    display_name: 'Newsroom',
    icon: 'newspaper',
    color: 'steel',
    purpose: "The newsroom's stories, desks and corrections.",
    contact: 'desk@example.com',
  },
  collections: [
    {
      name: 'sections',
      note: 'The desks an article is filed under.',
      row_security: false,
      metadata: {
        display_name: 'Sections',
        icon: 'list-todo',
        color: 'cyan',
      },
      fields: [
        {
          name: 'name',
          type: 'string',
          required: true,
          unique: true,
          options: {
            max_length: 60,
          },
          renderers: {
            list: {
              renderer: 'marked',
              options: {
                icon: 'newspaper',
                colour: 'steel',
              },
            },
          },
        },
        {
          name: 'desk_email',
          type: 'string',
        },
      ],
    },
    {
      name: 'articles',
      note: 'Every story, from first draft to publication.',
      metadata: {
        display_name: 'Articles',
        icon: 'file-text',
        color: 'indigo',
        display_field: 'title',
        retention: {
          drafts_days: 90,
          published: 'forever',
        },
      },
      fields: [
        {
          name: 'title',
          type: 'string',
          required: true,
          options: {
            max_length: 120,
          },
          metadata: {
            display_name: 'Headline',
          },
        },
        {
          name: 'status',
          type: 'string',
          required: true,
          indexed: true,
          default: 'draft',
          options: {
            choices: ['draft', 'review', 'published'],
          },
        },
        {
          name: 'section',
          type: 'm2o',
          relation: {
            collection: 'sections',
            on_delete: 'restrict',
          },
        },
        {
          name: 'word_count',
          type: 'integer',
          options: {
            min: 0,
          },
          renderers: {
            list: 'reading-time',
          },
        },
        {
          name: 'published_at',
          type: 'timestamp',
        },
        {
          name: 'internal_notes',
          type: 'text',
          note: 'Editors only: legal flags, sources, embargoes.',
          metadata: {
            display_name: 'Legal flags',
          },
        },
      ],
    },
    ...newsroomTags,
    {
      name: 'corrections',
      metadata: {
        display_name: 'Corrections',
        icon: 'pencil-ruler',
        color: 'bronze',
      },
      fields: [
        {
          name: 'article',
          type: 'm2o',
          required: true,
          relation: {
            collection: 'articles',
            on_delete: 'cascade',
          },
        },
        {
          name: 'wording',
          type: 'text',
          required: true,
        },
        {
          name: 'severity',
          type: 'string',
          required: true,
          default: 'minor',
          options: {
            choices: ['minor', 'material', 'retraction'],
          },
        },
      ],
    },
  ],
  ...newsroomAccess,
})
