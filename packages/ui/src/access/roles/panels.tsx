import type { MembershipInfo, RoleInfo } from '@platform/data'
import { Badge } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { AddMemberIcon, PlusIcon, TrashIcon } from '../../ui/icons.tsx'
import { RoleLabel } from '../rights.tsx'

/** The groups a role belongs to, and the members of it, side by side. */
export function MembershipPanels({
  name,
  memberOf,
  members,
  all,
  admits,
  isLogin,
  isOperator,
  onAddGroup,
  onAddMember,
  onRemove,
}: {
  name: string
  memberOf: MembershipInfo[]
  members: MembershipInfo[]
  all: RoleInfo[]
  /** Whether the role may admit others to itself. */
  admits: boolean
  /** Whether the role is a person: a user has no members. */
  isLogin: boolean
  isOperator: boolean
  onAddGroup: () => void
  onAddMember: () => void
  onRemove: (membership: MembershipInfo) => void
}) {
  return (
    <div class="split">
      <MemberOfPanel
        name={name}
        memberOf={memberOf}
        all={all}
        onAdd={onAddGroup}
        onRemove={onRemove}
      />
      <MembersPanel
        name={name}
        members={members}
        all={all}
        admits={admits}
        isLogin={isLogin}
        isOperator={isOperator}
        onAdd={onAddMember}
        onRemove={onRemove}
      />
    </div>
  )
}

/** The groups a role belongs to: the rights it holds through them. */
function MemberOfPanel({
  name,
  memberOf,
  all,
  onAdd,
  onRemove,
}: {
  name: string
  memberOf: MembershipInfo[]
  all: RoleInfo[]
  onAdd: () => void
  onRemove: (membership: MembershipInfo) => void
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Member of</h2>
          <p>The groups whose rights {name} holds.</p>
        </div>
        <Button small icon={<PlusIcon size={14} />} onClick={onAdd}>
          Add to a group
        </Button>
      </header>
      {memberOf.length ? (
        <ul class="members">
          {memberOf.map((m) => (
            <li key={m.role}>
              <RoleLabel name={m.role} roles={all} />
              {m.admin_option && <Badge tone="warning">admin</Badge>}
              {!m.inherit_option && <Badge>no inherit</Badge>}
              <button
                type="button"
                class="icon-button"
                aria-label={`Remove ${name} from ${m.role}`}
                title="Remove from the group"
                onClick={() => onRemove(m)}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="panel-note">No group you may see.</p>
      )}
    </section>
  )
}

/** The roles that belong to a role: the members of a group. */
function MembersPanel({
  name,
  members,
  all,
  admits,
  isLogin,
  isOperator,
  onAdd,
  onRemove,
}: {
  name: string
  members: MembershipInfo[]
  all: RoleInfo[]
  /** Whether the role may admit others to itself. */
  admits: boolean
  /** Whether the role is a person: a user has no members. */
  isLogin: boolean
  isOperator: boolean
  onAdd: () => void
  onRemove: (membership: MembershipInfo) => void
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Members</h2>
          <p>The roles that hold {name}’s rights.</p>
        </div>
        {admits && !isLogin && (
          <Button small icon={<AddMemberIcon size={14} />} onClick={onAdd}>
            Add member
          </Button>
        )}
      </header>
      {members.length ? (
        <ul class="members">
          {members.map((m) => (
            <li key={m.member}>
              <RoleLabel name={m.member} roles={all} />
              {m.admin_option && <Badge tone="warning">admin</Badge>}
              {admits && (
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remove ${m.member}`}
                  title="Remove from the group"
                  onClick={() => onRemove(m)}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="panel-note">
          {isLogin
            ? 'A user has no members.'
            : isOperator
              ? 'Nobody belongs to it.'
              : 'No member you may see: the database shows you your own memberships.'}
        </p>
      )}
    </section>
  )
}
