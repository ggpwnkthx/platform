/**
 * The wizard of a deployment.
 *
 * The deployment of the platform is written in OpenTofu, and the values
 * of a deployment name one deployment: the region it runs in, the
 * names it answers under, the images it runs and the identifiers of the
 * tenant and of the workspace it holds. The wizard collects them, it
 * writes them in the file of the values, and it tells the operator what
 * to do next.
 *
 * The wizard is provider-agnostic: a provider knows how to sign the
 * operator in, what to read from its own system, and which questions to
 * ask. The wizard asks the questions, writes the file, and nothing
 * else: the tool applies the values, and the wizard decides nothing
 * about the deployment itself.
 */

/** What the wizard does with a question. */
export type QuestionKind =
  /** The wizard asks, and the operator has to answer: the value names the deployment. */
  | 'required'
  /** The wizard asks, and the example holds a value the operator may take. */
  | 'chosen'
  /** The wizard does not ask: the value of the example is the value. */
  | 'given'

/**
 * The environments of the platform.
 *
 * The templates of the deployment name one of them, and the name of
 * the environment is in the name of every resource of the deployment:
 * an environment that is not one of them is a deployment the templates
 * refuse, and the refusal comes after the minutes of the deployment,
 * when the state of the deployment is already written.
 */
export const ENVIRONMENTS: readonly string[] = ['development', 'staging', 'production']

/**
 * The images of the platform that a release holds.
 *
 * The digests of these four images are the digests of a build that was
 * proved, and the templates of the deployment are the ones of the same
 * release.
 */
export const PLATFORM_IMAGES: readonly string[] = [
  'gateway_image',
  'access_image',
  'data_image',
  'console_image',
]

/** A question of the wizard. */
export interface Question {
  /** The name of the value. */
  readonly name: string
  /** What the question is, in one line. */
  readonly summary: string
  /** What the wizard does with the question. */
  readonly kind: QuestionKind
  /** The shape the answer has to have, when it is not free text. */
  readonly shape?: 'uuid' | 'digest'
  /**
   * The values the answer is one of, when the answer is a selection.
   *
   * A question that has a choice is asked with the choices: the
   * operator picks one of them, and an answer that is not one of them
   * is not an answer at all. The deployment refuses a value that is
   * not one of them, and the refusal comes after the minutes of the
   * deployment: the wizard asks the question with the choices, and
   * the answer is one of them before the deployment starts.
   */
  readonly choices?: readonly string[]
}

/**
 * Asks the operator a question and waits for the answer.
 *
 * The questions that have a choice come with the choices: the operator
 * picks one of them, and the answer of a question without a choice is
 * what the operator typed.
 */
export type Asker = (question: string, choices?: readonly string[]) => Promise<string>

/** What the provider read from its own system. */
export interface SignIn {
  /** The values the provider knows and the wizard writes. */
  readonly facts: Readonly<Record<string, string>>
  /** What the reader is told about the sign in. */
  readonly message: string
  /** The account the operator signed in as. */
  readonly account?: string
}

/**
 * A resource of the cloud that the state of the deployment does not
 * hold, and that the state can take over.
 *
 * The tool refuses to create a resource that is already there, and it
 * names the resource and its identifier: the state of the deployment
 * has to learn about it, or the next apply refuses to create it again.
 */
export interface Importable {
  /** The address of the resource in the state of the deployment. */
  readonly address: string
  /**
   * The identifiers of the resource in the cloud, in the order they are
   * to be tried.
   *
   * The tool refuses an import that names the resource in a way it
   * does not know, and the next identifier is tried.
   */
  readonly ids: readonly string[]
}

/**
 * The answers the wizard finds by itself.
 *
 * Some answers of a deployment are not the operator's to type: the
 * digests of the images are the ones of the release of the platform,
 * the address that reaches the state is the one of the machine, and
 * the values of a deployment that is already there are the ones the
 * operator gave before. The wizard reads them, and the operator
 * confirms them or changes them.
 */
export interface Found {
  /** The answers that were found, by the name of the value. */
  readonly values: Readonly<Values>
  /** The tag of the release the digests of the images come from, when it was read. */
  readonly release?: string
  /**
   * The accounts of the provider the operator may deploy in, when the
   * provider names them. A machine that holds no session names none.
   */
  readonly accounts?: readonly Account[]
  /** What the operator is told about what was read, and about what could not be. */
  readonly notes: readonly string[]
}

