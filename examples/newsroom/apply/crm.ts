/**
 * The CRM's own schema: the accounts, the people at them and the deals in flight.
 */
export const crm = () => ({
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
})
