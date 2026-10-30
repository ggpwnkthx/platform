/**
 * The infrastructure of the deployment.
 *
 * The deployment of the platform is written in OpenTofu, and the tool
 * is the one that decides what the deployment is. The CLI runs the
 * tool, it reads the plan the tool answers with, and it draws what the
 * tool decided.
 *
 * The CLI decides nothing about the infrastructure, for the same reason
 * it decides nothing about the access of a caller: a plan that the CLI
 * reads is the plan of the tool, and a plan that the CLI computes is a
 * plan that nobody proved. The CLI never writes a file of the
 * deployment either: the state, the values and the plan belong to the
 * deployment, and the tool writes them.
 */

/** What a plan does to a resource of the deployment. */
export type InfrastructureAction = 'create' | 'update' | 'delete' | 'replace' | 'read' | 'no-op'

/** A resource of the deployment, as the plan of the tool names it. */
export interface PlannedResource {
  /** The address of the resource in the state of the deployment. */
  readonly address: string
  /** What the plan does to the resource. */
  readonly action: InfrastructureAction
  /** The kind of the resource. */
  readonly kind: string
  /** The name of the resource. */
  readonly name: string
  /** The provider that owns the resource. */
  readonly provider: string
}

/** What a plan does, counted. */
export interface PlanSummary {
  /** The resources the plan creates. */
  readonly create: number
  /** The resources the plan changes. */
  readonly update: number
  /** The resources the plan destroys. */
  readonly delete: number
  /** The resources the plan destroys and creates again. */
  readonly replace: number
}

/** The plan of a deployment. */
export interface InfrastructurePlan {
  /** The directory of the templates. */
  readonly directory: string
  /** The resources the plan changes. */
  readonly changes: readonly PlannedResource[]
  /** The resources that moved away from the plan. */
  readonly drift: readonly PlannedResource[]
  /** What the plan does, counted. */
  readonly summary: PlanSummary
  /** True when the plan holds an error. */
  readonly errored: boolean
  /** The file the tool wrote the plan to. */
  readonly planFile?: string
}

/** The result of an apply. */
export interface AppliedInfrastructure {
  /** The directory of the templates. */
  readonly directory: string
  /** The resources the plan changed. */
  readonly applied: readonly PlannedResource[]
  /** What the apply did, counted. */
  readonly summary: PlanSummary
}

/** The answer of the validation of the templates. */
export interface InfrastructureValidation {
  /** The directory of the templates. */
  readonly directory: string
  /** True when the templates hold against the schemas of the providers. */
  readonly valid: boolean
  /** The errors of the validation. */
  readonly errors: readonly string[]
}

/** What a run of the tool needs to know. */
export interface InfrastructureRun {
  /** The file of the values of the deployment. */
  readonly varFile?: string
  /** The file the plan is written to. */
  readonly planFile?: string
  /** The file of the configuration of the backend of the state. */
  readonly backendConfig?: string
}

/**
 * The tool that writes the infrastructure of the deployment.
 *
 * The port is the only place that knows the tool: the domain holds the
 * facts of a plan and the policy of what a plan means, and the port
 * holds the words of the tool and the way it answers.
 */
export interface InfrastructurePort {
  /** The version of the tool, as the tool names itself. */
  version(): Promise<string>
  /** The plan of the deployment. */
  plan(directory: string, run: InfrastructureRun): Promise<InfrastructurePlan>
  /** Applies a plan that the tool has written. */
  apply(directory: string, plan: InfrastructurePlan): Promise<AppliedInfrastructure>
  /** The outputs of the deployment. */
  output(directory: string, run: InfrastructureRun): Promise<Record<string, unknown>>
  /** Checks the templates of the deployment. */
  validate(directory: string): Promise<InfrastructureValidation>
}

/** The action of a plan, as the tool names it. */
const ACTIONS: Record<string, InfrastructureAction> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  replace: 'replace',
  read: 'read',
  'no-op': 'no-op',
}

/**
 * The action of a change, as the tool names it.
 *
 * The tool names the actions of a change as a list, because a change
 * that destroys a resource and creates another one is two actions. The
 * domain reads the pair as the one thing it is: a replacement.
 *
 * @param actions the actions of the change.
 */
export function actionOf(actions: readonly string[]): InfrastructureAction {
  if (actions.length === 0) return 'no-op'
  if (actions.length > 1) {
    if (actions.includes('create') && actions.includes('delete')) return 'replace'
    return ACTIONS[actions[0]!] ?? 'no-op'
  }
  return ACTIONS[actions[0]!] ?? 'no-op'
}

/**
 * What a plan does, counted.
 *
 * @param changes the resources the plan changes.
 */
export function summaryOf(changes: readonly PlannedResource[]): PlanSummary {
  let created = 0
  let updated = 0
  let deleted = 0
  let replaced = 0
  for (const change of changes) {
    if (change.action === 'create') created += 1
    if (change.action === 'update') updated += 1
    if (change.action === 'delete') deleted += 1
    if (change.action === 'replace') replaced += 1
  }
  return { create: created, update: updated, delete: deleted, replace: replaced }
}

/**
 * Reports whether a plan changes nothing.
 *
 * A plan that changes nothing is not a failure: it is the answer of a
 * deployment that is already what it should be.
 *
 * @param plan the plan of the deployment.
 */
export function changesNothing(plan: InfrastructurePlan): boolean {
  return plan.changes.length === 0
}

/**
 * Reports whether a version of the tool is too old for the templates.
 *
 * The templates ask for a version of the tool, and a tool that is older
 * than the one they ask for does not read them the way they are
 * written.
 *
 * @param version the version of the tool.
 * @param minimum the oldest version the templates hold against.
 */
export function isTooOld(version: string, minimum: string): boolean {
  const left = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = minimum.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a > b) return false
    if (a < b) return true
  }
  return false
}

/**
 * Reports whether a plan destroys something.
 *
 * The destruction of a resource is the one change that cannot be undone
 * by another plan, and a reader is told about it before it happens.
 *
 * @param plan the plan of the deployment.
 */
export function destroys(plan: InfrastructurePlan): boolean {
  return plan.changes.some((change) => change.action === 'delete' || change.action === 'replace')
}
