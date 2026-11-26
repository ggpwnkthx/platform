import { Link, useParams } from 'react-router-dom'
import { KindTable } from '../kit/Kinds.tsx'
import { Page } from '../kit/Page.tsx'
import { useNames, useSchema } from '../kit/place.ts'
import { grants } from './grants.tsx'
import { databaseGrants } from './database-grants.tsx'
import { memberships } from './memberships.tsx'
import { roles } from './roles.tsx'

/** Roles: PostgreSQL's roles, as the caller may see them. They are the same in every schema. */
export const RoleList = () => (
  <Page title="Roles">
    <KindTable kind={roles} where={{}} lead />
    <KindTable kind={memberships} where={{}} />
    <KindTable kind={databaseGrants} where={{}} />
  </Page>
)

/** One role: what it belongs to, who belongs to it, and what it holds in the schema in view. */
export function RolePage() {
  const { role = '' } = useParams()
  const inView = useSchema()
  const names = useNames()
  return (
    <Page title={role} crumb={<Link to="/roles">Roles</Link>}>
      <KindTable
        kind={memberships}
        where={{ member: role }}
        add="Grant a role to it"
        title="Member of"
      />
      <KindTable kind={memberships} where={{ role }} add="Grant it to a role" title="Members" />
      {inView && (
        <KindTable
          kind={grants}
          where={{ schema: inView.name, role }}
          title={`Holds in ${names(inView.name).name}`}
        />
      )}
    </Page>
  )
}
