/**
 * The interface of the operator.
 *
 * The interface is a loop: it draws the state, it waits for a key, and
 * the key is an action on the state. The work the interface does — the
 * probes of a deployment, the tenants of Access, the creation of a
 * deployment — happens beside the loop and tells the state what it
 * found.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Services } from '../app/commands'
import type { Environment, ResolvedContext } from '../domains/context'
import { resolveContext } from '../domains/context'
import {
  ACCOUNT,
  defaultsOf,
  PLATFORM_IMAGES,
  problemOf,
  valuesFile,
  type Account,
  type DeploymentProvider,
  type Found,
  type Held,
  type Values,
} from '../domains/deployment'
import { CliFailure } from '../domains/failure'
import type { Key } from './keys'
import {
  EMPTY,
  fieldValue,
  reduce,
  suggestionOf,
  cursorOf,
  visibleRows,
  type Action,
  type Field,
  type Form,
  type Page,
  type Row,
  type State,
} from './model'
import type { Screen } from './screen'
import {
  accessCallOf,
  answersFor,
  detailsOf,
  listOf,
  peopleOf,
  valuesIn,
  type Person,
  grantOf,
  grantRows,
  principalOf,
  principalRows,
  probesOfDeployment,
  profileOfDeployment,
  profilesOf,
  recordOfRow,
  removeProfile,
  revokeOf,
  saveProfile,
  tenantOf,
  tenantRows,
  tenantsOf,
  grantsOf,
  principalsOf,
} from './tasks'
import { factsOf, viewOf } from './views'
import { fieldOf, grantFields, principalFields, profileFields, tenantFields } from './forms'

/** What the interface needs to run. */
export interface InterfaceOptions {
  /** The screen of the reader. */
  readonly screen: Screen
  /** The ports of the commands. */
  readonly services: Services
  /** The environment of the shell. */
  readonly environment: Environment
  /** The provider of a deployment, for the creation of one. */
  readonly provider?: DeploymentProvider
  /** The directory of the templates of a deployment. */
  readonly templates?: string
  /**
   * The answers of a deployment that the wizard finds by itself: the
   * digests of the images of the release, the address of the machine,
   * and the values of the deployment of an environment that is already
   * there. The form of a new deployment holds them, and the reader
   * confirms them or changes them.
   *
   * @param templates the directory of the templates of a deployment.
   * @param defaults the values of the example of the templates.
   * @param environment the environment the reader chose, when one is chosen.
   */
  readonly answers?: (
    templates: string,
    defaults: Readonly<Values>,
    environment?: string
  ) => Promise<Found>
  /**
   * What a deployment of this machine answers about itself: the
   * credential of its administration, which the deployment created and
   * the state of the deployment holds. The interface asks for it when
   * the shell holds no credential, it keeps it in its memory, and it
   * never writes it and never draws it.
   *
   * @param templates the directory of the templates of a deployment.
   * @param context the deployment the interface works on.
   */
  readonly held?: (templates: string, context: ResolvedContext) => Promise<Held>
}

/** The number of milliseconds between two refreshes of the page. */
const REFRESH = 5000

/** The number of the rows a list holds at most. */
const PAGE = 200

/**
 * The interface of the operator.
 */
export class Interface {
  /** The state the reader sees. */
  private state: State = EMPTY
  /** The screen of the reader. */
  private readonly screen: Screen
  /** The ports of the commands. */
  private readonly services: Services
  /** The environment of the shell. */
  private readonly environment: Environment
  /** The provider of a deployment. */
  private readonly provider?: DeploymentProvider
  /** The directory of the templates of a deployment. */
  private readonly templates: string
  /** The root of the checkout of the platform. */
  private readonly root: string
  /** What the interface is waiting for the reader to confirm. */
  private pending?: { readonly action: string; readonly id?: string; readonly form?: Form }
  /**
   * The values of the form the reader did not write: the ones the form
   * was opened with, and the ones the interface found since.
   */
  private pristine: Record<string, string> = {}
  /** The answers of a deployment that the wizard finds by itself. */
  private readonly answers?: InterfaceOptions['answers']
  /** The search for the answers of a deployment, while it lasts. */
  private finding?: Promise<void>
  /** The number of the searches the form of a deployment asked for. */
  private searches = 0
  /** The tag of the release the digests of the form come from. */
  private release?: string
  /**
   * Where the reader is in the deployment: the tenant whose principals
   * and grants the pages show, and the principal whose grants they
   * show. A reader who is nowhere reads the whole deployment.
   */
  private scope: { tenant?: string; principal?: Person } = {}
  /** The slugs of the tenants of the deployment. */
  private slugs: string[] = []
  /** The principals the interface has read, by their identifier. */
  private readonly people = new Map<string, Person>()
  /** What the grants the interface has read name, by the name of the value. */
  private readonly seen: Record<string, Set<string>> = {}
  /** Who gave the last grant of the reader. */
  private giver?: string
  /** What a deployment of this machine answers about itself. */
  private readonly held?: InterfaceOptions['held']
  /** The credentials the interface read, by the name of their deployment. */
  private readonly credentials = new Map<string, Held>()
  /** The deployments whose credential was asked for and not read. */
  private readonly refused = new Map<string, string>()
  /** What the templates of the deployment answered, as the log holds it. */
  private outputs: Record<string, string> = {}
  /** The profile of the deployment the interface just created. */
  private deployed?: string
  /** The accounts of the provider, by the name the form shows them under. */
  private accounts = new Map<string, string>()
  /** What the reader was told about the answers that were found. */
  private noted = new Set<string>()
  /** The number of the pages that are being read. */
  private reads = 0
  /** True when the last message is a page that could not be read. */
  private unread = false
  /** The answer of Access the page was drawn from. */
  private body?: unknown
  /** True while the interface is at work. */
  private working = false
  /** True while the interface runs. */
  private running = true
  /** The timer that refreshes the page. */
  private timer?: ReturnType<typeof setInterval>

  /**
   * The interface of the operator.
   *
   * @param options what the interface needs to run.
   */
  constructor(options: InterfaceOptions) {
    this.screen = options.screen
    this.services = options.services
    this.environment = options.environment
    this.provider = options.provider
    this.answers = options.answers
    this.held = options.held
    this.templates = options.templates ?? defaultTemplates()
    this.root = resolve(this.templates, '..', '..', '..')
  }

  /**
   * Runs the interface, and gives the terminal back when the reader quits.
   */
  async start(): Promise<void> {
    await this.loadProfiles()
    await this.loadDeployments()
    this.timer = setInterval(() => {
      void this.refresh()
    }, REFRESH)
    try {
      while (this.running) {
        const key = await this.screen.read()
        await this.onKey(key)
      }
    } finally {
      if (this.timer) clearInterval(this.timer)
      this.screen.close()
    }
  }

