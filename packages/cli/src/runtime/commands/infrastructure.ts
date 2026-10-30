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
import { join, resolve } from 'node:path'
import type { CommandInput, CommandResult, GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { confirm } from '../../app/prompt'
import { CliFailure } from '../../domains/failure'
import {
  changesNothing,
  destroys,
  type InfrastructurePlan,
  type InfrastructurePort,
  isTooOld,
} from '../../domains/infrastructure'
import { MINIMUM_TOFU, redact } from '../../platform/tofu'

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
 * @param input what the command received.
 */
function directoryOf(input: CommandInput): string {
  return resolve(stringOf(input.options, 'directory') ?? DEFAULT_DIRECTORY)
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
  if (named) return resolve(named)
  return resolve(join(DEFAULT_RUNTIME, input.context.name))
}

/**
 * The file of the values of the deployment.
 *
 * @param input what the command received.
 * @param runtime the directory of the files of the deployment.
 */
function valuesOf(input: CommandInput, runtime: string): string {
  const named = stringOf(input.options, 'var-file')
  if (named) return resolve(named)
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
 * The tool that writes the infrastructure, when it is new enough.
 *
 * The templates ask for a version of the tool, and a tool that is older
 * reads them another way: the CLI refuses rather than apply a plan the
 * tool did not write the way the templates expect.
 *
 * @param input what the command received.
 */
async function toolOf(input: CommandInput): Promise<InfrastructurePort> {
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
 * @param plan the plan of the deployment.
 */
function linesOfPlan(plan: InfrastructurePlan): string[] {
  if (changesNothing(plan)) return ['the deployment is already what it should be']
  const rows = plan.changes.map((change) => [change.action, change.kind, change.address])
  const header = ['action', 'kind', 'address']
  const widths = header.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]!.length))
  )
  return [
    header
      .map((column, index) => column.padEnd(widths[index]!))
      .join('  ')
      .trimEnd(),
    ...rows.map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index]!))
        .join('  ')
        .trimEnd()
    ),
  ]
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
        const plan = await port.plan(directory, { varFile, planFile: join(runtime, PLAN) })
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
        const plan = await port.plan(directory, { varFile, planFile: join(runtime, PLAN) })
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
          return { value, lines, message: 'the deployment is already what it should be' }
        }
        const destroyed = destroys(plan)
        await confirm(
          destroyed
            ? `the plan destroys ${plan.summary.delete + plan.summary.replace} resources and changes ${plan.summary.create + plan.summary.update}: the deployment is applied?`
            : `the plan changes ${plan.summary.create + plan.summary.update} resources: the deployment is applied?`,
          input.globals.yes
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
