import type { DeploymentVariables } from '@platform/core'
import { crm } from './crm.ts'
import { newsroom } from './newsroom.ts'

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
  workspaces: [newsroom(admin), crm()],
})