  /**
   * Draws the state.
   */
  private render(): void {
    this.screen.write(viewOf(this.state, this.screen.size(), this.painted()))
  }

  /**
   * True when the interface paints its frames.
   */
  private painted(): boolean {
    if (this.environment.NO_COLOR !== undefined) return false
    return process.stdout.isTTY !== false
  }

  /**
   * The state, after the action.
   *
   * @param action what the reader did.
   */
  private dispatch(action: Action): void {
    this.state = reduce(this.state, action)
    this.render()
  }

  /**
   * The work the interface does beside its loop.
   *
   * @param work the work.
   */
  private async at(work: () => Promise<void>): Promise<void> {
    if (this.working) return
    this.working = true
    this.dispatch({ type: 'busy', busy: true })
    try {
      await work()
    } catch (error) {
      this.report(error)
    } finally {
      this.working = false
      this.dispatch({ type: 'busy', busy: this.reads > 0 })
    }
  }

  /**
   * Reads a page from its service.
   *
   * The page says that it reads while it does, unless the reading is
   * the one of the clock: a page that reads itself every few seconds
   * does not blink. An answer that comes after the reader left the
   * page is the answer of another page, and it is dropped: the work
   * says so by answering false.
   *
   * @param page the page that is read.
   * @param quiet true when the clock asked for the reading, and not the reader.
   * @param work the reading. It answers false when the answer was dropped.
   */
  private async reading(page: Page, quiet: boolean, work: () => Promise<boolean>): Promise<void> {
    this.reads += 1
    if (!quiet) this.dispatch({ type: 'busy', busy: true })
    try {
      const read = await work()
      if (read && this.unread && this.state.message?.kind === 'error') {
        // The page is read again: the message that said it could not
        // be read says something that is not true any more.
        this.unread = false
        this.dispatch({ type: 'message', message: undefined })
      }
    } catch (error) {
      if (this.state.page === page) {
        this.report(error)
        this.unread = true
      }
    } finally {
      this.reads -= 1
      if (this.state.busy !== (this.working || this.reads > 0)) {
        this.dispatch({ type: 'busy', busy: this.working || this.reads > 0 })
      }
    }
  }

  /**
   * Tells the reader that something failed.
   *
   * A page that cannot be read is a message and not the end of the
   * interface: the reader reads the message and goes on.
   *
   * @param error what failed.
   */
  private report(error: unknown): void {
    const message = error instanceof CliFailure ? error.message : String(error)
    this.unread = false
    this.dispatch({ type: 'message', message: { text: message, kind: 'error' } })
  }

  /**
   * Refreshes the page the reader is on.
   *
   * The clock does not read a page the reader is busy on: a reader who
   * is asked a question, who is in a form or who types a filter keeps
   * the page they see.
   *
   * @param quiet true when the clock asked for the reading, and not the reader.
   */
  private async refresh(quiet = true): Promise<void> {
    if (this.working || this.reads > 0 || !this.running) return
    if (this.state.form || this.pending || this.state.filtering) return
    switch (this.state.page) {
      case 'overview':
        await this.loadProbes(quiet)
        break
      case 'tenants':
        await this.loadTenants(quiet)
        break
      case 'principals':
        await this.loadPrincipals(quiet)
        break
      case 'grants':
        await this.loadGrants(quiet)
        break
      case 'deployments':
        if (quiet) break
        await this.loadProfiles()
        await this.loadDeployments()
        break
      default:
        break
    }
  }

  /**
   * The key the reader pressed.
   *
   * @param key the key.
   */
  private async onKey(key: Key): Promise<void> {
    if (key.kind === 'ctrl' && key.char === 'c') {
      this.running = false
      return
    }
    if (key.kind === 'resize') {
      this.render()
      return
    }
    if (this.pending) {
      await this.onConfirmation(key)
      return
    }
    if (this.state.form) {
      await this.onFormKey(key)
      return
    }
    if (this.state.filtering) {
      await this.onFilterKey(key)
      return
    }
    // A message is read once: the next key of the reader takes it
    // away, and the line of the status is free for the next one.
    if (this.state.message) {
      this.unread = false
      this.dispatch({ type: 'message', message: undefined })
    }
    await this.onPageKey(key)
  }

  /**
   * The key of a reader who is asked to confirm.
   *
   * The question is answered by a yes or by a no, and by nothing else:
   * a key that is neither leaves the question where it is, and a hand
   * that slipped changes nothing and loses nothing.
   *
   * @param key the key.
   */
  private async onConfirmation(key: Key): Promise<void> {
    const pending = this.pending
    if (!pending) return
    const yes = key.kind === 'char' && (key.char === 'y' || key.char === 'Y')
    const no =
      key.kind === 'escape' ||
      (key.kind === 'char' && (key.char === 'n' || key.char === 'N' || key.char === 'q'))
    if (!yes && !no) return
    this.pending = undefined
    this.dispatch({ type: 'confirm', question: undefined })
    if (!yes) {
      if (pending.action === 'grant-principal') {
        this.dispatch({
          type: 'message',
          message: {
            text: 'the principal is written, without a grant: g gives it one',
            kind: 'ok',
          },
        })
        return
      }
      if (pending.action !== 'discard-form') {
        this.dispatch({ type: 'message', message: { text: 'nothing was changed', kind: 'info' } })
      }
      return
    }
    switch (pending.action) {
      case 'remove-profile':
        await this.at(async () => {
          await removeProfile(this.services.profiles, pending.id ?? '')
          await this.loadProfiles()
          await this.loadDeployments()
          this.dispatch({
            type: 'message',
            message: { text: `the profile ${pending.id ?? ''} is removed`, kind: 'ok' },
          })
        })
        return
      case 'revoke-grant':
        await this.at(async () => {
          const call = accessCallOf(this.services.http, await this.credentialed())
          await revokeOf(call, pending.id ?? '')
          await this.loadGrants()
          this.dispatch({ type: 'message', message: { text: 'the grant is revoked', kind: 'ok' } })
        })
        return
      case 'discard-form':
        await this.closeForm()
        return
      case 'grant-principal': {
        const person = this.people.get(pending.id ?? '')
        if (!person) return
        this.scope = { tenant: person.tenant || this.scope.tenant, principal: person }
        await this.openPage('grants')
        await this.openGrant()
        return
      }
      case 'deploy':
        if (pending.form) await this.onDeploy(pending.form, true)
        return
      default:
        return
    }
  }

  /**
   * Asks the reader to confirm.
   *
   * @param question the question.
   * @param pending what the interface does when the reader says yes.
   */
  private ask(question: string, pending: NonNullable<Interface['pending']>): void {
    this.pending = pending
    this.dispatch({ type: 'confirm', question })
  }

