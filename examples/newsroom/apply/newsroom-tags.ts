/**
 * The subjects a story is filed under, and the link between a story and its subjects:
 * a join table made of two keys and nothing else, with the pair unique.
 */
export const newsroomTags = [
  {
    name: 'tags',
    note: 'The subjects a story is filed under.',
    row_security: false,
    metadata: {
      display_name: 'Tags',
      icon: 'tags',
      color: 'grape',
    },
    fields: [
      {
        name: 'name',
        type: 'string',
        required: true,
        unique: true,
        options: {
          max_length: 40,
        },
      },
    ],
  },
  {
    name: 'article_tags',
    note: 'Which story carries which tag: a link between two rows, and nothing else.',
    row_security: false,
    metadata: {
      display_name: 'Article tags',
      icon: 'link',
      color: 'gray',
    },
    // The pair is one link: a story carries a tag once.
    unique: [['article', 'tag']],
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
        name: 'tag',
        type: 'm2o',
        required: true,
        relation: {
          collection: 'tags',
          on_delete: 'cascade',
        },
      },
    ],
  },
]
