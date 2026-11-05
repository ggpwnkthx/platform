/**
 * The infrastructure of the deployment.
 *
 * The deployment of the platform is written in OpenTofu, and the CLI
 * drives the tool: it runs it, it reads the plan the tool answers with,
 * and it draws what the tool decided. The CLI decides nothing itself,
 * and it writes no file of the deployment: the state, the values and
 * the plan belong to the deployment, and the tool writes them.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandInput, CommandResult, GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { tableLines } from '../../app/output'
import { confirm } from '../../app/prompt'
import { CliFailure } from '../../domains/failure'
import {
  changesNothing,
  type InfrastructurePlan,
  type InfrastructurePort,
  type InfrastructureRun,
  isTooOld,
  questionOf,
  countedOf,
  type PlannedResource,
} from '../../domains/infrastructure'
import { lockOf, MINIMUM_TOFU, redact } from '../../platform/tofu'
import { pathOf, placeOf } from '../../platform/checkout'

/** The directory of the templates, when the reader names none. */
const DEFAULT_DIRECTORY = join('deploy', 'tofu', 'azure')

/** The directory of the files of the deployment, when the reader names none. */
const DEFAULT_RUNTIME = join('deploy', 'tofu', 'runtime')

/** The name of the file of the values of the deployment. */
const VALUES = 'terraform.tfvars'

/** The name of the file of the plan of the deployment. */
const PLAN = 'plan.bin'

/**
 * The directory of the templates of the deployment.
 *
 * The templates live in a checkout of the repository, and the command
 * may run in a directory of the checkout: the path of the templates is
 * read from the checkout.
 *
 * @param input what the command received.
 */
function directoryOf(input: CommandInput): string {
  const named = stringOf(input.options, 'directory')
  return named === undefined ? placeOf(DEFAULT_DIRECTORY) : pathOf(named)
}

/**
 * The directory of the files of the deployment.
 *
 * The files of a deployment are named after the profile of the
 * deployment: the files of the production are the files of the
 * production, and the files of the staging are the files of the
 * staging.
 *
 * @param input what the command received.
 */
function runtimeOf(input: CommandInput): string {
  const named = stringOf(input.options, 'runtime')
  if (named) return pathOf(named)
  return placeOf(join(DEFAULT_RUNTIME, input.context.name))
}

/**
 * The file of the values of the deployment.
 *
 * @param input what the command received.
 * @param runtime the directory of the files of the deployment.
 */
function valuesOf(input: CommandInput, runtime: string): string {
  const named = stringOf(input.options, 'var-file')
  if (named) return pathOf(named)
  return join(runtime, VALUES)
}

/**
 * The file of the configuration of the backend of the state.
 *
 * @param runtime the directory of the files of the deployment.
 */
function backendOf(runtime: string): string {
  return join(runtime, 'backend.hcl')
}

/**
 * The directory of the files of the deployment, when it is there.
 *
 * @param runtime the directory of the files of the deployment.
 */
function requireRuntime(runtime: string): string {
  if (!existsSync(runtime)) {
    throw new CliFailure(`the directory of the deployment is not there: ${runtime}`, 4, 'not_found')
  }
  return runtime
}

/**
 * The file of the values of the deployment, when it is there.
 *
 * The import reads the templates, and the templates read the values of
 * the deployment: the import is told where they are, when they are
 * there. A deployment that has no values yet imports without them,
 * and the templates ask for what they need.
 *
 * @param input what the command received.
 * @param runtime the directory of the files of the deployment.
 */
function valuesWhenThere(input: CommandInput, runtime: string): string | undefined {
  const named = stringOf(input.options, 'var-file')
  if (named) return pathOf(named)
  const file = join(runtime, 'terraform.tfvars')
  return existsSync(file) ? file : undefined
}

/**
 * The plan of the deployment, and the lock of the state when the state
 * is locked.
 *
 * The state of the deployment is locked when another run holds its
 * lock, and the tool refuses to write the plan at all. The operator
 * says whether that run is still there: the lock is freed when it is
 * not, and the plan is written again.
 *
 * @param port the tool that writes the infrastructure.
 * @param directory the directory of the templates.
 * @param runtime the directory of the files of the deployment.
 * @param varFile the file of the values of the deployment.
 * @param input what the command received.
 */
