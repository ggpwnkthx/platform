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
import type { OperatorScope } from '../operators'

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
  if (actions.has('read')) {
    rules.push({
      action: 'read',
      subject: collection.key,
      ...fieldsOf(collection.readableFields),
    })
  }
  for (const action of ['create', 'update'] as const) {
    if (!actions.has(action)) continue
    rules.push({
      action,
      subject: collection.key,
      ...fieldsOf(collection.writableFields),
    })
  }
  if (actions.has('delete')) {
    rules.push({ action: 'delete', subject: collection.key })
  }
  return rules
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