/**
 * What a deployment answers about itself to the operator who wrote it.
 *
 * The deployment creates the credential of the administration of
 * Access, and the state of the deployment holds it: the operator who
 * reads the state reads the credential, and does not copy it into a
 * shell first. The credential is held in the memory of the program
 * that read it, and it is never written and never drawn.
 */
export interface Held {
  /** The credential of the administration of Access. */
  readonly adminToken?: string
  /** The address of Access, as the templates answered it. */
  readonly accessUrl?: string
  /** Why the credential could not be read, when it could not. */
  readonly note?: string
}

/**
 * An account of a provider that a deployment is written in: a
 * subscription of Azure.
 */
export interface Account {
  /** The identifier of the account. */
  readonly id: string
  /** The name of the account, as the operator reads it. */
  readonly name: string
  /** True when the account is the one the session of the operator works in. */
  readonly current: boolean
}

/** The name of the value that names the account of a deployment. */
export const ACCOUNT = 'subscription_id'

/** A provider of the infrastructure of a deployment. */
export interface DeploymentProvider {
  /** The name of the provider. */
  readonly name: string
  /** What the provider is, in one line. */
  readonly summary: string
  /** The questions of the deployment, by the name of the value. */
  readonly questions: readonly Question[]
  /**
   * Signs the operator in and reads the facts of the deployment.
   *
   * An operator who holds several accounts is asked which one the
   * deployment is written in, unless the answers of the operator name
   * it already: a deployment that nobody watches — the one the
   * interface runs — is asked nothing.
   *
   * @param ask asks the operator a question and waits for the answer.
   * @param answers the answers the operator gave before the sign in.
   */
  signIn(ask: Asker, answers?: Readonly<Values>): Promise<SignIn>
  /**
   * The accounts the operator may deploy in, as the session of the
   * machine holds them. Nobody is signed in: a machine that holds no
   * session holds no account.
   */
  accounts?(): Promise<readonly Account[]>
  /**
   * The facts of the deployment, as the machine of the operator holds
   * them.
   *
   * A dry run signs nobody in: it reads the facts the machine already
   * holds, and it asks what it cannot read. A provider that holds no
   * facts without a session holds none.
   */
  facts?(): Promise<Readonly<Record<string, string>>>
  /**
   * The resources of the cloud that a failed apply left behind, and
   * that the state of the deployment can take over.
   *
   * A resource that is already in the cloud and not in the state is
   * refused by the next apply, and the state has to learn about it:
   * the tool names the resource and its identifier, and the CLI writes
   * them in the state.
   *
   * @param reason what the tool said about the failure.
   */
  importablesOf?(reason: string): readonly Importable[]
  /**
   * The resource of the system that a failed apply left behind, when
   * the reason of the failure names it.
   *
   * A resource of the system that is already there is not in the state
   * of the deployment, and the next apply refuses to create it again.
   * The resource is alive, and the state has to learn about it.
   *
   * @param reason what the tool said about the failure.
   * @param region the region the deployment runs in, which is where the
   * resource of a failed apply was made.
   */
  leftoverOf?(reason: string, region?: string): Promise<Leftover | undefined>
  /**
   * Frees the name of a resource that was deleted and not purged.
   *
   * A resource that was deleted and not purged keeps the name it had,
   * and the name cannot be used again: the resource has to be purged,
   * and what is left of it is lost.
   *
   * @param leftover the resource that holds the name.
   */
  release?(leftover: Leftover): Promise<void>
  /**
   * Checks what the system of the provider needs before the plan of
   * the deployment is applied.
   *
   * Some systems of the provider need something the templates of the
   * deployment cannot write: the delegation of a zone of DNS is one of
   * those things, and the operator writes it at the registrar of the
   * domain. The check is made before the plan is applied, and a
   * refusal is a refusal of the deployment: the apply that follows
   * would fail in the cloud with a reason that names the symptom and
   * not the cause.
   *
   * @param context what the deployment is about to apply.
   */
  beforeApply?(context: BeforeApply): Promise<readonly string[]>
  /**
   * Binds what the system of the provider needs after the apply.
   *
   * Some systems of the provider hold a binding that the templates of
   * the deployment cannot write: the provider of the infrastructure
   * writes the resources of the deployment, and the binding is not one
   * of them. The provider of the deployment writes it here, with the
   * client of the system, and says what it did.
   *
   * The step is not a failure of the deployment when it does not go
   * through: the deployment is applied, and the binding is read again
   * the next time the deployment goes on.
   *
   * @param context what the deployment applied: its values and what the
   * templates answered.
   */
  afterApply?(context: AfterApply): Promise<readonly string[]>
}

