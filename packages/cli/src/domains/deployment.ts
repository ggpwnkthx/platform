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
   * @param ask asks the operator a question and waits for the answer.
   */
  signIn(ask: Asker): Promise<SignIn>
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
 * The answers that are not the shape the deployment needs.
 *
 * An identifier that is not an identifier and a digest that is not a
 * digest are answers the deployment cannot use, and a deployment that
 * starts with one of them fails later and further away.
 *
 * @param questions the questions of the deployment.
 * @param values the values the wizard collected.
 */
export function problemsOf(questions: readonly Question[], values: Readonly<Values>): string[] {
  const problems: string[] = []
  for (const question of questions) {
    const value = values[question.name]
    if (value === undefined || value === '') {
      if (question.kind === 'required') problems.push(`${question.name} is needed`)
      continue
    }
    if (question.shape === 'digest' && !/@sha256:[0-9a-f]{64}$/.test(value)) {
      problems.push(
        `${question.name} is not a digest: the deployment runs the bytes that the release proved`
      )
      continue
    }
    if (
      question.shape === 'uuid' &&
      !/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(value)
    ) {
      problems.push(`${question.name} is not an identifier`)
    }
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