  /**
   * The key of a reader who is in a form.
   *
   * @param key the key.
   */
  private async onFormKey(key: Key): Promise<void> {
    const form = this.state.form
    const text = form?.fields[form.focus]?.kind === 'text'
    switch (key.kind) {
      case 'char':
        // The space is a letter of a field that holds a text, and it
        // is the key that changes the value of the other fields.
        if (key.char === ' ' && !text) {
          this.choose(1, true)
          return
        }
        this.dispatch({ type: 'type', char: key.char })
        return
      case 'tab':
      case 'down':
        this.dispatch({ type: 'focus', delta: 1 })
        return
      case 'backtab':
      case 'up':
        this.dispatch({ type: 'focus', delta: -1 })
        return
      case 'left':
        if (text) this.dispatch({ type: 'cursor', delta: -1 })
        else this.choose(-1)
        return
      case 'right': {
        if (!text) {
          this.choose(1)
          return
        }
        // At the end of the value, the key takes what the field offers.
        const field = form?.fields[form.focus]
        const atEnd = field !== undefined && cursorOf(form) === field.value.length
        if (atEnd && field && suggestionOf(field) !== undefined) this.dispatch({ type: 'accept' })
        else this.dispatch({ type: 'cursor', delta: 1 })
        return
      }
      case 'home':
        this.dispatch({ type: 'edge', end: false })
        return
      case 'end':
        this.dispatch({ type: 'edge', end: true })
        return
      case 'backspace':
        this.dispatch({ type: 'erase' })
        return
      case 'delete':
        this.dispatch({ type: 'delete' })
        return
      case 'ctrl':
        if (key.char === 'u') this.dispatch({ type: 'clear' })
        if (key.char === 'a') this.dispatch({ type: 'edge', end: false })
        if (key.char === 'e') this.dispatch({ type: 'edge', end: true })
        return
      case 'enter':
        await this.onSubmit()
        return
      case 'escape':
        // A form the reader wrote in is not thrown away by one key.
        if (form && this.written(form)) {
          this.ask('the form is left, and what was written in it is lost?', {
            action: 'discard-form',
          })
          return
        }
        await this.closeForm()
        return
      default:
        return
    }
  }

  /**
   * Changes the value of the field the reader is in.
   *
   * The environment of a deployment names the deployment: the answers
   * of the deployment of that environment are the ones the form offers,
   * and the form looks for them when the reader names another one.
   *
   * @param delta the number of the values the reader moved.
   * @param cycle true when the list goes round, false when it stops at its ends.
   */
  private choose(delta: number, cycle = false): void {
    this.dispatch(cycle ? { type: 'choice', delta } : { type: 'step', delta })
    const form = this.state.form
    const field = form?.fields[form.focus]
    if (form?.action === 'deploy' && field?.name === 'environment') this.find(field.value)
  }

  /**
   * True when the reader wrote in the form.
   *
   * @param form the form.
   */
  private written(form: Form): boolean {
    return form.fields.some((field) => field.value !== (this.pristine[field.name] ?? ''))
  }

  /**
   * Looks for the answers of a deployment that are not the reader's to
   * type, and writes them in the form.
   *
   * The search happens beside the form: the reader fills in the form
   * while the release is read. An answer that is found is written in a
   * field the reader did not write in, and a field the reader wrote in
   * keeps what the reader wrote.
   *
   * @param environment the environment the reader chose, when one is chosen.
   */
  private find(environment?: string): void {
    const answers = this.answers
    if (!answers) return
    this.searches += 1
    const search = this.searches
    const work = async (): Promise<void> => {
      this.reads += 1
      this.dispatch({ type: 'busy', busy: true })
      try {
        const found = await answers(this.templates, await this.defaults(), environment)
        // The reader left the form, or asked for the answers of
        // another environment since: these answers are answers to a
        // question nobody asks any more.
        if (search !== this.searches || this.state.form?.action !== 'deploy') return
        this.release = found.release
        this.offer(found.accounts)
        for (const [name, value] of Object.entries(found.values)) {
          const field = this.state.form?.fields.find((one) => one.name === name)
          if (!field || field.value !== (this.pristine[name] ?? '')) continue
          this.pristine[name] = value
          if (field.value !== value) this.dispatch({ type: 'field', name, value })
        }
        const notes = found.notes.filter((note) => !this.noted.has(note))
        for (const note of notes) this.noted.add(note)
        if (notes.length > 0) this.dispatch({ type: 'log', lines: notes })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.dispatch({
          type: 'log',
          lines: [`the answers of the deployment could not be read: ${reason}`],
        })
      } finally {
        this.reads -= 1
        this.dispatch({ type: 'busy', busy: this.working || this.reads > 0 })
      }
    }
    this.finding = work()
  }

  /**
   * Asks the reader which account of the provider the deployment is
   * written in.
   *
   * The wizard of the command line asks the question at the sign in,
   * and the deployment the interface runs has nobody to ask: the
   * question is a field of the form, the first one, and the answer is
   * the account the session of the machine works in until the reader
   * names another. An operator who holds one account is asked nothing.
   *
   * @param accounts the accounts the session of the machine holds.
   */
  private offer(accounts: readonly Account[] | undefined): void {
    const form = this.state.form
    if (!form || accounts === undefined) return
    if (form.fields.some((field) => field.name === ACCOUNT)) return
    const note = (line: string): void => {
      if (this.noted.has(line)) return
      this.noted.add(line)
      this.dispatch({ type: 'log', lines: [line] })
    }
    if (accounts.length === 0) {
      note(
        `the machine holds no session of ${this.provider?.name ?? 'the provider'}: sign in before the deployment begins, the interface cannot ask which account it is written in`
      )
      return
    }
    // Two accounts of one name are told apart by their identifier.
    const names = accounts.map((account) => account.name)
    const labelOf = (account: Account): string =>
      names.filter((name) => name === account.name).length > 1
        ? `${account.name} (${account.id})`
        : account.name
    this.accounts = new Map(accounts.map((account) => [labelOf(account), account.id]))
    const current = accounts.find((account) => account.current) ?? accounts[0]!
    if (accounts.length === 1) {
      note(`the deployment is written in the subscription ${current.name}`)
      return
    }
    const field: Field = {
      name: ACCOUNT,
      label: 'the subscription the deployment is written in',
      value: labelOf(current),
      kind: 'choice',
      choices: accounts.map(labelOf),
      hint: 'the one the session of this machine works in, until another is chosen',
    }
    this.pristine[ACCOUNT] = field.value
    this.dispatch({
      type: 'form',
      form: { ...form, fields: [field, ...form.fields], focus: form.focus + 1 },
    })
    note(`the operator holds ${accounts.length} subscriptions: the form asks which one`)
  }

  /**
   * Closes the form the reader is in.
   */
  private async closeForm(): Promise<void> {
    this.dispatch({ type: 'form', form: undefined })
    if (this.state.page === 'create') {
      this.dispatch({ type: 'back' })
      await this.loadProfiles()
      // The reader who created a deployment comes back on it.
      const deployed = this.deployed
      this.deployed = undefined
      if (deployed !== undefined && this.state.profiles.profiles[deployed]) {
        this.dispatch({
          type: 'context',
          context: resolveContext(this.state.profiles, this.environment, deployed),
        })
      }
      await this.onPage()
    }
  }

