/** What each role may do with the newsroom, and which rows each one reaches. */
export const newsroomAccess = {
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
    {
      to: ['newsroom_reader', 'newsroom_writer'],
      collection: 'tags',
      privileges: ['select'],
    },
    {
      to: 'newsroom_reader',
      collection: 'article_tags',
      privileges: ['select'],
    },
    {
      to: 'newsroom_writer',
      collection: 'article_tags',
      privileges: ['insert', 'delete'],
      columns: ['article', 'tag'],
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
}
