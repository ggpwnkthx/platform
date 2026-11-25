import { Link, useParams } from 'react-router-dom'
import { KindTable } from '../kit/Kinds.tsx'
import { Page } from '../kit/Page.tsx'
import { useNames, useWorkspace } from '../kit/place.ts'
import { grants } from './grants.tsx'
import { memberships, roles } from './roles.tsx'

/** Users and groups: PostgreSQL's roles, as the caller may see them. They are the same in every workspace. */
export const RoleList = () => (
  <Page title="Users and groups">
    <KindTable kind={roles} where={{}} lead />
    <KindTable kind={memberships} where={{}} />
  </Page>
)

/** One role: what it belongs to, who belongs to it, and what it holds in the workspace in view. */
export function RolePage() {
  const { role = '' } = useParams()
  const workspace = useWorkspace()
  const names = useNames()
  return (
    <Page title={role} crumb={<Link to="/roles">Users and groups</Link>}>
      <KindTable
        kind={memberships}
        where={{ member: role }}
        add="Add to a group"
        title="Belongs to"
      />
      <KindTable kind={memberships} where={{ role }} add="Add a member" title="Members" />
      {workspace && (
        <KindTable
          kind={grants}
          where={{ schema: workspace.name, role }}
          title={`Holds in ${names(workspace.name).name}`}
        />
      )}
    </Page>
  )
}
