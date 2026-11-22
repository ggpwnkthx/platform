import type { RoleInfo } from '@platform/data'
import { Badge } from '../../ui/bits.tsx'

/** What a role's attributes let it do past every grant, said where the role is drawn. */
export function Attributes({ role }: { role: RoleInfo }) {
  return (
    <>
      {role.superuser && (
        <Badge tone="danger" title="The database checks no privilege and no row policy for it">
          superuser
        </Badge>
      )}
      {role.bypass_rls && (
        <Badge tone="danger" title="Row policies do not filter what it reaches">
          bypass RLS
        </Badge>
      )}
      {role.create_role && (
        <Badge tone="warning" title="It may make roles, and admit members to the ones it made">
          create role
        </Badge>
      )}
      {!role.inherit && (
        <Badge title="It holds its groups’ rights only after SET ROLE">no inherit</Badge>
      )}
    </>
  )
}
