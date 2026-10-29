/**
 * The ability of the caller.
 *
 * The console asks the services what the caller may do, and it draws
 * what they answer. The ability is that drawing: the rules of the
 * console itself, and the rules of the collections of a workspace.
 *
 * The ability is a mirror and never an authority. Access
 * decides who holds a permission, and Data decides what a
 * permission grants. Every rule of the ability is an upper bound of
 * what the caller may do, and never a lower one: the console hides what
 * the services refuse, and it shows what they allow. A button that the
 * console shows and Data refuses is an annoyance; a button
 * that the console hides and Data allows is a fault.
 *
 * The library knows two wildcards: the action `manage` and the subject
 * `all`. The console has neither. The action and the subject of a rule
 * are always named, and the wildcards of the library point at a name
 * that no rule carries.
 */

import {
  createMongoAbility,
  type MongoAbility,
  type MongoQuery,
  type RawRuleFrom,
} from '@casl/ability'
import type { CollectionMetadata } from '../data'
import { CONSOLE_KEYS, type OperatorScope } from '../operators'

/** The subject of the capabilities of the console itself. */
export const CONSOLE_SUBJECT = 'console'

/** The actions of the console itself. */
export const CONSOLE_ACTIONS = {
  /** The detail of the status of the services. */
  status: 'status',
  /** The administration of the tenant of the caller. */
  admin: 'admin',
  /** The administration of every tenant of the platform. */
  platform: 'platform',
} as const

/** The ability of the console: an action, a subject and a field. */
export type ConsoleAbility = MongoAbility<[string, string]>

/** A rule of the ability. */
export type AbilityRule = RawRuleFrom<[string, string], MongoQuery>

/** The name that matches no action: the console has no wildcard. */
const NO_ACTION = 'console.no-action-matches-every-action'

/** The name that matches no subject: the console has no wildcard. */
const NO_SUBJECT = 'console.no-subject-matches-every-subject'

/**
 * The field of a rule that grants no field.
 *
 * A rule of the library without fields holds every field of its
 * subject, and a rule with an empty list of fields is refused. A
 * collection whose policies grant no field is therefore named by a
 * field that no column of a manifest can carry: the names of the fields
 * are lower case letters, digits and underscores.
 */
const NO_FIELD = 'console.no-field'

/**
 * Builds an ability from rules.
 *
 * The wildcards of the library are pointed at names that no rule
 * carries: an action of `manage` grants every action, and a rule
 * without a subject grants every subject, and the console holds
 * neither.
 */
export function abilityOf(rules: readonly AbilityRule[]): ConsoleAbility {
  return createMongoAbility<[string, string]>([...rules], {
    anyAction: NO_ACTION,
    anySubjectType: NO_SUBJECT,
  })
}

/**
 * The rules of the console itself, from the scope of the operator.
 *
 * The scope is the source: Access says which keys the
 * caller holds on the route of the console, and the scope draws them.
 * The rules are that drawing.
 */
export function consoleRules(scope: OperatorScope): AbilityRule[] {
  const rules: AbilityRule[] = []
  // The refusals come first and the grants after them: a later rule wins,
  // so a refusal only speaks where no grant holds.
  rules.push(
    {
      inverted: true,
      action: CONSOLE_ACTIONS.status,
      subject: CONSOLE_SUBJECT,
      reason: `The detail of the status needs the key ${CONSOLE_KEYS.status}, and Access gives you none on the route of the console.`,
    },
    {
      inverted: true,
      action: CONSOLE_ACTIONS.admin,
      subject: CONSOLE_SUBJECT,
      reason: `The administration needs the key ${CONSOLE_KEYS.admin}, and Access gives you none on the route of the console.`,
    },
    {
      inverted: true,
      action: CONSOLE_ACTIONS.platform,
      subject: CONSOLE_SUBJECT,
      reason: `Every tenant is administered with the key ${CONSOLE_KEYS.platform}, and Access gives you none on the route of the console.`,
    }
  )
  if (scope.status) {
    rules.push({ action: CONSOLE_ACTIONS.status, subject: CONSOLE_SUBJECT })
  }
  if (scope.administers === 'tenant') {
    rules.push({ action: CONSOLE_ACTIONS.admin, subject: CONSOLE_SUBJECT })
  }
  if (scope.administers === 'platform') {
    rules.push({
      action: [CONSOLE_ACTIONS.admin, CONSOLE_ACTIONS.platform],
      subject: CONSOLE_SUBJECT,
    })
  }
  return rules
}

/** The ability of the console itself, for the caller. */
export function consoleAbility(scope: OperatorScope): ConsoleAbility {
  return abilityOf(consoleRules(scope))
}

/**
 * The rules of a collection, from the metadata Data published.
 *
 * The metadata is the answer of Data about the caller: the
 * actions it may perform and the fields it may read and write. The
 * rules are that answer, and nothing else.
 *
 * The fields of the metadata are the union of the fields of the
 * policies that apply, and the rules are the same union: a rule is
 * about what the caller may do at most, and Data decides
 * what it may do for one row.
 */
