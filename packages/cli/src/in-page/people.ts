import type { Person } from '@platform/ui/pg/connect.ts'
import { parseManifest } from '../apply.ts'

const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

/**
 * The people who may sign in without an issuer: the people the folder's manifest names,
 * each with what the manifest says of them — what they own, whether they administer roles,
 * the groups they are in and what those own. Nobody is listed here who is not a login there.
 */
export function peopleOf(models: unknown): Person[] {
  const manifest = parseManifest(models)
  return manifest.users
    .filter((user) => user.state === 'present' && user.login)
    .map((user) => {
      const ownedBy = (owner: string) =>
        manifest.workspaces
          .filter((workspace) => workspace.owner === owner)
          .map((workspace) => workspace.slug)
      const owned = ownedBy(user.name)
      // A group may own a workspace, and then its members are who builds in it.
      const groups = user.groups.map((group) => {
        const theirs = ownedBy(group)
        return theirs.length ? `${group} (owns ${listed(theirs)})` : group
      })
      const says = [
        ...(owned.length ? [`owns ${listed(owned)}`] : []),
        ...(user.admin ? ['administers roles'] : []),
        ...(groups.length ? [`is in ${listed(groups)}`] : []),
      ]
      const note = says.join(', ')
      return {
        role: user.name,
        note: note ? `${note[0]!.toUpperCase()}${note.slice(1)}` : 'In no group',
        token: 'in-page',
      }
    })
}