export async function planOf(
  port: InfrastructurePort,
  directory: string,
  runtime: string,
  varFile: string,
  input: CommandInput
): Promise<InfrastructurePlan> {
  const run = { varFile, planFile: join(runtime, PLAN) }
  try {
    return await port.plan(directory, run)
  } catch (error) {
    const unlocked = await unlockState(port, directory, run, error, input.globals.yes, (text) =>
      input.services.progress(text)
    )
    if (!unlocked) throw error
    return await port.plan(directory, run)
  }
}

/**
 * Frees the lock of the state of the deployment, when the tool refuses
 * to write the plan because the state is locked.
 *
 * A run that was killed leaves the lock of the state behind it, and the
 * next run cannot write the state at all. The operator says whether the
 * run that holds the lock is still there: the lock is freed when it is
 * not, and the refusal names the command that frees it when the
 * operator says no.
 *
 * @param port the tool that writes the infrastructure.
 * @param directory the directory of the templates.
 * @param run what the run needs to know.
 * @param error what the tool refused with.
 * @param yes true when the operator has already said yes to everything.
 * @param tell what the operator is told about the lock.
 */
export async function unlockState(
  port: InfrastructurePort,
  directory: string,
  run: InfrastructureRun,
  error: unknown,
  yes: boolean,
  tell: (text: string) => void
): Promise<boolean> {
  if (!(error instanceof CliFailure)) return false
  const lock = lockOf(error.message)
  if (lock === undefined) return false
  const where = `the state of the deployment is locked by ${lock.who} since ${lock.created} (lock ${lock.id})`
  try {
    await confirm(
      `${where}: the run that holds the lock is not there anymore, and the lock is freed?`,
      yes,
      process.stdin,
      process.stderr
    )
  } catch (refusal) {
    if (refusal instanceof CliFailure && refusal.code === 'not_confirmed') {
      throw new CliFailure(
        `the deployment is not applied: ${where}: the lock is freed with: tofu -chdir=${directory} force-unlock -force ${lock.id}`,
        5,
        'locked'
      )
    }
    throw refusal
  }
  await port.unlock(directory, lock.id, run)
  tell(`the lock of the state of the deployment is freed: ${lock.id}`)
  return true
}

/**
 * The tool that writes the infrastructure, when it is new enough.
 *
 * The templates ask for a version of the tool, and a tool that is older
 * reads them another way: the CLI refuses rather than apply a plan the
 * tool did not write the way the templates expect.
 *
 * @param input what the command received.
 */
export async function toolOf(input: CommandInput): Promise<InfrastructurePort> {
  const port = input.services.infrastructure
  const version = await port.version()
  if (isTooOld(version, MINIMUM_TOFU)) {
    throw new CliFailure(
      `the tool that writes the infrastructure is too old: the templates need ${MINIMUM_TOFU} or later, and this one is ${version}`,
      8,
      'tool_too_old'
    )
  }
  return port
}

/**
 * The lines of a plan, as a human reads them.
 *
 * The plan says what it does, counted, before it says what it does:
 * the reader sees how many resources the plan touches before the plan
 * itself.
 *
 * @param plan the plan of the deployment.
 */
export function linesOfPlan(plan: InfrastructurePlan): string[] {
  if (changesNothing(plan)) return ['the deployment is already what it should be']
  return [countedOf(plan), '', ...tableOfPlan(plan)]
}

/**
 * The lines of the table of a plan, as a human reads them.
 *
 * The question of the operator names what the plan does, counted: the
 * table of the plan does not say it again.
 *
 * @param plan the plan of the deployment.
 */
export function tableOfPlan(plan: InfrastructurePlan): string[] {
  return tableOfChanges(plan.changes)
}

/**
 * The lines of the table of the resources a run changed, as a human
 * reads them.
 *
 * The table of a plan and the table of an apply are the same table: the
 * resources are named the same way, and the action of a resource is the
 * action the tool did to it.
 *
 * @param changes the resources the run changed.
 */
export function tableOfChanges(changes: readonly PlannedResource[]): string[] {
  const rows = changes.map((change) => [change.action, change.kind, change.address])
  const header = ['action', 'kind', 'address']
  return tableLines(header, rows, false)
}