export function collectionRules(collection: CollectionMetadata): AbilityRule[] {
  const rules: AbilityRule[] = []
  const actions = new Set(collection.actions)
  const subject = collection.key
  if (actions.has('read')) {
    rules.push({ action: 'read', subject, ...fieldsOf(collection.readableFields) })
  }
  for (const action of ['create', 'update'] as const) {
    if (!actions.has(action)) continue
    rules.push({ action, subject, ...fieldsOf(collection.writableFields) })
  }
  if (actions.has('delete')) {
    rules.push({ action: 'delete', subject })
  }

  // The refusals, with their reasons. They follow the grants, and an
  // inverted rule with fields refuses those fields alone: the action
  // itself stays granted.
  for (const action of COLLECTION_ACTIONS) {
    if (!actions.has(action)) {
      rules.push({
        inverted: true,
        action,
        subject,
        reason: `Data's policies do not let you ${VERBS[action]} records of ${collection.label}.`,
      })
    }
  }
  const named = collection.fields.map((field) => field.name)
  const hidden = named.filter((name) => !collection.readableFields.includes(name))
  if (actions.has('read') && hidden.length > 0) {
    rules.push({
      inverted: true,
      action: 'read',
      subject,
      fields: hidden,
      reason: `Data's policies hide this field of ${collection.label} from you.`,
    })
  }
  const fixed = named.filter((name) => !collection.writableFields.includes(name))
  for (const action of ['create', 'update'] as const) {
    if (!actions.has(action) || fixed.length === 0) continue
    rules.push({
      inverted: true,
      action,
      subject,
      fields: fixed,
      reason:
        action === 'create'
          ? `Data's policies do not let you set this field when you create a record of ${collection.label}: it gets its default.`
          : `Data's policies do not let you change this field of ${collection.label}.`,
    })
  }
  return rules
}

/** The actions on the records of a collection. */
const COLLECTION_ACTIONS = ['read', 'create', 'update', 'delete'] as const

/** An action on the records of a collection. */
type CollectionAction = (typeof COLLECTION_ACTIONS)[number]

/** The verb of an action, as a sentence says it. */
const VERBS: Record<CollectionAction, string> = {
  read: 'read',
  create: 'create',
  update: 'change',
  delete: 'delete',
}

/** The ability of a collection of a workspace, for the caller. */
export function collectionAbility(collection: CollectionMetadata): ConsoleAbility {
  return abilityOf(collectionRules(collection))
}

/**
 * The ability of the caller: the rules of the console, and the rules
 * of a collection when the page is about one.
 */
export function abilityFor(scope: OperatorScope, collection?: CollectionMetadata): ConsoleAbility {
  return abilityOf([...consoleRules(scope), ...(collection ? collectionRules(collection) : [])])
}

/**
 * Reports whether the caller administers its own tenant and not the
 * platform.
 *
 * An operator of the platform administers every tenant, and an operator
 * of a tenant administers its own. The two rights are different, and a
 * page shows the platform to the first one alone.
 */
export function administersOwnTenant(ability: ConsoleAbility): boolean {
  return (
    ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT) &&
    !ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)
  )
}

/**
 * The fields of a rule.
 *
 * A rule without fields holds every field of its subject, and the
 * library refuses a rule with an empty list of fields. A rule that
 * grants no field holds the field that no column carries.
 */
function fieldsOf(names: readonly string[]): { fields: string[] } {
  return { fields: names.length > 0 ? [...names] : [NO_FIELD] }
}

/** The reason a refusal is shown with, when no rule of the ability names one. */
const NO_RULE = 'Nothing the services answered gives you this.'

/**
 * Why the ability refuses an action, or null when it allows it.
 *
 * The reason is the one of the rule that decides: the library finds it.
 * An action that no rule names at all has the general reason.
 */
export function reasonOf(
  ability: ConsoleAbility,
  action: string,
  subject: string,
  field?: string
): string | null {
  if (ability.can(action, subject, field)) return null
  const rule = ability.relevantRuleFor(action, subject, field)
  return rule?.inverted && rule.reason ? rule.reason : NO_RULE
}

/** An answer of the ability: whether it allows, and why not. */
export interface Allowance {
  readonly allowed: boolean
  readonly reason: string | null
}

/** What the caller may do with a collection: its actions, and each field. */
export interface CollectionAccess {
  readonly actions: Readonly<Record<CollectionAction, Allowance>>
  readonly fields: readonly {
    readonly name: string
    readonly label: string
    readonly read: Allowance
    readonly create: Allowance
    readonly update: Allowance
  }[]
}

/** The access of the caller to a collection, as a grid draws it. */
export function collectionAccessOf(collection: CollectionMetadata): CollectionAccess {
  const ability = collectionAbility(collection)
  const answer = (action: string, field?: string): Allowance => {
    const reason = reasonOf(ability, action, collection.key, field)
    return { allowed: reason === null, reason }
  }
  return {
    actions: {
      read: answer('read'),
      create: answer('create'),
      update: answer('update'),
      delete: answer('delete'),
    },
    fields: collection.fields.map((field) => ({
      name: field.name,
      label: field.label ?? field.name,
      read: answer('read', field.name),
      create: answer('create', field.name),
      update: answer('update', field.name),
    })),
  }
}