  /**
   * The key of a reader who types the text of the filter.
   *
   * @param key the key.
   */
  private async onFilterKey(key: Key): Promise<void> {
    switch (key.kind) {
      case 'char':
        this.dispatch({ type: 'filter', text: this.state.filter + key.char })
        break
      case 'backspace':
        if (this.state.filter === '') {
          this.dispatch({ type: 'filtering', on: false })
          return
        }
        this.dispatch({ type: 'filter', text: this.state.filter.slice(0, -1) })
        break
      case 'ctrl':
        if (key.char !== 'u') return
        this.dispatch({ type: 'filter', text: '' })
        break
      case 'up':
        this.dispatch({ type: 'move', delta: -1 })
        break
      case 'down':
        this.dispatch({ type: 'move', delta: 1 })
        break
      case 'enter':
        this.dispatch({ type: 'filtering', on: false })
        return
      case 'escape':
        this.dispatch({ type: 'filter', text: '' })
        this.dispatch({ type: 'filtering', on: false })
        break
      default:
        return
    }
    await this.showSelection()
  }

  /**
   * The key of a reader who is on a page.
   *
   * @param key the key.
   */
  private async onPageKey(key: Key): Promise<void> {
    switch (key.kind) {
      case 'up':
        await this.move(-1)
        return
      case 'down':
        await this.move(1)
        return
      case 'pageup':
        await this.move(-this.step())
        return
      case 'pagedown':
        await this.move(this.step())
        return
      case 'home':
        await this.move(-this.state.rows.length)
        return
      case 'end':
        await this.move(this.state.rows.length)
        return
      case 'enter':
        await this.onOpen()
        return
      case 'escape':
        // The escape takes the filter away first, and the page after.
        if (this.state.filter !== '') {
          this.dispatch({ type: 'filter', text: '' })
          await this.showSelection()
          return
        }
        this.dispatch({ type: 'back' })
        await this.onPage()
        return
      case 'char':
        await this.onChar(key.char)
        return
      default:
        return
    }
  }

  /**
   * Moves the selection, and shows what it is on.
   *
   * @param delta the number of the rows the reader moved.
   */
  private async move(delta: number): Promise<void> {
    this.dispatch({ type: 'move', delta })
    await this.showSelection()
  }

  /**
   * The number of the rows a page key moves the selection by.
   */
  private step(): number {
    return Math.max(1, this.screen.size().rows - 6)
  }

  /**
   * The key of a reader who types a letter.
   *
   * @param char the letter.
   */
  private async onChar(char: string): Promise<void> {
    switch (char) {
      case 'q':
        this.running = false
        return
      case '?':
        if (this.state.page === 'help') {
          this.dispatch({ type: 'back' })
          await this.onPage()
          return
        }
        this.dispatch({ type: 'page', page: 'help' })
        return
      case 'j':
        await this.move(1)
        return
      case 'k':
        await this.move(-1)
        return
      case '/':
        if (LISTS.includes(this.state.page)) this.dispatch({ type: 'filtering', on: true })
        return
      case 'r':
        await this.refresh(false)
        return
      case 'n':
        await this.onNew()
        return
      case 'e':
        await this.onEdit()
        return
      case 'd':
        this.onDelete()
        return
      case 'c':
        await this.onCurrent()
        return
      case 't':
        this.scope = {}
        await this.openPage('tenants')
        return
      case 'p':
        // The principals of the tenant the reader is on, or in.
        if (this.state.page === 'tenants') this.scope = { tenant: this.selected()?.id }
        else if (this.state.page === 'grants') this.scope = { tenant: this.scope.tenant }
        else if (this.state.page !== 'principals') this.scope = {}
        await this.openPage('principals')
        return
      case 'g':
        // The grants of the principal, or of the tenant, the reader is on.
        if (this.state.page === 'tenants') this.scope = { tenant: this.selected()?.id }
        else if (this.state.page === 'principals') {
          const person = this.people.get(this.selected()?.id ?? '')
          this.scope = person
            ? { tenant: person.tenant || this.scope.tenant, principal: person }
            : this.scope
        } else if (this.state.page !== 'grants') this.scope = {}
        await this.openPage('grants')
        return
      default:
        return
    }
  }

  /**
   * Opens another page.
   *
   * @param page the page.
   */
  private async openPage(page: Page): Promise<void> {
    this.dispatch({ type: 'page', page })
    await this.onPage()
  }

  /**
   * The title of the page, which says whose principals and whose
   * grants the reader reads.
   */
  private retitle(): void {
    const deployment = this.context().name
    const { tenant, principal } = this.scope
    let title: string | undefined
    if (this.state.page === 'principals') {
      title = `the principals of ${tenant ?? deployment}`
    } else if (this.state.page === 'grants') {
      title = `the grants of ${principal?.label ?? tenant ?? deployment}`
    }
    if (title !== undefined && title !== this.state.title) this.dispatch({ type: 'title', title })
  }

  /**
   * The page the reader goes back to.
   */
  private async onPage(): Promise<void> {
    // The reader who goes back up leaves what was under: the
    // principals are the ones of a tenant and of no principal, and the
    // tenants are the ones of the deployment.
    if (this.state.page === 'principals') this.scope = { tenant: this.scope.tenant }
    else if (this.state.page !== 'grants') this.scope = {}
    this.retitle()
    switch (this.state.page) {
      case 'tenants':
        await this.loadTenants()
        return
      case 'principals':
        await this.loadPrincipals()
        return
      case 'grants':
        await this.loadGrants()
        return
      case 'overview':
        await this.loadProbes()
        return
      case 'deployments':
        await this.loadDeployments()
        return
      default:
        return
    }
  }

  /**
   * The deployment the interface works on.
   */
  private context(): ResolvedContext {
    return this.state.context ?? resolveContext(this.state.profiles, this.environment)
  }

