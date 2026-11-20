/**
 * The example manifest: the groups, the people, the workspace, the grants and the row policy
 * that the local stack's example sign-ins need. It ships with the tools, so that the example
 * database can be brought up with one command and no file beside it.
 *
 * The roles are named after the people's addresses, because a PostgreSQL login is named after
 * the email the issuer reports. The administrator is the deployment's own: the one account
 * its Dex keeps, named on its own domain. The other two are example people.
 */
export function exampleManifest(admin: string = exampleAdmin()) {
  return {
    format: 1,
    ...exampleContents(admin),
  }
}

/**
 * The administrator of the deployment the tools run in: the one it names, or `admin` on its
 * domain. Without either there is no deployment to speak of, and the name is an example's.
 */
export function exampleAdmin(env: Record<string, string | undefined> = process.env): string {
  if (env.PLATFORM_ADMIN) return env.PLATFORM_ADMIN
  return env.PLATFORM_DOMAIN ? `admin@${env.PLATFORM_DOMAIN}` : 'admin@example.com'
}

const exampleContents = (admin: string) => ({
  groups: [{ name: 'newsroom_reader' }, { name: 'newsroom_writer' }],
  users: [
    { name: admin, admin: true },
    {
      name: 'alice@example.com',
      groups: ['newsroom_reader', 'newsroom_writer'],
    },
    {
      name: 'bob@example.com',
      groups: ['newsroom_reader', 'newsroom_writer'],
    },
  ],
  workspaces: [
    {
      slug: 'newsroom',
      owner: admin,
      collections: [
        {
          name: 'articles',
          fields: [
            {
              name: 'title',
              type: 'string',
              required: true,
              options: { max_length: 120 },
            },
            {
              name: 'status',
              type: 'string',
              required: true,
              default: 'draft',
              options: { choices: ['draft', 'published'] },
            },
            { name: 'internal_notes', type: 'text' },
          ],
        },
      ],
      grants: [
        { to: ['newsroom_reader', 'newsroom_writer'], privileges: ['usage'] },
        {
          to: 'newsroom_reader',
          collection: 'articles',
          privileges: ['select'],
          columns: [
            'id',
            'title',
            'status',
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
          privileges: ['insert', 'update', 'delete'],
          columns: ['title', 'status'],
        },
      ],
      policies: [
        {
          collection: 'articles',
          name: 'own_articles',
          to: ['newsroom_writer'],
          using: 'created_by=session_user',
          check: 'created_by=session_user',
        },
      ],
    },
  ],
})