/**
 * What a deployment is about to apply, as the provider of the
 * deployment reads it.
 *
 * The values of the deployment are the answers of the operator, and
 * the answers of the templates are the facts the deployment applied
 * before: the zone of the names of the deployment is a zone of Azure
 * that the templates created, and the name servers it is served by are
 * among the answers of the templates.
 */
export interface BeforeApply {
  /** The values of the deployment. */
  readonly values: Readonly<Record<string, string>>
  /**
   * What the templates answered.
   *
   * The answers of the templates are the names of the resources of the
   * deployment: a name that is written in the templates and in the
   * code of the provider is a name that drifts, and the provider reads
   * the names of the deployment where they are written.
   */
  readonly outputs: Readonly<Record<string, unknown>>
  /**
   * Tells the operator what the deployment is doing.
   *
   * @param text the line of the progress.
   */
  readonly tell?: (text: string) => void
}

/**
 * What a deployment applied, as the provider of the deployment reads
 * it.
 */
export interface AfterApply {
  /** The values of the deployment. */
  readonly values: Readonly<Record<string, string>>
  /**
   * What the templates answered.
   *
   * The answers are the names of the resources of the deployment: a
   * name that is written in the templates and in the code of the
   * provider is a name that drifts, and the provider reads the names
   * of the deployment where they are written.
   */
  readonly outputs: Readonly<Record<string, unknown>>
  /**
   * The file of the values of the deployment.
   *
   * A deployment learns some of its answers after the apply: the
   * identifier of a tenant that the system of the provider created is
   * one of them, and the values of the deployment name it. The
   * provider writes it in the file of the values, and the deployment
   * goes on with it.
   */
  readonly file?: string
  /**
   * Tells the operator what the deployment is doing.
   *
   * A deployment that is applied goes on: it binds the certificates
   * of the public names, it starts the job of the migration, and it
   * waits for Access to come up. The wait is a wait of minutes, and
   * a reader who is told nothing thinks that the deployment is hung.
   * The provider says what it does as it does it, and the words go
   * beside the answer of the command.
   *
   * @param text the line of the progress.
   */
  readonly tell?: (text: string) => void
}

/** A resource of the system that a failed apply left behind. */
export interface Leftover {
  /** The name of the resource. */
  readonly name: string
  /**
   * The identifiers of the resources of the system that carry the name,
   * in the order they are to be tried.
   */
  readonly ids: readonly string[]
  /** Where the name is held, when the deployment cannot take the resource over. */
  readonly place?: string
  /**
   * The region the resource was in, when the resource was deleted and
   * its name has to be freed.
   */
  readonly location?: string
  /**
   * What the provider looked for, and did not find, when the resource
   * is nowhere the provider can see.
   */
  readonly searched?: string
  /**
   * The values that free the name, when the resource cannot be taken
   * over and the name of the resource of the deployment can change.
   */
  readonly values?: Readonly<Values>
}

/** The values the wizard writes, in the order of the questions. */
export type Values = Record<string, string>

/**
 * The values the example of a deployment holds.
 *
 * The example is the reference of the values: it names every variable
 * of the templates and the value it takes when the operator names
 * none. The wizard reads the defaults from it, so that a default that
 * changes in the templates changes in the wizard with it.
 *
 * A value that spans several lines is a map or a list, and the wizard
 * does not write them: the operator changes them in the file itself.
 *
 * @param example the example of the values of the templates.
 */
export function defaultsOf(example: string): Values {
  const values: Values = {}
  let depth = 0
  for (const line of example.split('\n')) {
    const trimmed = line.trim()
    if (depth === 0) {
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const name = trimmed.slice(0, separator).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
      const value = trimmed.slice(separator + 1).trim()
      if (value.startsWith('{') || value.startsWith('[')) {
        depth += 1
        continue
      }
      values[name] = value.replace(/^"(.*)"$/, '$1')
      continue
    }
    depth += trimmed.startsWith('}') || trimmed.startsWith(']') ? -1 : 0
    if (depth < 0) depth = 0
  }
  return values
}