  /**
   * The deployment the interface works on, with the credential of its
   * administration.
   *
   * The credential of the shell is the credential: the operator named
   * it. A shell that holds none leaves the question to the deployment,
   * which created one: the interface reads it in the state of the
   * deployment, once, and keeps it while it runs. A deployment that
   * does not answer is asked again when the reader asks for the page
   * again, and not by the clock.
   *
   * @param quiet true when the clock asked, and not the reader.
   */
  private async credentialed(quiet = false): Promise<ResolvedContext> {
    const context = this.context()
    if (context.adminToken || !this.held) return context
    const name = context.name
    if (!this.credentials.has(name) && !(quiet && this.refused.has(name))) {
      const read = await this.held(this.templates, context)
      if (read.adminToken) {
        this.credentials.set(name, read)
        this.refused.delete(name)
      } else {
        this.refused.set(name, read.note ?? 'the deployment answered no credential')
      }
    }
    const read = this.credentials.get(name)
    if (!read) {
      throw new CliFailure(
        `the credential of the administration is missing: ${this.refused.get(name) ?? ''}: set PLATFORMCTL_ADMIN_TOKEN`,
        3,
        'not_authenticated'
      )
    }
    const resolved = {
      ...context,
      accessUrl: context.accessUrl ?? read.accessUrl,
      adminToken: read.adminToken,
    }
    // The page of the deployment says that the credential is there.
    if (this.state.context?.name === name && !this.state.context.adminToken) {
      this.dispatch({ type: 'context', context: resolved })
    }
    return resolved
  }

  /**
   * Reads the deployments of the machine.
   */
  private async loadProfiles(): Promise<void> {
    const profiles = await profilesOf(this.services.profiles)
    this.dispatch({ type: 'profiles', profiles })
  }

  /**
   * Draws the deployments of the machine.
   *
   * The selection is on the deployment the interface works on, and on
   * the one of the machine when it works on none yet: a reader who
   * comes back from the tenants of a deployment is on that deployment.
   */
  private async loadDeployments(): Promise<void> {
    const profiles = this.state.profiles
    const names = Object.keys(profiles.profiles).sort()
    const rows: Row[] = names.map((name) => {
      const profile = profiles.profiles[name]!
      return {
        id: name,
        cells: [
          name,
          profiles.current === name ? 'current' : '',
          profile.gatewayUrl ?? '',
          profile.accessUrl ?? '',
          profile.workspaceId ?? '',
        ],
      }
    })
    this.applyRows(
      ['name', '', 'gateway', 'access', 'workspace'],
      rows,
      this.state.context?.name ?? profiles.current
    )
    this.dispatch({ type: 'loaded' })
    await this.showSelection()
  }

  /**
   * Draws a list, and keeps the selection on the row the reader was on.
   *
   * @param columns the names of the columns.
   * @param rows the rows of the list.
   * @param preferred the row the selection is on when the reader was on none.
   */
  private applyRows(columns: readonly string[], rows: readonly Row[], preferred?: string): void {
    const selected = this.selected()?.id ?? preferred
    this.dispatch({ type: 'rows', columns, rows })
    if (selected === undefined) return
    const index = visibleRows(this.state).findIndex((row) => row.id === selected)
    if (index >= 0) this.dispatch({ type: 'select', index })
  }

  /**
   * The row the reader has selected, among the rows the reader sees.
   */
  private selected(): Row | undefined {
    return visibleRows(this.state)[this.state.selection]
  }

  /**
   * The name of the deployment the reader has selected.
   */
  private selectedName(): string | undefined {
    return this.selected()?.id
  }

  /**
   * Opens what the reader has selected.
   */
  private async onOpen(): Promise<void> {
    switch (this.state.page) {
      case 'deployments': {
        const name = this.selectedName()
        if (!name) return
        await this.openPage('overview')
        return
      }
      case 'tenants':
        await this.onEdit()
        return
      default:
        return
    }
  }

  /**
   * The lines that describe the selected row.
   *
   * On the page of the deployments the selected row is the deployment
   * the interface works on: the tenants, the principals, the grants
   * and the probes the reader opens next are the ones of the row the
   * reader is on, and of no other.
   */
  private async showSelection(): Promise<void> {
    const row = this.selected()
    if (this.state.page === 'deployments') {
      if (!row) {
        this.dispatch({ type: 'detail', lines: [] })
        return
      }
      if (this.state.context?.name !== row.id) {
        this.dispatch({
          type: 'context',
          context: resolveContext(this.state.profiles, this.environment, row.id),
        })
        // The probes are the probes of a deployment, and the reader is
        // on another one now.
        this.dispatch({ type: 'probes', probes: [] })
      }
      this.dispatch({ type: 'detail', lines: factsOf(this.state) })
      return
    }
    const key = SECTIONS[this.state.page]
    const record = row && key ? recordOfRow(this.body, key, row.id) : undefined
    this.dispatch({ type: 'detail', lines: record ? detailsOf(record) : [] })
  }

  /**
   * Reads the probes of the deployment.
   *
   * @param quiet true when the clock asked for the reading, and not the reader.
   */
  private async loadProbes(quiet = false): Promise<void> {
    await this.reading('overview', quiet, async () => {
      const context = this.context()
      const probes = await probesOfDeployment(this.services.http, context)
      if (this.state.page !== 'overview' || this.context().name !== context.name) return false
      this.dispatch({ type: 'probes', probes })
      return true
    })
  }

  /**
   * Reads the tenants of the deployment.
   *
   * @param quiet true when the clock asked for the reading, and not the reader.
   */
  private async loadTenants(quiet = false): Promise<void> {
    await this.reading('tenants', quiet, async () => {
      const call = accessCallOf(this.services.http, await this.credentialed(quiet))
      const body = await tenantsOf(call)
      this.slugs = valuesIn(body, 'tenants', 'slug')
      return await this.list('tenants', body, HEADS.tenants, tenantRows(body))
    })
  }

  /**
   * Reads the principals of the deployment.
   *
   * @param quiet true when the clock asked for the reading, and not the reader.
   */
  private async loadPrincipals(quiet = false): Promise<void> {
    await this.reading('principals', quiet, async () => {
      const call = accessCallOf(this.services.http, await this.credentialed(quiet))
      const body = await principalsOf(call, { limit: PAGE, tenant: this.scope.tenant })
      for (const person of peopleOf(body)) this.people.set(person.id, person)
      return await this.list('principals', body, HEADS.principals, principalRows(body))
    })
  }

  /**
   * Reads the grants of the deployment.
   *
   * @param quiet true when the clock asked for the reading, and not the reader.
   */
  private async loadGrants(quiet = false): Promise<void> {
    await this.reading('grants', quiet, async () => {
      const call = accessCallOf(this.services.http, await this.credentialed(quiet))
      const body = await grantsOf(call, {
        limit: PAGE,
        tenant: this.scope.tenant,
        userId: this.scope.principal?.id,
      })
      for (const name of ['permission', 'workspaceId', 'routeId', 'grantedBy']) {
        this.seen[name] ??= new Set()
        for (const value of valuesIn(body, 'grants', name)) this.seen[name].add(value)
      }
      // A grant names its principal by an identifier, and the reader
      // knows the principal by its address: the principals are read
      // once, beside the grants, and the list shows the addresses.
      if (!quiet && this.unnamed(body)) {
        try {
          const principals = await principalsOf(call, { limit: PAGE, tenant: this.scope.tenant })
          for (const person of peopleOf(principals)) this.people.set(person.id, person)
        } catch {
          // The grants are read, and they are shown with the identifiers.
        }
      }
      const names = new Map([...this.people].map(([id, person]) => [id, person.label]))
      return await this.list('grants', body, HEADS.grants, grantRows(body, names))
    })
  }

