/**
 * What the caller may do with a workspace besides its records: read its
 * model, change it, read its audit.
 *
 * The three are capabilities of Data, and their keys are fixed in its
 * code. Access says whether the caller holds them on the workspace, and
 * the console reads the answer in the access context of the caller —
 * the question Data itself asks — to draw a tab as closed before the
 * caller opens it.
 *
 * The rules are an upper bound, like every rule of the ability. A
 * context the console could not read closes nothing: the tabs are drawn
 * open, and Data answers. An answer Data already gave is the one that
 * counts: a model or an audit it served is one the caller reads,
 * whatever the keys said a moment before.
 */

import { DATA_KEYS } from '../operators'
import {
  type AbilityRule,
  abilityOf,
  allowanceOf,
  type Capability,
  type ConsoleAbility,
} from './ability'

/** The parts of a workspace that a capability of their own opens. */
export const WORKSPACE_PARTS = {
  /** The data model of the workspace. */
  model: 'workspace.model',
  /** The audit of the workspace. */
  audit: 'workspace.audit',
} as const

/**
 * What Data answered about the model of a workspace, when the page
 * asked for it: it refused it, it served it to be read, or it served it
 * to be changed.
 */
export type ModelAnswer = 'refused' | 'read' | 'write'

/** What the console knows of the caller on a workspace. */
export interface WorkspaceFacts {
  /**
   * The permissions Access gives the caller on the workspace and its
   * route, or null when the console could not ask.
   */
  readonly keys: readonly string[] | null
  /** What Data answered about the model, on the page that asked for it. */
  readonly model?: ModelAnswer
  /** Whether Data served the audit, on the page that asked for it. */
  readonly audit?: boolean
}

/** What a caller that holds nothing is told to ask for. */
const ASK = 'An operator of your tenant can grant it on this workspace.'

/** The rules of the parts of a workspace, from what the console knows of the caller there. */
function workspacePartRules(facts: WorkspaceFacts): AbilityRule[] {
  const holds = (key: string) => facts.keys === null || facts.keys.includes(key)
  const readsModel =
    facts.model === undefined
      ? holds(DATA_KEYS.modelRead) || holds(DATA_KEYS.modelWrite)
      : facts.model !== 'refused'
  const changesModel =
    facts.model === undefined ? holds(DATA_KEYS.modelWrite) : facts.model === 'write'
  const readsAudit = facts.audit ?? holds(DATA_KEYS.auditRead)

  // A reason says what the console knows and no more: that Access gives
  // no key when it read the keys and found none, and that Data refused
  // when the refusal is Data's answer and the keys do not explain it.
  const lacks = (...keys: string[]) =>
    facts.keys !== null && !keys.some((key) => facts.keys?.includes(key))
  const modelKeys = `${DATA_KEYS.modelRead} or ${DATA_KEYS.modelWrite}`

  // The refusals come first and the grants after them: a later rule wins.
  const rules: AbilityRule[] = [
    {
      inverted: true,
      action: 'read',
      subject: WORKSPACE_PARTS.model,
      reason: lacks(DATA_KEYS.modelRead, DATA_KEYS.modelWrite)
        ? `Reading the data model needs the permission ${modelKeys}, and Access gives you neither on this workspace. ${ASK}`
        : `Data refuses you the data model of this workspace: reading it needs the permission ${modelKeys}. ${ASK}`,
    },
    {
      inverted: true,
      action: 'update',
      subject: WORKSPACE_PARTS.model,
      reason: lacks(DATA_KEYS.modelWrite)
        ? `Changing the data model needs the permission ${DATA_KEYS.modelWrite}, and Access does not give it to you on this workspace. ${ASK}`
        : `Data serves you this model to be read, and not to be changed: changing it needs the permission ${DATA_KEYS.modelWrite}. ${ASK}`,
    },
    {
      inverted: true,
      action: 'read',
      subject: WORKSPACE_PARTS.audit,
      reason: lacks(DATA_KEYS.auditRead)
        ? `Reading the audit needs the permission ${DATA_KEYS.auditRead}, and Access does not give it to you on this workspace. ${ASK}`
        : `Data refuses you the audit of this workspace: reading it needs the permission ${DATA_KEYS.auditRead}. ${ASK}`,
    },
  ]
  if (readsModel) rules.push({ action: 'read', subject: WORKSPACE_PARTS.model })
  if (changesModel) rules.push({ action: 'update', subject: WORKSPACE_PARTS.model })
  if (readsAudit) rules.push({ action: 'read', subject: WORKSPACE_PARTS.audit })
  return rules
}

/** The ability of the caller on the parts of a workspace. */
export function workspaceAbility(facts: WorkspaceFacts): ConsoleAbility {
  return abilityOf(workspacePartRules(facts))
}

/** What the caller may do with the parts of a workspace, as a list says it. */
export function workspaceCapabilitiesOf(ability: ConsoleAbility): Capability[] {
  return [
    {
      label: 'Read the data model',
      key: DATA_KEYS.modelRead,
      allowance: allowanceOf(ability, 'read', WORKSPACE_PARTS.model),
    },
    {
      label: 'Change the data model',
      key: DATA_KEYS.modelWrite,
      allowance: allowanceOf(ability, 'update', WORKSPACE_PARTS.model),
    },
    {
      label: 'Read the audit',
      key: DATA_KEYS.auditRead,
      allowance: allowanceOf(ability, 'read', WORKSPACE_PARTS.audit),
    },
  ]
}
