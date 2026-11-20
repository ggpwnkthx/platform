import type { DeploymentVariables } from '../../../packages/cli/src/folder.ts'

/**
 * The schema of the example, as a manifest: the groups, the people, the workspaces with
 * their collections, grants and row policies.
 *
 * It is a function of what a deployment says of itself, and each of those is named where it
 * is used: `admin` is the deployment's own administrator (PLATFORM_ADMIN), who is the
 * example's administrator and owns the newsroom. The two SQL files beside this one read the
 * same variables, as `current_setting('deployment.admin')`.
 */
export default ({ admin }: DeploymentVariables) => ({
  format: 1,
  groups: [
    {
      name: 'newsroom_reader',
    },
    {
      name: 'newsroom_writer',
    },
    {
      name: 'sales',
    },
  ],
  users: [
    {
      name: admin,
      admin: true,
      groups: ['newsroom_reader', 'newsroom_writer', 'sales'],
      admits: ['newsroom_reader', 'newsroom_writer', 'sales'],
    },
    {
      name: 'alice@example.com',
      groups: ['newsroom_reader', 'newsroom_writer'],
    },
    {
      name: 'bob@example.com',
      groups: ['newsroom_reader', 'newsroom_writer', 'sales'],
    },
  ],
  workspaces: [
    {
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
      grants: [
        {
          to: ['newsroom_reader', 'newsroom_writer'],
          privileges: ['usage'],
        },
        {
          to: 'newsroom_reader',
          collection: 'sections',
          privileges: ['select'],
        },
        {
          to: 'newsroom_reader',
          collection: 'articles',
          privileges: ['select'],
          columns: [
            'id',
            'title',
            'status',
            'section',
            'word_count',
            'published_at',
            'created_at',
            'updated_at',
            'created_by',
            'updated_by',
            'version',
          ],
        },
        {
          to: 'newsroom_writer',
          collection: 'articles',
          privileges: ['insert', 'update'],
          columns: ['title', 'status', 'section', 'word_count'],
        },
        {
          to: 'newsroom_writer',
          collection: 'articles',
          privileges: ['delete'],
        },
        {
          to: 'newsroom_reader',
          collection: 'corrections',
          privileges: ['select'],
        },
      ],
      policies: [
        {
          collection: 'articles',
          name: 'own_articles',
          to: ['newsroom_writer'],
          using: 'created_by = session_user',
          check: 'created_by = session_user',
        },
        {
          collection: 'articles',
          name: 'published_articles',
          for: 'select',
          to: ['newsroom_reader'],
          using: "status = 'published'",
        },
        {
          collection: 'corrections',
          name: 'readable_corrections',
          for: 'select',
          to: ['newsroom_reader'],
          using: 'true',
        },
      ],
    },
    {
      slug: 'crm',
      owner: 'sales',
      metadata: {
        display_name: 'CRM',
        icon: 'briefcase',
        color: 'purple',
        purpose: 'Accounts, the people at them and the deals in flight.',
      },
      collections: [
        {
          name: 'accounts',
          note: 'Companies and organisations: prospects, customers, partners and vendors.',
          metadata: {
            display_name: 'Accounts',
            icon: 'building-2',
            color: 'mint',
          },
          fields: [
            {
              name: 'name',
              type: 'string',
              required: true,
              indexed: true,
            },
            {
              name: 'type',
              type: 'string',
              required: true,
              default: 'prospect',
              options: {
                choices: ['prospect', 'customer', 'partner', 'vendor', 'former_customer'],
              },
            },
            {
              name: 'industry',
              type: 'string',
            },
            {
              name: 'employees',
              type: 'integer',
              options: {
                min: 0,
              },
            },
            {
              name: 'annual_revenue',
              type: 'decimal',
              modifiers: ['14', '2'],
            },
            {
              name: 'website',
              type: 'string',
            },
          ],
        },
        {
          name: 'contacts',
          fields: [
            {
              name: 'full_name',
              type: 'string',
              required: true,
            },
            {
              name: 'email',
              type: 'string',
              unique: true,
            },
            {
              name: 'title',
              type: 'string',
            },
            {
              name: 'account',
              type: 'm2o',
              relation: {
                collection: 'accounts',
                on_delete: 'set_null',
              },
            },
          ],
        },
        {
          name: 'deals',
          fields: [
            {
              name: 'name',
              type: 'string',
              required: true,
            },
            {
              name: 'account',
              type: 'm2o',
              required: true,
              relation: {
                collection: 'accounts',
                on_delete: 'cascade',
              },
            },
            {
              name: 'stage',
              type: 'string',
              required: true,
              default: 'qualify',
              options: {
                choices: ['qualify', 'propose', 'negotiate', 'won', 'lost'],
              },
            },
            {
              name: 'amount',
              type: 'decimal',
              modifiers: ['12', '2'],
              options: {
                min: 0,
              },
            },
            {
              name: 'close_date',
              type: 'date',
            },
            {
              name: 'details',
              type: 'json',
            },
          ],
        },
      ],
      grants: [
        {
          to: 'newsroom_reader',
          privileges: ['usage'],
        },
        {
          to: 'newsroom_reader',
          collection: 'accounts',
          privileges: ['select'],
          columns: ['id', 'name', 'type', 'industry', 'website'],
        },
      ],
      policies: [
        {
          collection: 'accounts',
          name: 'everyone_reads',
          for: 'select',
          to: ['public'],
          using: 'true',
        },
      ],
    },
  ],
})