  /**
   * Draws the list a service answered with, on the page that asked for it.
   *
   * @param page the page that asked.
   * @param body the answer of the service.
   * @param columns the names of the columns.
   * @param rows the rows of the list.
   */
  private async list(
    page: Page,
    body: unknown,
    columns: readonly string[],
    rows: readonly Row[]
  ): Promise<boolean> {
    // The reader left the page while its service was answering, or
    // started to write: the answer is not drawn over what they see.
    if (this.state.page !== page || this.state.form) return false
    this.body = body
    this.applyRows(columns, rows)
    this.dispatch({ type: 'loaded' })
    await this.showSelection()
    return true
  }

  /**
   * The form of a new thing.
   */
  private async onNew(): Promise<void> {
    switch (this.state.page) {
      case 'deployments':
        await this.openWizard()
        return
      case 'tenants':
        this.openForm('a new tenant', 'tenant', tenantFields())
        return
      case 'principals':
        await this.know(false)
        this.openForm(
          'a new principal',
          'principal',
          principalFields({ tenants: this.slugs, tenant: this.scope.tenant })
        )
        this.first()
        return
      case 'grants':
        await this.openGrant()
        return
      default:
        return
    }
  }

  /**
   * Reads what the forms of Access offer, when the interface has not
   * read it yet: the tenants of the deployment and the principals of
   * the tenant the reader is in. What cannot be read is not offered,
   * and the reader types it.
   *
   * @param principals true when the form offers the principals too.
   */
  private async know(principals: boolean): Promise<void> {
    const tenant = this.scope.tenant
    const peopled = [...this.people.values()].some((one) => !tenant || one.tenant === tenant)
    if (this.slugs.length > 0 && (!principals || peopled)) return
    this.dispatch({ type: 'busy', busy: true })
    try {
      const call = accessCallOf(this.services.http, await this.credentialed())
      if (this.slugs.length === 0) this.slugs = valuesIn(await tenantsOf(call), 'tenants', 'slug')
      if (principals && !peopled) {
        const body = await principalsOf(call, { limit: PAGE, tenant })
        for (const person of peopleOf(body)) this.people.set(person.id, person)
      }
    } catch {
      // The form opens without the offers.
    } finally {
      this.dispatch({ type: 'busy', busy: this.working || this.reads > 0 })
    }
  }

  /**
   * True when an answer of Access names a principal the interface
   * cannot call by its address.
   *
   * @param body the grants Access answered with.
   */
  private unnamed(body: unknown): boolean {
    return valuesIn(body, 'grants', 'userId').some((id) => !this.people.has(id))
  }

  /**
   * The form of a new grant.
   *
   * The form holds what the reader would otherwise look up on another
   * page and type: the tenant and the principal the reader is on, the
   * workspace of the deployment, and the permissions and the routes
   * the grants of the deployment already name.
   */
  private async openGrant(): Promise<void> {
    await this.know(true)
    const { tenant, principal } = this.scope
    const people = [...this.people.values()].filter((one) => !tenant || one.tenant === tenant)
    const values = (name: string): string[] => [...(this.seen[name] ?? [])].sort()
    const title = principal ? `a new grant of ${principal.label}` : 'a new grant'
    this.openForm(
      title,
      'grant',
      grantFields({
        tenants: this.slugs,
        tenant,
        principals: people.map((one) => one.label).sort(),
        principal: principal?.label,
        permissions: values('permission'),
        workspaces: values('workspaceId'),
        workspace: this.context().workspaceId,
        routes: values('routeId'),
        givers: values('grantedBy'),
        giver: this.giver,
      })
    )
    this.first()
  }

  /**
   * Puts the reader in the first field of the form that still asks
   * something: the fields the interface filled in are behind them.
   */
  private first(): void {
    const empty = this.state.form?.fields.findIndex((field) => field.value === '')
    if (empty !== undefined && empty > 0) this.dispatch({ type: 'goto', index: empty })
  }

  /**
   * The form of the thing the reader has selected.
   */
  private async onEdit(): Promise<void> {
    switch (this.state.page) {
      case 'deployments': {
        const name = this.selectedName()
        if (!name) return
        const profile = this.state.profiles.profiles[name] ?? {}
        this.openForm(`the profile ${name}`, 'profile', profileFields(profile))
        return
      }
      case 'tenants': {
        const row = this.selected()
        if (!row) return
        const record = recordOfRow(this.body, 'tenants', row.id)
        if (!record) return
        this.openForm(`the tenant ${row.id}`, 'tenant', tenantFields(record))
        return
      }
      default:
        return
    }
  }

  /**
   * What the reader removes.
   *
   * The question names what is removed: the reader says yes to a thing
   * they read, and not to a row they think they are on.
   */
  private onDelete(): void {
    if (this.state.page === 'deployments') {
      const name = this.selectedName()
      if (!name) return
      this.ask(`the profile ${name} is removed from this machine?`, {
        action: 'remove-profile',
        id: name,
      })
      return
    }
    if (this.state.page === 'grants') {
      const row = this.selected()
      if (!row) return
      const [tenant, principal, permission] = row.cells
      this.ask(
        `the grant of ${permission || 'the permission'} to ${principal || 'the principal'} in ${tenant || 'the tenant'} is revoked?`,
        { action: 'revoke-grant', id: row.id }
      )
    }
  }

  /**
   * Makes the deployment the reader has selected the one of the machine.
   */
  private async onCurrent(): Promise<void> {
    if (this.state.page !== 'deployments') return
    const name = this.selectedName()
    if (!name) return
    await this.at(async () => {
      const profiles = await this.services.profiles.read()
      await this.services.profiles.write({
        current: name,
        profiles: profiles.profiles,
      })
      await this.loadProfiles()
      await this.loadDeployments()
      this.dispatch({
        type: 'message',
        message: { text: `the deployment ${name} is the one of the machine`, kind: 'ok' },
      })
    })
  }

  /**
   * Opens a form.
   *
   * @param title the title of the form.
   * @param action what the form does when it is sent.
   * @param fields the fields of the form.
   */
  private openForm(title: string, action: string, fields: readonly Field[]): void {
    this.pristine = Object.fromEntries(fields.map((field) => [field.name, field.value]))
    this.dispatch({ type: 'form', form: { title, fields, focus: 0, action } })
  }

