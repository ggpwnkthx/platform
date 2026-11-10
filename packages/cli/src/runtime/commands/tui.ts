/**
 * The interface of the operator.
 *
 * The commands of the CLI are read by a script and by a person, and
 * the person reads them better when they are drawn. The interface is
 * the same client of the same services: it asks the questions the
 * commands ask, and it draws the answers the commands answer.
 *
 * The interface needs a terminal: a machine that has none runs the
 * commands, and not the interface.
 */

import type { CommandSpec } from '../../app/commands'
import { dirname, join } from 'node:path'
import type { ResolvedContext } from '../../domains/context'
import type { Account, Found, Held } from '../../domains/deployment'
import type { InfrastructurePort } from '../../domains/infrastructure'
import { CliFailure } from '../../domains/failure'
import { azureProvider, AZURE_QUESTIONS } from '../../platform/azure'
import { Interface } from '../../tui/app'
import { terminalScreen } from '../../tui/screen'
import { type DeploymentOnMachine, plain, profileOfDeployment } from '../../tui/tasks'
import { existingOf, latestOf, offersOf, readingsOf } from './deploy'

/**
 * The credential of the administration of a deployment of this machine.
 *
 * The deployment creates the credential, and the templates answer with
 * it: the interface reads it in the state of the deployment, the way
 * the wizard does after an apply. The deployment of a profile is the
 * one whose files are on this machine and whose name, or whose address
 * of Access, is the one of the profile.
 *
 * The templates are initialized against the state of one deployment at
 * a time — the one that was deployed last. The answer of the templates
 * is checked against the profile before it is used: the credential of
 * another deployment is not a credential of this one, and it is not
 * sent to it.
 *
 * @param tool the tool that writes the infrastructure.
 * @param templates the directory of the templates of a deployment.
 * @param context the deployment the interface works on.
 */
export async function heldOf(
  tool: Pick<InfrastructurePort, 'output'>,
  templates: string,
  context: ResolvedContext
): Promise<Held> {
  const existing = await existingOf(undefined, templates)
  let environment: string | undefined
  for (const [name, values] of existing) {
    const deployment = profileOfDeployment(values, {
      public_names_enabled: values.public_names_enabled ?? '',
    })
    const sameAccess =
      context.accessUrl !== undefined &&
      plain(deployment.profile.accessUrl) === plain(context.accessUrl)
    if (deployment.name === context.name || sameAccess) {
      environment = name
      break
    }
  }
  if (environment === undefined) {
    return {
      note: `this machine holds no files of a deployment named ${context.name}: its credential is not read`,
    }
  }
  const backendConfig = join(dirname(templates), 'runtime', environment, 'backend.hcl')
  let outputs: Record<string, unknown>
  try {
    outputs = await tool.output(templates, { backendConfig })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { note: `the state of the deployment ${context.name} could not be read: ${reason}` }
  }
  const text = (name: string): string | undefined => {
    const value = outputs[name]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const accessUrl = text('access_issuer')
  if (context.accessUrl !== undefined && accessUrl !== undefined) {
    if (plain(accessUrl) !== plain(context.accessUrl)) {
      return {
        note: `the templates are initialized against the deployment of ${accessUrl}, and not against ${context.name}: its credential is read after that deployment is deployed again`,
      }
    }
  }
  const adminToken = text('access_admin_token')
  if (adminToken === undefined) {
    return {
      ...(accessUrl === undefined ? {} : { accessUrl }),
      note: `the templates of the deployment ${context.name} answered no credential of the administration`,
    }
  }
  return { adminToken, ...(accessUrl === undefined ? {} : { accessUrl }) }
}

/** The command that opens the interface of the operator. */
export const tui: CommandSpec = {
  name: 'tui',
  summary: 'the interface of the operator',
  description:
    'The interface draws the deployments of the machine, the state of their services, the tenants of Access and the grants of the deployment. It creates a deployment, and it changes the tenants, the principals and the grants of a deployment. The credentials of the administration, of the control plane and of the caller are read from the environment of the shell, and a profile never holds them.',
  examples: ['platformctl tui'],
  async run(input) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliFailure(
        'the interface needs a terminal: run it on a terminal, and not in a pipeline',
        2,
        'not_answered'
      )
    }
    const provider = azureProvider(AZURE_QUESTIONS, input.environment)
    // The release, the registry and the address of the machine are
    // read once: they do not change while the reader fills in a form.
    let readings: Promise<Found> | undefined
    let accounts: Promise<readonly Account[]> | undefined
    const screen = terminalScreen()
    const app = new Interface({
      screen,
      services: input.services,
      environment: input.environment,
      provider,
      // The credential of the administration is read in the state of
      // the deployment when the shell holds none.
      held: (templates, context) => heldOf(input.services.infrastructure, templates, context),
      // The deployments of the machine: the interface reads them to
      // know the environment of the profile the reader has selected,
      // and a deployment is applied again by its environment.
      deployments: async (templates) => {
        const existing = await existingOf(undefined, templates)
        const found = new Map<string, DeploymentOnMachine>()
        for (const [environment, values] of existing) {
          const deployment = profileOfDeployment(values, {
            public_names_enabled: values.public_names_enabled ?? '',
          })
          found.set(environment, {
            name: deployment.name,
            accessUrl: deployment.profile.accessUrl,
          })
        }
        return found
      },
      // The form of a deployment holds what the wizard of the CLI
      // reads and offers: the readings of the wizard, over the answers
      // of the deployment of the environment that is already there.
      answers: async (templates, defaults, environment) => {
        readings ??= readingsOf(defaults, input.environment)
        accounts ??= provider.accounts?.() ?? Promise.resolve([])
        const read = await readings
        const offers = offersOf(
          provider,
          defaults,
          await existingOf(undefined, templates),
          // The form opens on the deployment the operator wrote last,
          // until the reader names another environment.
          environment ?? (await latestOf(templates))
        )
        return { ...read, values: { ...offers, ...read.values }, accounts: await accounts }
      },
    })
    await app.start()
    return { value: { interface: 'closed' }, lines: [] }
  },
}
