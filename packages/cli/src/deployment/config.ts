/**
 * The configuration of a deployment: the settings it needs, in one file, kept out of git.
 *
 * There is no configuration file in a checkout — a deployment's settings are its own — so the
 * first run asks for what it does not know and writes the answers down. The file holds
 * secrets: the password the local stack's Dex asks the break-glass administrator for. It is
 * written
 * for its owner alone, and it is ignored by git, so it is never committed.
 */
import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { CONFIG_FILE, findConfig } from '../config.ts'
import { Cancelled, type Choice } from '../terminal.ts'
import { type DeployRuntime, ROOT, saved } from './runtime.ts'

/**
 * The examples a checkout carries: the folders under examples/ whose `platform.json` says
 * they apply something to a database.
 */
export function examplesIn(root: string): string[] {
  const directory = join(root, 'examples')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(directory, entry.name, CONFIG_FILE)) &&
        findConfig(join(directory, entry.name))?.apply !== undefined
    )
    .map((entry) => entry.name)
    .sort()
}

/** One setting of a deployment: what it is called, what it says, and what it must look like. */
type Setting = {
  /** The name it has in the file and in the environment. */
  name: string
  /** What the setting is, in words: what the file says about it. */
  note: string
  /** What the operator is asked: the setting in a few words. The note, when there is none. */
  question?: string
  /** The value used when there is no answer. Without it the setting is required. */
  fallback?: string | ((answers: Record<string, string>) => string)
  /**
   * Whether the setting is asked for at all: the question holds when this says so. A
   * setting that is not asked for and is not known keeps no value, which is not the same
   * as a missing one: nothing is written for it and nothing is asked.
   */
  when?: (answers: Record<string, string>) => boolean
  /** A secret: never printed, and generated when there is no answer. */
  secret?: boolean
  /** How the value is checked. A problem is reported and nothing is written. */
  check?: (value: string) => string | undefined
  /**
   * The answers there are, when there are only a few: the operator picks one of them
   * instead of typing it.
   */
  choices?: () => Choice[]
  /**
   * The value that follows from the others: the issuer of a deployment is the identity
   * provider on its own sub-domain, the relay answers on the sub-domain of the API,
   * PostgreSQL on the sub-domain of the database. Nothing is asked about a setting that
   * follows from another.
   *
   * A value that follows is computed, not kept: it is never written to the file, and the
   * file's value for it is ignored, because the file holds the pieces it is made of. The
   * environment and the command line may still override it.
   */
  follows?: (answers: Record<string, string>) => string | undefined
}

/** A URL: what the site, the issuer and the relay are named by. */
function aUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol ? undefined : 'must be a URL'
  } catch {
    return 'must be a URL'
  }
}

/** An HTTPS URL: what a Kubernetes deployment is named by. */
function anHttpsUrl(value: string): string | undefined {
  const problem = aUrl(value)
  if (problem) return problem
  return new URL(value).protocol === 'https:' ? undefined : 'must be an HTTPS URL'
}

/** A port: what a service is published on. */
function aPort(value: string): string | undefined {
  if (!/^\d+$/.test(value)) return 'must be a port between 1 and 65535'
  const port = Number(value)
  return port >= 1 && port <= 65535 ? undefined : 'must be a port between 1 and 65535'
}

/**
 * A person, as the issuer names them: an address. It is their role's name in PostgreSQL
 * too, so it is no longer than a name there may be, and has nothing in it that the
 * server's authentication rules could not carry.
 */