  /**
   * The form of the creation of a deployment.
   */
  private async openWizard(): Promise<void> {
    const provider = this.provider
    if (!provider) {
      this.dispatch({
        type: 'message',
        message: { text: 'the deployment of this CLI has no provider', kind: 'error' },
      })
      return
    }
    const defaults = await this.defaults()
    const fields: Field[] = []
    for (const question of provider.questions) {
      if (question.kind === 'given') continue
      fields.push(fieldOf(question, defaults[question.name] ?? ''))
    }
    fields.push({
      name: 'operator_addresses',
      label: 'the addresses that reach the state',
      value: defaults.operator_addresses ?? '',
      kind: 'text',
      hint: 'the addresses of the machine of the operator, separated by commas',
    })
    this.dispatch({ type: 'page', page: 'create' })
    this.openForm('the questions of the deployment', 'deploy', fields)
    this.noted = new Set()
    this.accounts = new Map()
    this.release = undefined
    this.find()
  }

  /**
   * The values the templates of a deployment hold by default.
   */
  private async defaults(): Promise<Values> {
    try {
      const example = await readFile(join(this.templates, 'terraform.tfvars.example'), 'utf8')
      return defaultsOf(example)
    } catch {
      return {}
    }
  }

  /**
   * What the form of the reader does when it is sent.
   */
  private async onSubmit(): Promise<void> {
    const form = this.state.form
    if (!form) return
    switch (form.action) {
      case 'deploy':
        await this.onDeploy(form)
        return
      case 'profile':
        await this.onSaveProfile(form)
        return
      case 'tenant':
        await this.onSaveTenant(form)
        return
      case 'principal':
        await this.onSavePrincipal(form)
        return
      case 'grant':
        await this.onSaveGrant(form)
        return
      default:
        return
    }
  }

  /**
   * Writes the profile the reader has edited.
   *
   * @param form the form.
   */
  private async onSaveProfile(form: Form): Promise<void> {
    const name = this.selectedName()
    if (!name) return
    await this.at(async () => {
      await saveProfile(
        this.services.profiles,
        name,
        {
          gatewayUrl: fieldValue(form, 'gatewayUrl'),
          controlUrl: fieldValue(form, 'controlUrl'),
          accessUrl: fieldValue(form, 'accessUrl'),
          workspaceId: fieldValue(form, 'workspaceId'),
          tenantId: fieldValue(form, 'tenantId'),
          clientId: fieldValue(form, 'clientId'),
          redirectUri: fieldValue(form, 'redirectUri'),
        },
        this.state.profiles.current === name
      )
      await this.closeForm()
      await this.loadProfiles()
      await this.loadDeployments()
      this.dispatch({
        type: 'message',
        message: { text: `the profile ${name} is written`, kind: 'ok' },
      })
    })
  }

  /**
   * Writes the tenant the reader has edited.
   *
   * @param form the form.
   */
  private async onSaveTenant(form: Form): Promise<void> {
    await this.at(async () => {
      const call = accessCallOf(this.services.http, await this.credentialed())
      await tenantOf(call, {
        slug: fieldValue(form, 'slug'),
        displayName: fieldValue(form, 'displayName'),
        issuer: fieldValue(form, 'issuer'),
        idpClientId: fieldValue(form, 'idpClientId'),
        idpClientSecret: fieldValue(form, 'idpClientSecret'),
        idpRedirectUri: fieldValue(form, 'idpRedirectUri'),
        emailDomain: fieldValue(form, 'emailDomain'),
        clientId: fieldValue(form, 'clientId'),
        clientSecret: fieldValue(form, 'clientSecret'),
        clientRedirectUris: listOf(fieldValue(form, 'clientRedirectUris')),
        autoProvision: fieldValue(form, 'autoProvision') === 'true',
        autoProvisionAdmin: fieldValue(form, 'autoProvisionAdmin') === 'true',
        sharedClient: fieldValue(form, 'sharedClient') === 'true',
        default: fieldValue(form, 'default') === 'true',
        enabled: fieldValue(form, 'enabled') !== 'false',
      })
      await this.closeForm()
      await this.loadTenants()
      this.dispatch({ type: 'message', message: { text: 'the tenant is written', kind: 'ok' } })
    })
  }

  /**
   * Writes the principal the reader has created.
   *
   * @param form the form.
   */
  private async onSavePrincipal(form: Form): Promise<void> {
    await this.at(async () => {
      const call = accessCallOf(this.services.http, await this.credentialed())
      const written = await principalOf(call, {
        tenant: fieldValue(form, 'tenant'),
        externalSubject: fieldValue(form, 'externalSubject'),
        email: fieldValue(form, 'email'),
        displayName: fieldValue(form, 'displayName'),
      })
      await this.closeForm()
      await this.loadPrincipals()
      // A principal with no grant is refused everywhere: the reader
      // who registered one is asked for its first grant at once, and
      // does not look for the principal on another page to give it.
      const answered = peopleOf(written)[0]
      const person = answered
        ? { ...answered, tenant: answered.tenant || fieldValue(form, 'tenant') }
        : undefined
      if (person === undefined) {
        this.dispatch({
          type: 'message',
          message: { text: 'the principal is written', kind: 'ok' },
        })
        return
      }
      this.people.set(person.id, person)
      const index = visibleRows(this.state).findIndex((row) => row.id === person.id)
      if (index >= 0) this.dispatch({ type: 'select', index })
      this.ask(`${person.label} is registered, and holds no grant yet: give it one now?`, {
        action: 'grant-principal',
        id: person.id,
      })
    })
  }

  /**
   * Writes the grant the reader has created.
   *
   * @param form the form.
   */
  private async onSaveGrant(form: Form): Promise<void> {
    await this.at(async () => {
      const call = accessCallOf(this.services.http, await this.credentialed())
      // The reader names the principal by its address, and the grant
      // names it by its identifier.
      const named = fieldValue(form, 'userId').trim()
      const tenant = fieldValue(form, 'tenant')
      const people = [...this.people.values()].filter(
        (one) => one.label.toLowerCase() === named.toLowerCase()
      )
      const person = people.find((one) => one.tenant === tenant) ?? people[0]
      if (fieldValue(form, 'grantedBy') !== '') this.giver = fieldValue(form, 'grantedBy')
      await grantOf(call, {
        tenant,
        userId: person?.id ?? named,
        permission: fieldValue(form, 'permission'),
        workspaceId: fieldValue(form, 'workspaceId'),
        routeId: fieldValue(form, 'routeId'),
        expiresAt: fieldValue(form, 'expiresAt') || null,
        grantedBy: fieldValue(form, 'grantedBy'),
      })
      await this.closeForm()
      await this.loadGrants()
      this.dispatch({ type: 'message', message: { text: 'the grant is written', kind: 'ok' } })
    })
  }