/**
 * The questions the wizard asks the operator.
 *
 * A question the provider answered is not asked again: the provider
 * read the fact from its own system, and the operator does not type it
 * a second time.
 *
 * @param provider the provider of the deployment.
 * @param facts the facts the provider read.
 */
export function questionsOf(
  provider: DeploymentProvider,
  facts: Readonly<Record<string, string>>
): Question[] {
  return provider.questions.filter((question) => {
    if (question.kind === 'given') return false
    if (facts[question.name] !== undefined) return false
    return true
  })
}

/**
 * The value a question takes.
 *
 * A question the provider answered takes the fact, and a question the
 * operator may choose takes what the operator typed, or the value of
 * the example when the operator named none.
 *
 * @param question the question.
 * @param facts the facts the provider read.
 * @param defaults the values of the example of the templates.
 * @param answer what the operator typed.
 */
export function answerOf(
  question: Question,
  facts: Readonly<Record<string, string>>,
  defaults: Readonly<Values>,
  answer?: string
): string {
  const fact = facts[question.name]
  if (fact !== undefined) return fact
  const typed = answer?.trim()
  if (typed !== undefined && typed !== '') return typed
  return defaults[question.name] ?? ''
}

/**
 * The file of the values of the deployment, as the wizard writes it.
 *
 * The file holds the values the wizard collected and nothing else: a
 * value the operator did not choose keeps the default of the
 * templates, and the example of the templates holds the whole set.
 *
 * @param provider the provider of the deployment.
 * @param values the values the wizard collected.
 */
export function valuesFile(provider: DeploymentProvider, values: Readonly<Values>): string {
  const lines: string[] = [
    '# The values of the deployment.',
    '#',
    '# The wizard wrote this file. Every value below was chosen by the',
    '# operator or read by the provider; every value that is not below',
    '# keeps the default of the templates, and the whole set is in the',
    '# example of the templates.',
    `#`,
    `# The provider of the deployment: ${provider.summary}.`,
    '',
  ]
  for (const question of provider.questions) {
    const value = values[question.name]
    if (value === undefined) continue
    lines.push(`# ${question.summary}`)
    lines.push(`${question.name} = "${value.replace(/"/g, '\\"')}"`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/**
 * The problem of one answer, when the deployment cannot use it.
 *
 * An identifier that is not an identifier and a digest that is not a
 * digest are answers the deployment cannot use, and a deployment that
 * starts with one of them fails later and further away. The wizard asks
 * the question again when the answer is not one the deployment can use.
 *
 * @param question the question the answer answers.
 * @param value the answer of the operator.
 */
export function problemOf(question: Question, value: string): string | undefined {
  if (value === undefined || value === '') {
    if (question.kind === 'required') return `${question.summary} is needed`
    if (question.choices !== undefined) {
      return `${question.summary} is not one of ${question.choices.join(', ')}`
    }
    return undefined
  }
  if (question.shape === 'digest' && !/@sha256:[0-9a-f]{64}$/.test(value)) {
    return `${question.summary} is not a digest: the deployment runs the bytes that the release proved`
  }
  if (
    question.shape === 'uuid' &&
    !/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(value)
  ) {
    return `${question.summary} is not an identifier like 11111111-1111-4111-8111-111111111111`
  }
  if (question.choices !== undefined && !question.choices.includes(value)) {
    return `${question.summary} is not one of ${question.choices.join(', ')}`
  }
  return undefined
}

/**
 * The answers that are not the shape the deployment needs.
 *
 * @param questions the questions of the deployment.
 * @param values the values the wizard collected.
 */
export function problemsOf(questions: readonly Question[], values: Readonly<Values>): string[] {
  const problems: string[] = []
  for (const question of questions) {
    const problem = problemOf(question, values[question.name] ?? '')
    if (problem !== undefined) problems.push(problem)
  }
  return problems
}

/**
 * The questions the wizard cannot go on without.
 *
 * A question the operator did not answer and that has no default is a
 * question the wizard cannot answer for the operator, and the
 * deployment it would write is not the deployment the operator meant.
 *
 * @param questions the questions the wizard asks.
 * @param values the values the wizard collected.
 */
export function missingOf(questions: readonly Question[], values: Readonly<Values>): string[] {
  const missing: string[] = []
  for (const question of questions) {
    if (question.kind !== 'required') continue
    const value = values[question.name]
    if (value !== undefined && value !== '') continue
    missing.push(question.name)
  }
  return missing
}