function anAddress(value: string): string | undefined {
  if (!/^[^\s"'\\,@]+@[^\s"'\\,@]+$/.test(value))
    return 'must be an address, such as admin@localhost'
  return value.length <= 63
    ? undefined
    : 'must be 63 characters or fewer: it names a PostgreSQL role'
}

/** A domain name: the domain a deployment is named by. */
function aDomain(value: string): string | undefined {
  if (!value || value.length > 253) return 'must be a domain name'
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/i.test(value)
    ? undefined
    : 'must be a domain name'
}

/** A sub-domain: the name one service answers on. */
function aSubDomain(value: string): string | undefined {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/i.test(value) ? undefined : 'must be a sub-domain name'
}

/** The name a service answers on: its sub-domain on the deployment's domain. */
function serviceName(answers: Record<string, string>, sub: string): string | undefined {
  const host = answers[sub]
  const domain = answers.PLATFORM_DOMAIN
  return host && domain ? `${host}.${domain}` : undefined
}

/** The settings of the local stack. */
function localSettings(): Setting[] {
  return [
    {
      name: 'PLATFORM_DOMAIN',
      note: 'The domain this deployment is named by: the services answer on it',
      question: 'Domain of the deployment',
      // `localhost` names the local machine: every browser and resolver answers for it.
      fallback: 'localhost',
      check: aDomain,
    },
    {
      name: 'PLATFORM_IDP_HOST',
      note: 'The sub-domain Dex, the issuer, answers on',
      question: 'Sub-domain for Dex, the issuer',
      fallback: 'idp',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_API_HOST',
      note: 'The sub-domain the relay, the API, answers on',
      question: 'Sub-domain for the relay, the API',
      fallback: 'api',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_DB_HOST',
      note: 'The sub-domain PostgreSQL answers on',
      question: 'Sub-domain for PostgreSQL',
      fallback: 'db',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_PUBLIC_URL',
      note: 'The address of the site: if one already exists, give its full URL; leave it empty and an example will be deployed',
      question: 'URL of your site (empty to deploy an example)',
      // Asked once: a deployment that has chosen where its example goes has answered it.
      when: (answers) => !answers.PLATFORM_APP_HOST && !answers.PLATFORM_EXAMPLE,
      // An empty answer means an example is deployed, and its address is worked out below.
      fallback: () => '',
      check: aUrl,
    },
    {
      name: 'PLATFORM_EXAMPLE_URL',
      note: 'The address an example is deployed on',
      // Only when an example is deployed: a site of the operator's own needs no address.
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
      // The example's address is made of the domain and the sub-domain it is deployed on.
      follows: (answers) => {
        const app = answers.PLATFORM_APP_HOST
        const domain = answers.PLATFORM_DOMAIN
        if (!app || !domain) return undefined
        // An example is served by the stack itself, behind the edge. Without one the site
        // is the development server's, on the port it serves on.
        return answers.PLATFORM_EXAMPLE
          ? `http://${app}.${domain}:${answers.EDGE_PORT ?? '8080'}`
          : `http://${app}.${domain}:5173`
      },
    },
    {
      name: 'PLATFORM_EXAMPLE',
      note: `Which example should be deployed: ${examplesIn(ROOT).join(', ') || 'none'}`,
      question: 'Example to deploy',
      // Only asked when there is no site of the operator's own.
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
      // Empty means the platform's own interface, which is no example at all.
      fallback: () => '',
      check: (value) => {
        if (!value) return undefined
        const examples = examplesIn(ROOT)
        return examples.includes(value) ? undefined : `must be one of: ${examples.join(', ')}`
      },
      choices: exampleChoices,
    },
    {
      name: 'PLATFORM_APP_HOST',
      note: 'The sub-domain the example is deployed on',
      question: 'Sub-domain for the example',
      // Only asked when there is no site of the operator's own.
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
      fallback: 'app',
      check: aSubDomain,
    },
    {
      name: 'EDGE_PORT',
      note: 'The port the edge answers on, on this machine',
      question: 'Port for the edge, on this machine',
      // Not 80: a rootless container cannot bind a port below 1024, and which port the
      // operator's machine answers on is the operator's business.
      fallback: '8080',
      check: aPort,
    },
    {
      name: 'EDGE_TLS_PORT',
      note: 'The port the edge answers TLS on, when it is given a certificate',
      question: 'Port for the edge with TLS',
      fallback: '4433',
      check: aPort,
    },
    {
      name: 'PLATFORM_ISSUER',
      note: 'The issuer people sign in through: your Dex',
      // Dex answers on its own sub-domain, behind the edge: the issuer follows from the
      // domain and the port the edge answers on.
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_IDP_HOST')
        return name && answers.EDGE_PORT ? `http://${name}:${answers.EDGE_PORT}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'OIDC_ISSUER',
      note: 'The issuer the operator signs in through, the same Dex',
      follows: (answers) => answers.PLATFORM_ISSUER,
      check: aUrl,
    },
    {
      name: 'PLATFORM_RELAY_URL',
      note: 'The address the pages open their database sessions through',
      // The relay answers on its own sub-domain, behind the edge: its address follows from
      // the domain and the port the edge answers on.
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_API_HOST')
        return name && answers.EDGE_PORT ? `ws://${name}:${answers.EDGE_PORT}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'DATABASE_HOST',
      note: 'Where PostgreSQL is: its own sub-domain',
      follows: (answers) => serviceName(answers, 'PLATFORM_DB_HOST'),
    },
    {
      name: 'DATABASE_NAME',
      note: 'The database the platform is installed in',
      // The name the platform installs itself under: the same for every deployment.
      follows: () => 'platform',
    },

    {
      name: 'POSTGRES_PORT',
      note: 'The port PostgreSQL answers on',
      question: 'Port for PostgreSQL',
      fallback: '5432',
      check: aPort,
    },
    {
      name: 'DEX_PORT',
      note: 'The port Dex answers on, behind the edge',
      question: 'Port for Dex, behind the edge',
      fallback: '5556',
      check: aPort,
    },
    {
      name: 'RELAY_PORT',
      note: 'The port the relay answers on, behind the edge',
      question: 'Port for the relay, behind the edge',
      fallback: '8081',
      check: aPort,
    },
    {
      name: 'PLATFORM_ADMIN',
      note: 'The break-glass administrator: the address Dex knows them by, which is their role in PostgreSQL',
      question: 'Administrator, as an address',
      // The deployment's own, on its own domain: not an address on somebody else's.
      fallback: (answers) => `admin@${answers.PLATFORM_DOMAIN ?? 'localhost'}`,
      check: anAddress,
    },
    {
      name: 'PLATFORM_ADMIN_PASSWORD',
      note: 'The password Dex asks the break-glass administrator for',
      secret: true,
    },
  ]
}

/** The settings of a Kubernetes deployment. */
function kubernetesSettings(): Setting[] {
  return [
    {
      name: 'PLATFORM_DOMAIN',
      note: 'The domain this deployment is named by: the services answer on it',
      question: 'Domain of the deployment',
      // A deployment needs a name of its own: the ingress serves TLS under it.
      check: aDomain,
    },
    {
      name: 'PLATFORM_IDP_HOST',
      note: 'The sub-domain Dex, the issuer, answers on',
      question: 'Sub-domain for Dex, the issuer',
      fallback: 'idp',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_API_HOST',
      note: 'The sub-domain the relay, the API, answers on',
      question: 'Sub-domain for the relay, the API',
      fallback: 'api',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_DB_HOST',
      note: 'The sub-domain PostgreSQL answers on',
      question: 'Sub-domain for PostgreSQL',
      fallback: 'db',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_IMAGE',
      note: 'The relay image, in your registry',
      question: 'Relay image, in your registry',
    },
    {
      name: 'PUBLIC_URL',
      note: 'The address of the site: if one already exists, give its full URL; leave it empty and an example will be deployed',
      question: 'URL of your site (empty to deploy an example)',
      // Asked once: a deployment that has chosen where its example goes has answered it.
      when: (answers) => !answers.PLATFORM_APP_HOST && !answers.PLATFORM_EXAMPLE,
      // An empty answer means an example is deployed, and its address is worked out below.
      fallback: () => '',
      check: anHttpsUrl,
    },
    {
      name: 'PLATFORM_EXAMPLE_URL',
      note: 'The address an example is deployed on',
      // Only when an example is deployed: a site of the operator's own needs no address.
      when: (answers) => !answers.PUBLIC_URL,
      // The example's address is made of the domain and the sub-domain it is deployed on.
      follows: (answers) => {
        const app = answers.PLATFORM_APP_HOST
        const domain = answers.PLATFORM_DOMAIN
        return app && domain ? `https://${app}.${domain}` : undefined
      },
    },
    {
      name: 'PLATFORM_EXAMPLE',
      note: `Which example should be deployed: ${examplesIn(ROOT).join(', ') || 'none'}`,
      question: 'Example to deploy',
      // Only asked when there is no site of the operator's own.
      when: (answers) => !answers.PUBLIC_URL,
      // Empty means the platform's own interface, which is no example at all.
      fallback: () => '',
      check: (value) => {
        if (!value) return undefined
        const examples = examplesIn(ROOT)
        return examples.includes(value) ? undefined : `must be one of: ${examples.join(', ')}`
      },
      choices: exampleChoices,
    },
    {
      name: 'PLATFORM_APP_HOST',
      note: 'The sub-domain the example is deployed on',
      question: 'Sub-domain for the example',
      // Only asked when there is no site of the operator's own.
      when: (answers) => !answers.PUBLIC_URL,
      fallback: 'app',
      check: aSubDomain,
    },
    {
      name: 'OIDC_ISSUER',
      note: 'The issuer people sign in through: your Dex',
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_IDP_HOST')
        return name ? `https://${name}` : undefined
      },
      check: anHttpsUrl,
    },
    {
      name: 'PLATFORM_RELAY_URL',
      note: 'The address the pages open their database sessions through',
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_API_HOST')
        return name ? `wss://${name}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'DATABASE_HOST',
      note: 'Where PostgreSQL is: its own sub-domain',
      follows: (answers) => serviceName(answers, 'PLATFORM_DB_HOST'),
    },
    {
      name: 'DATABASE_NAME',
      note: 'The database the platform is installed in',
      // The name the platform installs itself under: the same for every deployment.
      follows: () => 'platform',
    },

    {
      name: 'DATABASE_PORT',
      note: 'The port PostgreSQL listens on',
      question: 'Port PostgreSQL listens on',
      fallback: '5432',
      check: aPort,
    },
  ]
}

/**
 * The values that follow from the pieces: they are worked out here, once, and used both
 * when the configuration is written and when a command runs without writing one.
 */
function computed(settings: Setting[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const setting of settings.filter((s) => s.follows)) {
    const value = answers[setting.name] ?? setting.follows!(answers)
    if (value === undefined) continue
    answers[setting.name] = value
    out[setting.name] = value
  }
  return out
}

/**
 * The addresses a deployment is named by, worked out from the pieces it is made of. The
 * configuration holds the pieces; the addresses are made of them at runtime, and the
 * environment may override any of them.
 */
export function computedValues(target: 'local' | 'k8s', r: DeployRuntime): Record<string, string> {
  const settings = target === 'local' ? localSettings() : kubernetesSettings()
  const answers: Record<string, string> = {}
  for (const setting of settings) {
    // Bun loads the file into the environment: the same value in both is the file's own.
    const fromFile = saved(r.envFile, setting.name)
    const fromEnv = r.env[setting.name]
    // A computed value is never read from the file: it is made of the pieces it holds.
    if (fromEnv && fromEnv !== fromFile) answers[setting.name] = fromEnv
    else if (!setting.follows && fromFile) answers[setting.name] = fromFile
  }
  return computed(settings, answers)
}

/**
 * What a name is worth in this deployment: the environment's, unless it is only the file's
 * own value again — Bun loads the file into the environment, and the two are one value.
 */
export function settingValue(r: DeployRuntime, name: string): string | undefined {
  const fromFile = saved(r.envFile, name)
  const fromEnv = r.env[name]
  if (fromEnv && fromEnv !== fromFile) return fromEnv
  return fromFile
}

/** The examples a deployment may carry, and the platform's own interface, which is none of them. */
function exampleChoices(): Choice[] {
  return [
    ...examplesIn(ROOT).map((name) => ({ value: name, label: name, hint: `examples/${name}` })),
    { value: '', label: 'None', hint: "the platform's own interface" },
  ]
}

/** A secret nobody chose: generated once, and never printed. */
function aSecret(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Checks a value as soon as it is known. A file with a wrong value in it is worse than no
 * file, because the next run would read it and trust it: so nothing is written when a value
 * is wrong, and the error names the setting that is.
 */
function checked(setting: Setting, value: string) {
  const found = problem(setting, value)
  if (found) throw new Error(found)
}
/** What is wrong with a value, in the words the operator is told: nothing when it is right. */
function problem(setting: Setting, value: string): string | undefined {
  const found = setting.check?.(value)
  return found ? `${setting.name} ${found}` : undefined
}

/** A value, written the way a dotenv file is read: quoted when it would not survive bare. */
function written(value: string): string {
  if (/^[\w./:@+-]+$/.test(value)) return value
  // One kind of quote is enough for a value to survive being read back as it is.
  if (!/['"\n\r]/.test(value)) return `'${value}'`
  if (!/["\n\r]/.test(value)) return `"${value}"`
  throw new Error('A value with both kinds of quote cannot be written to the configuration')
}

/** Whether git ignores a file: what git says, and what the ignore file says when git cannot. */
function ignoredByGit(file: string): boolean | null {
  const git = Bun.which('git')
  if (git) {
    const checked = Bun.spawnSync([
      git,
      '-C',
      dirname(file),
      'check-ignore',
      '-q',
      '--',
      basename(file),
    ])
    if (checked.exitCode === 0) return true
    if (checked.exitCode === 1) return false
  }
  // Git could not answer: the ignore file beside the file is what is read instead.
  const ignoreFile = join(dirname(file), '.gitignore')
  if (!existsSync(ignoreFile)) return false
  const patterns = readFileSync(ignoreFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const name = basename(file)
  return patterns.some(
    (pattern) => pattern === name || pattern === `/${name}` || pattern === '*' || pattern === '/.*'
  )
}

/** Keeps a file that holds secrets out of git, and says that it did. */
function ignoreInGit(file: string, r: DeployRuntime): boolean {
  if (ignoredByGit(file) !== false) return true
  const ignoreFile = join(dirname(file), '.gitignore')
  const text = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : ''
  const addition = `${text && !text.endsWith('\n') ? '\n' : ''}${basename(file)}\n`
  appendFileSync(ignoreFile, addition)
  r.note(`Configuration: added ${basename(file)} to ${basename(ignoreFile)}: it holds secrets.`)
  return true
}

/**
 * The values a file may hold that are computed now. They are made of the pieces the file
 * holds, so they are taken out of it: the pieces stay, and the values come back from them.
 *
 * Only the entries that are the tool's own old output are removed: a value the operator set
 * by hand is left alone.
 */
function removeComputed(
  file: string,
  names: string[],
  isOurs: (name: string, value: string) => boolean
): string[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const removed: string[] = []
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (
      match &&
      names.includes(match[1]!) &&
      isOurs(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ''))
    ) {
      removed.push(match[1]!)
      // The comment above the entry belongs to it, and so does the blank line below it.
      if (kept.length && kept[kept.length - 1]!.startsWith('#')) kept.pop()
      if (lines[i + 1] === '') i++
      continue
    }
    kept.push(line)
  }
  if (!removed.length) return []
  writeFileSync(file, kept.join('\n'), { mode: 0o600 })
  chmodSync(file, 0o600)
  return removed
}

/**
 * The configuration of a deployment, written when it is missing something.
 *
 * A checkout has no configuration file: a deployment's settings are its own. The first run
 * asks for what it does not know — the ones already given on the command line, in the
 * environment or in the saved file are kept — and writes the answers down with the secrets
 * it generated. A file that is already there is not rewritten: the settings it lacks are
 * added to it, and the entries it holds are left alone.
 *
 * Nothing is written when a value is wrong, or when a setting that has no default could not
 * be answered: the deployment then fails with the error that names what is missing.
 */
export async function ensureConfig(
  target: 'local' | 'k8s',
  given: Record<string, string | undefined>,
  r: DeployRuntime
): Promise<void> {
  const settings = target === 'local' ? localSettings() : kubernetesSettings()
  const name = basename(r.envFile)
  /**
   * What is already known: the command line, the environment, the saved file.
   *
   * Bun loads the file into the environment, so the same value in both is the file's own
   * and not an override: the environment only speaks when it says something else.
   *
   * A value that is computed is never read from the file: it is made of the pieces the file
   * holds, and the pieces are what may be changed.
   */
  const known = (setting: Setting): string | undefined => {
    const fromFile = saved(r.envFile, setting.name)
    const fromEnv = given[setting.name] ?? r.env[setting.name]
    if (fromEnv && fromEnv !== fromFile) return fromEnv
    if (setting.follows) return undefined
    return fromFile
  }
  const answers: Record<string, string> = {}
  const missing: string[] = []
  // Why the questions are asked is said before the first of them, and only if there is one.
  let asking = false
  const question = (setting: Setting) => {
    if (!asking)
      r.begin(
        existsSync(r.envFile)
          ? `Configuration: ${name} lacks some of the settings of this deployment`
          : `Configuration: no ${name} was found, so one is written from your answers`
      )
    asking = true
    return setting.question ?? setting.note
  }
  try {
    // The values the tool computes now are taken out of the file first: they are made of
    // the pieces it holds, and the pieces are what may be changed. What the file holds is
    // read before they are taken out, so that the example's address is known.
    const pieces: Record<string, string> = {}
    for (const setting of settings) {
      if (setting.follows) continue
      const value =
        saved(r.envFile, setting.name) ??
        (typeof setting.fallback === 'string' ? setting.fallback : undefined)
      if (value) pieces[setting.name] = value
    }
    const computedNames = settings.filter((s) => s.follows).map((s) => s.name)
    const exampleUrl = computed(settings, pieces).PLATFORM_EXAMPLE_URL
    const removed = removeComputed(
      r.envFile,
      [...computedNames, 'PLATFORM_PUBLIC_URL', 'PUBLIC_URL'],
      (name, value) =>
        computedNames.includes(name) || (exampleUrl !== undefined && value === exampleUrl)
    )
    if (removed.length) {
      // The environment holds the file's own values, and they are not there any more.
      for (const name of removed) delete r.env[name]
      r.note(
        `Configuration: took ${removed.join(', ')} out of ${name}: ${removed.length === 1 ? 'it is' : 'they are'} computed from the domain and the names now.`
      )
    }
    // What is already known is kept: the values that follow are worked out from it.
    for (const setting of settings) {
      const value = known(setting)
      if (value) answers[setting.name] = value
    }
    // The settings that are asked for first: what the operator decides.
    for (const setting of settings.filter((s) => !s.follows)) {
      const already = answers[setting.name]
      if (already) {
        checked(setting, already)
        continue
      }
      // A setting that does not apply to this deployment is not asked for: it keeps no
      // value, and nothing is written for it.
      if (setting.when && !setting.when(answers)) continue
      if (setting.secret) {
        // Nobody is asked for a password: one is generated, and it is saved where it can be
        // read by the person who needs it.
        answers[setting.name] = aSecret()
        r.note(`Generated ${setting.name}.`)
        continue
      }
      // A fallback may be worked out from what has been answered already: the domain is
      // asked for first, and the site's address follows from it.
      const fallback =
        typeof setting.fallback === 'function' ? setting.fallback(answers) : setting.fallback
      if (fallback === undefined) {
        // No default at all: the answer is required.
        if (!r.interactive) {
          missing.push(setting.name)
          continue
        }
        // An answer the check refuses is asked for again; none at all is asked for again too.
        const answer = await r.ask(setting.name, question(setting), '', (value) =>
          value ? problem(setting, value) : `${setting.name} is required: it has no default`
        )
        if (!answer) {
          missing.push(setting.name)
          continue
        }
        answers[setting.name] = answer
        checked(setting, answer)
        continue
      }
      if (fallback === '') {
        // An empty default is a question whose answer may be empty: what is not answered
        // is worked out from the other settings afterwards.
        if (!r.interactive) answers[setting.name] = ''
        else if (setting.choices)
          answers[setting.name] = await r.choose(
            setting.name,
            question(setting),
            setting.choices(),
            ''
          )
        else
          answers[setting.name] = await r.ask(setting.name, question(setting), '', (value) =>
            value ? problem(setting, value) : undefined
          )
        continue
      }
      answers[setting.name] = r.interactive
        ? await r.ask(setting.name, question(setting), fallback, (value) => problem(setting, value))
        : fallback
      checked(setting, answers[setting.name]!)
    }
    // The settings that follow from the ones above: they are worked out, never asked for,
    // and never written down: the file holds the pieces they are made of.
    for (const setting of settings.filter((s) => s.follows)) {
      // A setting that does not apply to this deployment is not missing either.
      if (setting.when && !setting.when(answers)) continue
      const followed = answers[setting.name] ?? setting.follows!(answers)
      if (followed === undefined) {
        missing.push(setting.name)
        continue
      }
      // The value is kept as it is worked out, so that the ones that follow from it can.
      answers[setting.name] = followed
      checked(setting, followed)
    }
    computed(settings, answers)
    if (missing.length) {
      r.note(
        `Configuration: ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not given, so no ${name} was written. Give ${missing.length === 1 ? 'it' : 'them'} on the command line.`
      )
      return
    }
    // What the deployment now knows that the file does not: the settings that are added.
    // A computed value is not one of them: it is not kept.
    const added = settings.filter(
      (setting) => !setting.follows && answers[setting.name] && !saved(r.envFile, setting.name)
    )
    if (!added.length) return
    if (asking) {
      // What was answered is shown with what follows from it, before any of it is kept: a
      // wrong domain is seen here, and not in a file the next run would trust.
      const follows = settings.filter((setting) => setting.follows && answers[setting.name])
      const width = Math.max(...[...added, ...follows].map((setting) => setting.name.length))
      const line = (setting: Setting) =>
        `${setting.name.padEnd(width)}  ${setting.secret ? '(generated)' : answers[setting.name]}`
      r.show(
        `What is added to ${name}`,
        [
          ...added.map(line),
          ...(follows.length ? ['', 'What follows from it, and is not kept:'] : []),
          ...follows.map(line),
        ].join('\n')
      )
      if (!(await r.confirm('write', `Write ${r.envFile}?`, true))) {
        r.note('Configuration: nothing was written.', 'warn')
        throw new Cancelled()
      }
    } else
      r.note(
        existsSync(r.envFile)
          ? `Configuration: ${name} is missing ${added.length} of the settings of this deployment; they are added now.`
          : `Configuration: no ${name} was found, so one is written. It holds secrets: only you read it.`
      )
    ignoreInGit(r.envFile, r)
    // The file is completed, not rewritten: what it holds is left alone, and what the
    // deployment knows besides it is added.
    const fresh = !existsSync(r.envFile)
    const existing = fresh ? '' : readFileSync(r.envFile, 'utf8')
    const lines: string[] = []
    if (fresh)
      lines.push(
        '# The settings of this deployment, written by `bun run cli deploy`.',
        '# It holds secrets: the password Dex asks the break-glass administrator for. It is',
        '# kept out of git and readable only by you.',
        ''
      )
    for (const setting of added) {
      const value = answers[setting.name]
      if (value === undefined) continue
      lines.push(`# ${setting.note}.`)
      lines.push(`${setting.name}=${written(value)}`)
      lines.push('')
    }
    try {
      appendFileSync(
        r.envFile,
        `${existing && !existing.endsWith('\n') ? '\n' : ''}${lines.join('\n')}`,
        { mode: 0o600 }
      )
      chmodSync(r.envFile, 0o600)
    } catch (error) {
      throw new Error(
        `The configuration could not be written to ${r.envFile}: ${(error as Error).message}`
      )
    }
    for (const [key, value] of Object.entries(answers)) r.env[key] = value
    r.note(`Configuration: wrote ${r.envFile}, for you alone.`, 'success')
  } finally {
    r.done()
  }
}