  /**
   * Creates the deployment the reader has described.
   *
   * An answer that is not the shape the deployment needs puts the
   * reader in its field. A deployment is minutes of work and resources
   * of a cloud: the interface asks before it begins one.
   *
   * @param form the form.
   * @param confirmed true when the reader said yes to the deployment.
   */
  private async onDeploy(form: Form, confirmed = false): Promise<void> {
    const provider = this.provider
    if (!provider) return
    // The answers that are being looked for are answers of the form:
    // the form is sent with them, and not a moment before them.
    if (this.finding) await this.finding
    const sent = confirmed ? form : (this.state.form ?? form)
    // What the form holds and the reader did not write is not an
    // answer of the reader: the digests the release answered are left
    // to the release, and the wizard reads them where it proves them.
    const defaults = { ...(await this.defaults()), ...this.pristine }
    const values = answersFor(sent, defaults)
    // The form names the account of the deployment by the name the
    // reader reads, and the deployment takes its identifier.
    const account = values[ACCOUNT]
    const identifier = account === undefined ? undefined : this.accounts.get(account)
    if (identifier !== undefined) values[ACCOUNT] = identifier
    // The image of the client of PostgreSQL is not an image of the
    // release: the digest the form holds is the answer, and the
    // deployment does not ask the registry — or anybody — again.
    for (const field of sent.fields) {
      if (!field.name.endsWith('_image') || PLATFORM_IMAGES.includes(field.name)) continue
      if (/@sha256:[0-9a-f]{64}$/.test(field.value)) values[field.name] = field.value
    }
    const problems: { readonly name: string; readonly text: string }[] = []
    for (const question of provider.questions) {
      const value = values[question.name] ?? defaults[question.name] ?? ''
      const problem = problemOf(question, value)
      if (problem) problems.push({ name: question.name, text: problem })
    }
    const first = problems[0]
    if (first) {
      const index = sent.fields.findIndex((field) => field.name === first.name)
      if (index >= 0) this.dispatch({ type: 'goto', index })
      const others = problems.length - 1
      const more = others === 0 ? '' : `, and ${others} more ${others === 1 ? 'answer' : 'answers'}`
      this.dispatch({
        type: 'message',
        message: { text: `${first.text}${more}`, kind: 'error' },
      })
      return
    }
    if (!confirmed) {
      const brought = PLATFORM_IMAGES.some((name) => values[name] !== undefined)
      const images =
        this.release !== undefined && !brought
          ? `, and the images of the release ${this.release}`
          : ''
      const where = identifier === undefined ? '' : ` in the subscription ${account}`
      this.ask(`the deployment of ${provider.name} begins${where} with these answers${images}?`, {
        action: 'deploy',
        form: sent,
      })
      return
    }
    this.dispatch({ type: 'message', message: undefined })
    await this.at(async () => {
      await this.runDeployment(values)
    })
  }

  /**
   * Runs the deployment the reader has described.
   *
   * The wizard of the deployment is the command of the CLI: the
   * interface writes the answers of the operator in a file and runs the
   * command with it, and the words of the command are the log of the
   * interface.
   *
   * @param values the answers of the operator.
   */
  private async runDeployment(values: Values): Promise<void> {
    const provider = this.provider
    if (!provider) return
    if (!existsSync(this.templates)) {
      this.dispatch({
        type: 'message',
        message: {
          text: `the templates of the deployment are not there: ${this.templates}`,
          kind: 'error',
        },
      })
      return
    }
    this.outputs = {}
    const file = join(tmpdir(), `platformctl-answers-${process.pid}.tfvars`)
    await writeFile(file, valuesFile(provider, values), 'utf8')
    // The digests the form showed are the ones of a release, and the
    // deployment runs that release: the latest release is a moving
    // target, and the reader said yes to the one they read. A reader
    // who named a digest brought the images, and names no release.
    const brought = PLATFORM_IMAGES.some((name) => values[name] !== undefined)
    const release = this.release !== undefined && !brought ? ['--release', this.release] : []
    this.dispatch({ type: 'log', lines: [`the deployment of ${provider.name} begins`] })
    const child = Bun.spawn({
      cmd: [...mainCommand(), 'deploy', provider.name, '--answers', file, '--yes', ...release],
      cwd: this.root,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
    await Promise.all([this.read(child.stdout), this.read(child.stderr)])
    const status = await child.exited
    if (status !== 0) {
      this.dispatch({ type: 'log', lines: [`the deployment failed (${status})`] })
      this.dispatch({ type: 'message', message: { text: 'the deployment failed', kind: 'error' } })
      return
    }
    // The deployment is one the interface works on from now on: its
    // profile is written, and the reader finds it among the deployments.
    let written: string
    let goes = ''
    try {
      const { name, profile } = profileOfDeployment(values, this.outputs)
      const profiles = await this.services.profiles.read()
      await saveProfile(this.services.profiles, name, profile, profiles.current === undefined)
      await this.loadProfiles()
      this.deployed = name
      const missing = profile.gatewayUrl === undefined ? ', without its addresses: e edits it' : ''
      written = `the profile ${name} is written${missing}`
      goes = ': esc goes to it'
    } catch (error) {
      const reason = error instanceof CliFailure ? error.message : String(error)
      written = `its profile could not be written: ${reason}`
    }
    this.dispatch({ type: 'log', lines: ['the deployment is applied', written] })
    this.dispatch({
      type: 'message',
      message: { text: `the deployment is applied, and ${written}${goes}`, kind: 'ok' },
    })
  }

  /**
   * Reads the words of the deployment and writes them in the log.
   *
   * @param stream the stream of the words.
   */
  private async read(stream: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!stream) return
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      const text = decoder.decode(chunk.value)
      const lines = text.split('\n').filter((line) => line !== '')
      // The templates answer with the names of the deployment, and the
      // profile of the deployment is written from them.
      for (const line of lines) {
        const answer = line.match(/^([a-z][a-z0-9_]*) = "?([^"]*)"?$/)
        if (answer) this.outputs[answer[1]!] = answer[2]!
      }
      if (lines.length > 0) this.dispatch({ type: 'log', lines })
    }
  }
}

/** The pages that hold a list. */
const LISTS: readonly Page[] = ['deployments', 'tenants', 'principals', 'grants']

/** The name of the list of a page in the answer of Access. */
const SECTIONS: Partial<Record<Page, string>> = {
  tenants: 'tenants',
  principals: 'principals',
  grants: 'grants',
}

/** The names of the columns of the lists of Access. */
const HEADS = {
  tenants: ['slug', 'name', 'id', 'users', 'grants', 'state'],
  principals: ['email', 'name', 'id', 'tenant', 'status', 'last login'],
  grants: ['tenant', 'principal', 'permission', 'workspace', 'route', 'expires'],
} as const

/**
 * The command of the CLI, as the interface runs it.
 *
 * The command is the program itself when the CLI is a binary, and the
 * runtime with the file of the program when it is run from a checkout.
 */
function mainCommand(): readonly string[] {
  const path = fileURLToPath(new URL('../main.ts', import.meta.url))
  if (existsSync(path)) return [process.execPath, path]
  return [process.execPath]
}

/**
 * The directory of the templates of a deployment.
 */
function defaultTemplates(): string {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  return join(root, 'deploy', 'tofu', 'azure')
}