/**
 * The lines the operator reads before it answers about a plan.
 *
 * The lines name what the plan destroys and, when the answer of the
 * command is a table, the plan itself. The lines are shown whatever
 * the format of the answer is: the plan that is applied is the plan
 * that was shown, and a reader who answers in json has read the plan
 * as well as a reader who answers in a table.
 *
 * The question of the operator names what the plan does, counted. The
 * count is named here as well only when the question is not asked:
 * `--yes` answers the question, and it does not hide the plan the
 * answer is about.
 *
 * @param plan the plan of the deployment.
 * @param table true when the answer of the command is a table.
 * @param counted true when the question does not name what the plan does.
 */
export function planContext(plan: InfrastructurePlan, table: boolean, counted: boolean): string[] {
  const lines: string[] = []
  if (counted) lines.push(countedOf(plan))
  const destroyed = plan.changes.filter(
    (change) => change.action === 'delete' || change.action === 'replace'
  )
  if (destroyed.length > 0) {
    lines.push('the plan destroys:')
    for (const change of destroyed) lines.push(`  ${change.address}`)
  }
  if (table) lines.push('', ...tableOfPlan(plan))
  return lines
}

/**
 * The value of an output, as a human reads it.
 *
 * @param value the value of the output.
 */
function formatOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** The group of the infrastructure of the deployment. */
export const infrastructureGroup: GroupSpec = {
  name: 'infra',
  summary: 'the infrastructure of the deployment',
  description:
    'The deployment is written in OpenTofu. The CLI runs the tool and shows what it decided: it decides nothing itself, and it writes no file of the deployment.',
  commands: [
    {
      name: 'plan',
      summary: 'show what the deployment would change',
      description:
        'The tool writes the plan in the directory of the deployment, and the CLI shows what the tool decided. Nothing is applied.',
      options: [
        {
          name: 'directory',
          kind: 'string',
          summary: 'the directory of the templates of the deployment',
        },
        {
          name: 'runtime',
          kind: 'string',
          summary: 'the directory of the files of the deployment',
        },
        {
          name: 'var-file',
          kind: 'string',
          summary: 'the file of the values of the deployment',
        },
      ],
      examples: ['platformctl infra plan'],
      async run(input: CommandInput): Promise<CommandResult> {
        const port = await toolOf(input)
        const directory = directoryOf(input)
        const runtime = requireRuntime(runtimeOf(input))
        const varFile = valuesOf(input, runtime)
        const plan = await planOf(port, directory, runtime, varFile, input)
        return {
          value: {
            directory: plan.directory,
            summary: plan.summary,
            changes: plan.changes,
            drift: plan.drift,
          },
          lines: linesOfPlan(plan),
        }
      },
    },
    {
      name: 'apply',
      summary: 'apply the plan of the deployment',
      description:
        'The plan is written and shown first, and the deployment is applied only when the reader confirms it. The plan that is applied is the plan that was shown.',
      options: [
        {
          name: 'directory',
          kind: 'string',
          summary: 'the directory of the templates of the deployment',
        },
        {
          name: 'runtime',
          kind: 'string',
          summary: 'the directory of the files of the deployment',
        },
        {
          name: 'var-file',
          kind: 'string',
          summary: 'the file of the values of the deployment',
        },
      ],
      examples: ['platformctl infra apply'],
      async run(input: CommandInput): Promise<CommandResult> {
        const port = await toolOf(input)
        const directory = directoryOf(input)
        const runtime = requireRuntime(runtimeOf(input))
        const varFile = valuesOf(input, runtime)
        const plan = await planOf(port, directory, runtime, varFile, input)
        const lines = linesOfPlan(plan)
        const value = {
          directory: plan.directory,
          summary: plan.summary,
          changes: plan.changes,
          drift: plan.drift,
        }
        if (input.globals.dryRun) {
          return { value, lines, message: 'the plan is written and nothing is applied' }
        }
        if (changesNothing(plan)) {
          return { value, lines: [], message: 'the deployment is already what it should be' }
        }
        // The plan is what the reader answers about: it is shown
        // before the question, whatever the format of the answer is,
        // and the question names what the plan does, counted.
        await confirm(
          questionOf(plan),
          input.globals.yes,
          process.stdin,
          process.stderr,
          planContext(
            plan,
            input.globals.output === 'table' && !input.globals.quiet,
            input.globals.yes
          ),
          (text) => input.services.progress(text)
        )
        const applied = await port.apply(directory, plan)
        return {
          value: {
            directory: applied.directory,
            summary: applied.summary,
            applied: applied.applied,
          },
          lines,
          message: 'the deployment is applied',
        }
      },
    },
    {
      name: 'output',
      summary: 'show the outputs of the deployment',
      description:
        'The outputs are the facts the deployment answers with: the addresses of DNS, the issuer of Access and the credentials the operator commands take. A credential never reaches a line.',
      options: [
        {
          name: 'directory',
          kind: 'string',
          summary: 'the directory of the templates of the deployment',
        },
        {
          name: 'runtime',
          kind: 'string',
          summary: 'the directory of the files of the deployment',
        },
        {
          name: 'name',
          kind: 'string',
          summary: 'the name of one output',
        },
      ],
      examples: ['platformctl infra output', 'platformctl infra output --name dns_gateway'],
      async run(input: CommandInput): Promise<CommandResult> {
        const port = await toolOf(input)
        const runtime = runtimeOf(input)
        // The outputs carry the credentials of the deployment, and a
        // credential never reaches a line of a terminal: the answer is
        // held back here, where it is drawn, and not only in the tool
        // that reads it.
        const outputs = redact(
          await port.output(directoryOf(input), { backendConfig: backendOf(runtime) })
        ) as Record<string, unknown>
        const name = stringOf(input.options, 'name')
        if (name === undefined) {
          return {
            value: outputs,
            lines: Object.entries(outputs).map(([key, value]) => `${key} = ${formatOf(value)}`),
          }
        }
        if (!(name in outputs)) {
          throw new CliFailure(`the deployment has no output named ${name}`, 4, 'not_found')
        }
        const value = outputs[name]
        return {
          value: { name, value },
          lines: [`${name} = ${formatOf(value)}`],
        }
      },
    },
    {
      name: 'import',
      summary: 'write a resource of the cloud into the state of the deployment',
      description:
        'A resource that a failed apply left in the cloud is not in the state of the deployment, and the next apply refuses to create it again. The import writes the resource into the state, and the deployment goes on.',
      arguments: [
        {
          name: 'address',
          summary: 'the address of the resource in the state of the deployment',
          required: true,
        },
        {
          name: 'id',
          summary: 'the identifier of the resource in the cloud',
          required: true,
        },
      ],
      options: [
        {
          name: 'directory',
          kind: 'string',
          summary: 'the directory of the templates of the deployment',
        },
        {
          name: 'runtime',
          kind: 'string',
          summary: 'the directory of the files of the deployment',
        },
        {
          name: 'var-file',
          kind: 'string',
          summary: 'the file of the values of the deployment',
        },
      ],
      examples: ['platformctl infra import azurerm_key_vault.platform /subscriptions/…/vaults/…'],
      async run(input: CommandInput): Promise<CommandResult> {
        const port = await toolOf(input)
        const address = input.args[0]
        const id = input.args[1]
        if (address === undefined || id === undefined) {
          throw new CliFailure(
            'the import needs the address of the resource and its identifier',
            2,
            'missing_argument'
          )
        }
        const runtime = runtimeOf(input)
        await port.import(directoryOf(input), address, id, {
          varFile: valuesWhenThere(input, runtime),
        })
        return {
          value: { address, id },
          message: `${address} is written in the state of the deployment`,
        }
      },
    },
    {
      name: 'validate',
      summary: 'check the templates of the deployment',
      description:
        'The templates are checked against the schemas of the providers, and no cloud is needed. The working directory of the tool is written in the directory of the templates.',
      options: [
        {
          name: 'directory',
          kind: 'string',
          summary: 'the directory of the templates of the deployment',
        },
      ],
      examples: ['platformctl infra validate'],
      async run(input: CommandInput): Promise<CommandResult> {
        const port = await toolOf(input)
        const validation = await port.validate(directoryOf(input))
        return {
          value: validation,
          lines: validation.valid
            ? ['the templates hold against the schemas of the providers']
            : validation.errors.map((error) => `error: ${error}`),
          exit: validation.valid ? 0 : 8,
        }
      },
    },
  ],
}
