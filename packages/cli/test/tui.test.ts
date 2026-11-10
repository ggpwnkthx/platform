import { describe, expect, test } from 'bun:test'
import { decode } from '../src/tui/keys'
import { EMPTY, fieldValue, reduce, visibleRows, type State } from '../src/tui/model'
import { keybarOf, panelOf, truncate, visibleLength, wrapOf } from '../src/tui/draw'
import { elapsedOf, viewOf } from '../src/tui/views'
import {
  answersFor,
  grantRows,
  principalRows,
  profileOfDeployment,
  recordOfRow,
  tenantRows,
} from '../src/tui/tasks'
import { latestOf } from '../src/runtime/commands/deploy'
import { heldOf } from '../src/runtime/commands/tui'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Interface } from '../src/tui/app'
import type { Screen, Size } from '../src/tui/screen'
import type { Key } from '../src/tui/keys'
import { FakeHttp } from './support'
import { azureProvider } from '../src/platform/azure'
import type { Services } from '../src/app/commands'

/**
 * The screen of the tests.
 */
class FakeScreen implements Screen {
  /** The frames the interface drew. */
  readonly frames: string[] = []
  /** The keys the reader presses. */
  private readonly keys: Key[]
  /** The size of the screen. */
  readonly size_: Size = { columns: 140, rows: 30 }

  /**
   * The screen of the tests.
   *
   * @param keys the keys the reader presses.
   */
  constructor(...keys: Key[]) {
    this.keys = [...keys]
  }

  /** The size of the screen. */
  size(): Size {
    return this.size_
  }

  /** Draws a frame. */
  write(frame: string): void {
    this.frames.push(frame)
  }

  /** Waits for the next key of the reader. */
  async read(): Promise<Key> {
    const key = this.keys.shift()
    return key ?? { kind: 'ctrl', char: 'c' }
  }

  /** Gives the terminal back. */
  close(): void {}
}

/**
 * The ports of the tests.
 */
function servicesOf(
  http: FakeHttp,
  more: Record<string, { gatewayUrl?: string; accessUrl?: string }> = {}
): Services {
  let profiles: {
    current?: string
    profiles: Record<string, { gatewayUrl?: string; accessUrl?: string; workspaceId?: string }>
  } = {
    current: 'production',
    profiles: {
      production: {
        gatewayUrl: 'https://api.example.com',
        accessUrl: 'https://access.example.com',
        workspaceId: '11111111-1111-4111-8111-111111111111',
      },
      ...more,
    },
  }
  return {
    http,
    profiles: {
      async read() {
        return profiles
      },
      async write(next: typeof profiles) {
        profiles = next
      },
    },
    credentials: {
      async read() {
        return null
      },
      async write() {},
      async clear() {},
    },
    browser: { async open() {} },
    callback: {
      async start() {
        throw new Error('the tests do not sign anybody in')
      },
    },
    crypto: { randomBytes: () => new Uint8Array(0), sha256: () => new Uint8Array(0) },
    infrastructure: {} as never,
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
    progress: () => {},
  }
}

describe('the keys of the terminal', () => {
  test('the enter key is read', () => {
    expect(decode(new Uint8Array([0x0d]))?.key).toEqual({ kind: 'enter' })
  })

  test('the escape key is read', () => {
    expect(decode(new Uint8Array([0x1b]))?.key).toEqual({ kind: 'escape' })
  })

  test('the arrows are read', () => {
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x41]))?.key).toEqual({ kind: 'up' })
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x42]))?.key).toEqual({ kind: 'down' })
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x43]))?.key).toEqual({ kind: 'right' })
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x44]))?.key).toEqual({ kind: 'left' })
  })

  test('the page keys are read', () => {
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x35, 0x7e]))?.key).toEqual({ kind: 'pageup' })
    expect(decode(new Uint8Array([0x1b, 0x5b, 0x36, 0x7e]))?.key).toEqual({ kind: 'pagedown' })
  })

  test('a letter is read', () => {
    expect(decode(new Uint8Array([0x61]))?.key).toEqual({ kind: 'char', char: 'a' })
  })

  test('a letter that is not a letter is not a letter', () => {
    expect(decode(new Uint8Array([0x1b, 0x5b]))).toBeUndefined()
  })

  test('the control key is read', () => {
    expect(decode(new Uint8Array([0x03]))?.key).toEqual({ kind: 'ctrl', char: 'c' })
  })

  test('the backspace is read', () => {
    expect(decode(new Uint8Array([0x7f]))?.key).toEqual({ kind: 'backspace' })
  })
})

describe('the state of the interface', () => {
  const rows = [
    { id: 'acme', cells: ['acme'] },
    { id: 'other', cells: ['other'] },
  ]

  test('the selection stays inside the list', () => {
    const state = reduce({ ...EMPTY, rows }, { type: 'move', delta: -1 })
    expect(state.selection).toBe(0)
    const moved = reduce(state, { type: 'move', delta: 5 })
    expect(moved.selection).toBe(1)
  })

  test('the reader goes back to the page he came from', () => {
    const page = reduce(EMPTY, { type: 'page', page: 'tenants' })
    const back = reduce(page, { type: 'back' })
    expect(back.page).toBe('deployments')
  })

  test('the reader types in the field he is in', () => {
    const form = {
      title: 'a form',
      action: 'test',
      focus: 0,
      fields: [{ name: 'slug', label: 'the slug', value: '', kind: 'text' as const }],
    }
    const typed = reduce({ ...EMPTY, form }, { type: 'type', char: 'a' })
    const second = reduce(typed, { type: 'type', char: 'b' })
    expect(fieldValue(second.form, 'slug')).toBe('ab')
    const erased = reduce(second, { type: 'erase' })
    expect(fieldValue(erased.form, 'slug')).toBe('a')
  })

  test('the reader moves from field to field', () => {
    const form = {
      title: 'a form',
      action: 'test',
      focus: 0,
      fields: [
        { name: 'one', label: 'one', value: '', kind: 'text' as const },
        { name: 'two', label: 'two', value: '', kind: 'text' as const },
      ],
    }
    const moved = reduce({ ...EMPTY, form }, { type: 'focus', delta: 1 })
    expect(moved.form?.focus).toBe(1)
    const wrapped = reduce(moved, { type: 'focus', delta: 1 })
    expect(wrapped.form?.focus).toBe(0)
  })

  test('a field that is a yes or a no is turned', () => {
    const form = {
      title: 'a form',
      action: 'test',
      focus: 0,
      fields: [{ name: 'on', label: 'on', value: 'false', kind: 'toggle' as const }],
    }
    const turned = reduce({ ...EMPTY, form }, { type: 'choice', delta: 1 })
    expect(fieldValue(turned.form, 'on')).toBe('true')
  })

  test('a field that takes one of several values takes the next one', () => {
    const form = {
      title: 'a form',
      action: 'test',
      focus: 0,
      fields: [
        {
          name: 'environment',
          label: 'the environment',
          value: 'production',
          kind: 'choice' as const,
          choices: ['development', 'production'],
        },
      ],
    }
    const chosen = reduce({ ...EMPTY, form }, { type: 'choice', delta: 1 })
    expect(fieldValue(chosen.form, 'environment')).toBe('development')
  })
})

describe('the drawing of the interface', () => {
  test('the width of a painted text is the width of its letters', () => {
    expect(visibleLength('\u001b[1mbold\u001b[0m')).toBe(4)
  })

  test('a text that is too long is cut', () => {
    expect(visibleLength(truncate('abcdefgh', 4))).toBe(4)
  })

  test('the frame holds the state', () => {
    const state: State = {
      ...EMPTY,
      title: 'the deployments of the machine',
      columns: ['name', 'state'],
      rows: [{ id: 'acme', cells: ['acme', 'current'] }],
    }
    const frame = viewOf(state, { columns: 80, rows: 20 }, false)
    expect(frame).toContain('the deployments of the machine')
    expect(frame).toContain('acme')
    expect(frame.split('\n').length).toBe(20)
  })
})

describe('the work of the interface', () => {
  test('the answers of a deployment hold no placeholder of a digest', () => {
    const placeholder = 'ghcr.io/ggpwnkthx/gateway@sha256:0000'
    const form = {
      title: 'the questions of the deployment',
      action: 'deploy',
      focus: 0,
      fields: [
        {
          name: 'environment',
          label: 'the environment',
          value: 'production',
          kind: 'text' as const,
        },
        { name: 'gateway_image', label: 'the image', value: placeholder, kind: 'text' as const },
        {
          name: 'console_image',
          label: 'the image',
          value: 'ghcr.io/ggpwnkthx/console@sha256:1111',
          kind: 'text' as const,
        },
      ],
    }
    const answers = answersFor(form, { environment: 'production', gateway_image: placeholder })
    expect(answers.environment).toBe('production')
    expect(answers.gateway_image).toBeUndefined()
    expect(answers.console_image).toBe('ghcr.io/ggpwnkthx/console@sha256:1111')
  })
  test('the tenants are read', () => {
    const rows = tenantRows({
      tenants: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'acme',
          displayName: 'Acme Inc',
          userCount: 42,
          grantCount: 57,
          enabled: true,
        },
      ],
    })
    expect(rows.length).toBe(1)
    expect(rows[0]?.id).toBe('acme')
    expect(rows[0]?.cells[0]).toBe('acme')
    expect(rows[0]?.cells[5]).toBe('enabled')
  })

  test('the principals are read', () => {
    const rows = principalRows({
      principals: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'alice@acme.example',
          displayName: 'Alice',
          tenant: 'acme',
          status: 'active',
        },
      ],
    })
    expect(rows[0]?.id).toBe('22222222-2222-4222-8222-222222222222')
    expect(rows[0]?.cells[0]).toBe('alice@acme.example')
  })

  test('the grants are read', () => {
    const rows = grantRows({
      grants: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          tenant: 'acme',
          userId: '22222222-2222-4222-8222-222222222222',
          permission: 'workspace.read',
          workspaceId: '11111111-1111-4111-8111-111111111111',
          routeId: 'data-api',
        },
      ],
    })
    expect(rows[0]?.cells[2]).toBe('workspace.read')
    expect(rows[0]?.cells[5]).toBe('never')
  })
})

describe('the interface of the operator', () => {
  test('the interface draws the deployments of the machine', async () => {
    const http = new FakeHttp()
    const screen = new FakeScreen()
    const app = new Interface({
      screen,
      services: servicesOf(http),
      environment: { PLATFORMCTL_ADMIN_TOKEN: 'a-token-of-the-administration' },
    })
    await app.start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('production')
    expect(frame).toContain('https://access.example.com')
  })

  test('the interface reads the tenants of the deployment', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, {
        tenants: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            slug: 'acme',
            displayName: 'Acme Inc',
            userCount: 1,
            grantCount: 2,
            enabled: true,
          },
        ],
      })
    )
    const screen = new FakeScreen(
      { kind: 'char', char: 't' },
      { kind: 'char', char: 'n' },
      { kind: 'escape' }
    )
    const app = new Interface({
      screen,
      services: servicesOf(http),
      environment: {
        PLATFORMCTL_ACCESS_URL: 'https://access.example.com',
        PLATFORMCTL_ADMIN_TOKEN: 'a-token-of-the-administration',
      },
    })
    await app.start()
    const frames = screen.frames.join('\n')
    expect(frames).toContain('acme')
    expect(frames).toContain('a new tenant')
  })

  test('the interface opens the form of a new deployment', async () => {
    const http = new FakeHttp()
    const screen = new FakeScreen({ kind: 'char', char: 'n' })
    const app = new Interface({
      screen,
      services: servicesOf(http),
      environment: {},
      provider: {
        name: 'azure',
        summary: 'Microsoft Azure',
        questions: [
          {
            name: 'environment',
            summary: 'the environment',
            kind: 'chosen',
            choices: ['production'],
          },
          { name: 'dns_zone_name', summary: 'the zone of DNS', kind: 'required' },
        ],
        signIn: async () => ({ facts: {}, message: '' }),
      },
    })
    await app.start()
    const frames = screen.frames.join('\n')
    expect(frames).toContain('the zone of DNS')
    expect(frames).toContain('the environment')
  })

  test('the form of a deployment holds the defaults of the templates', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 'n' })
    const app = new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider: azureProvider(),
    })
    await app.start()
    const frames = screen.frames.join('\n')
    expect(frames).toContain('westeurope')
    expect(frames).toContain('example.com')
  })

  test('the deployment that is selected is applied again', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 'a' })
    const app = new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider: azureProvider(),
      deployments: async () =>
        new Map([['development', { name: 'production', accessUrl: 'https://access.example.com' }]]),
    })
    await app.start()
    const frames = screen.frames.join('\n')
    // The form is the form of the deployment that is selected, and it
    // holds the environment of that deployment.
    expect(frames).toContain('the deployment of production again')
    expect(frames).toContain('development')
  })

  test('a deployment that this machine holds no files of is not applied again', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 'a' })
    const app = new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider: azureProvider(),
      deployments: async () => new Map(),
    })
    await app.start()
    const frames = screen.frames.join('\n')
    expect(frames).toContain(
      'the deployment production is applied with the answers of the environment it is named after'
    )
  })
})

/** The letters of a text, as the keys of a reader who types them. */
function typed(text: string): Key[] {
  return [...text].map((char) => ({ kind: 'char', char }) as const)
}

/** The answer of Access that holds one tenant. */
const ONE_TENANT = {
  tenants: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'acme',
      displayName: 'Acme Inc',
      userCount: 1,
      grantCount: 2,
      enabled: true,
    },
  ],
}

/** The environment of a shell that holds the credential of the administration. */
const ADMINISTRATOR = { PLATFORMCTL_ADMIN_TOKEN: 'a-token-of-the-administration' }

describe('the lists of the interface', () => {
  const rows = [
    { id: 'acme', cells: ['acme', 'Acme Inc'] },
    { id: 'globex', cells: ['globex', 'Globex Inc'] },
    { id: 'hooli', cells: ['hooli', 'Hooli Inc'] },
  ]

  test('a filter keeps the rows that hold its text, whatever the case', () => {
    const state = reduce({ ...EMPTY, rows, selection: 2 }, { type: 'filter', text: 'GLOB' })
    expect(visibleRows(state).map((row) => row.id)).toEqual(['globex'])
    expect(state.selection).toBe(0)
  })

  test('the selection stays inside the rows the filter keeps', () => {
    const state = reduce({ ...EMPTY, rows, filter: 'inc' }, { type: 'move', delta: 9 })
    expect(state.selection).toBe(2)
    const one = reduce({ ...EMPTY, rows, filter: 'hooli' }, { type: 'move', delta: 9 })
    expect(one.selection).toBe(0)
  })

  test('a page that is opened holds no row of the page before it', () => {
    const state = reduce(
      { ...EMPTY, columns: ['name'], rows, loaded: true },
      {
        type: 'page',
        page: 'tenants',
      }
    )
    expect(state.rows).toEqual([])
    expect(state.loaded).toBe(false)
    expect(state.title).toBe('the tenants of the deployment')
  })

  test('the reader who goes back reads the title of the page he is on', () => {
    const page = reduce(EMPTY, { type: 'page', page: 'grants' })
    expect(reduce(page, { type: 'back' }).title).toBe('the deployments of the machine')
  })

  test('the reader goes back up the way he came down, and never in a circle', () => {
    const tenants = reduce(EMPTY, { type: 'page', page: 'tenants' })
    const principals = reduce(tenants, { type: 'page', page: 'principals' })
    const grants = reduce(principals, { type: 'page', page: 'grants' })
    expect(reduce(grants, { type: 'back' }).page).toBe('principals')
    // A page the reader has been through is gone back to, and not opened under itself.
    const again = reduce(grants, { type: 'page', page: 'tenants' })
    expect(again.page).toBe('tenants')
    expect(reduce(again, { type: 'back' }).page).toBe('deployments')
  })

  test('a list that is empty says what the reader does about it', () => {
    const frame = viewOf({ ...EMPTY, loaded: true }, { columns: 80, rows: 12 }, false)
    expect(frame).toContain('n creates one')
    const filtered = viewOf(
      { ...EMPTY, columns: ['name', 'title'], rows, filter: 'nobody' },
      { columns: 80, rows: 12 },
      false
    )
    expect(filtered).toContain('esc clears the filter')
  })

  test('the record of a tenant answers to its slug', () => {
    expect(recordOfRow(ONE_TENANT, 'tenants', 'acme')?.displayName).toBe('Acme Inc')
  })
})

describe('the forms of the interface', () => {
  const form = {
    title: 'a form',
    action: 'test',
    focus: 0,
    fields: [
      { name: 'name', label: 'the name', value: 'ac', kind: 'text' as const },
      {
        name: 'secret',
        label: 'the secret',
        value: 'hunter2',
        kind: 'text' as const,
        secret: true,
      },
    ],
  }

  test('the reader writes where the cursor is', () => {
    let state: State = { ...EMPTY, form }
    state = reduce(state, { type: 'cursor', delta: -1 })
    state = reduce(state, { type: 'type', char: 'X' })
    expect(fieldValue(state.form, 'name')).toBe('aXc')
    state = reduce(state, { type: 'erase' })
    expect(fieldValue(state.form, 'name')).toBe('ac')
    state = reduce(state, { type: 'edge', end: false })
    state = reduce(state, { type: 'delete' })
    expect(fieldValue(state.form, 'name')).toBe('c')
    state = reduce(state, { type: 'clear' })
    expect(fieldValue(state.form, 'name')).toBe('')
  })

  test('a secret is not drawn', () => {
    const frame = viewOf({ ...EMPTY, form }, { columns: 80, rows: 16 }, false)
    expect(frame).not.toContain('hunter2')
    expect(frame).toContain('•••••••')
  })

  test('the field the reader is in is drawn, however short the screen', () => {
    const fields = Array.from({ length: 30 }, (_, index) => ({
      name: `f${index}`,
      label: `the field ${index}`,
      value: `value-${index}`,
      kind: 'text' as const,
    }))
    const state: State = {
      ...EMPTY,
      form: { title: 'a long form', action: 'test', focus: 27, fields },
    }
    const frame = viewOf(state, { columns: 80, rows: 14 }, false)
    expect(frame).toContain('value-27')
    expect(frame).toContain('28 of 30')
  })

  test('the value of a field is drawn next to a label that is too long', () => {
    const state: State = {
      ...EMPTY,
      form: {
        title: 'a form',
        action: 'test',
        focus: 0,
        fields: [
          {
            name: 'zone',
            label: 'the zone of DNS that holds the public names of the deployment, for example',
            value: 'example.com',
            kind: 'text' as const,
          },
        ],
      },
    }
    expect(viewOf(state, { columns: 80, rows: 16 }, false)).toContain('example.com')
  })

  test('the log shows its last lines', () => {
    const log = Array.from({ length: 80 }, (_, index) => `line ${index}`)
    const state: State = { ...EMPTY, page: 'create', log, form }
    expect(viewOf(state, { columns: 80, rows: 24 }, false)).toContain('line 79')
    expect(viewOf(state, { columns: 140, rows: 24 }, false)).toContain('line 79')
  })
})

describe('the work of the interface', () => {
  test('the time of a work is read in seconds and in minutes', () => {
    expect(elapsedOf(0, 1000)).toBe('1 second')
    expect(elapsedOf(0, 30_000)).toBe('30 seconds')
    expect(elapsedOf(0, 60_000)).toBe('1 minute')
    expect(elapsedOf(0, 120_000)).toBe('2 minutes')
  })

  test('the status line names the work and the time it has been going on', () => {
    const state: State = {
      ...EMPTY,
      busy: true,
      work: { what: 'the deployment of azure goes on', since: Date.now() - 120_000 },
    }
    const frame = viewOf(state, { columns: 90, rows: 14 }, false)
    expect(frame).toContain('the deployment of azure goes on')
    expect(frame).toContain('2 minutes')
  })

  test('the bar of the keys names the work of the interface', () => {
    const state: State = {
      ...EMPTY,
      busy: true,
      form: {
        title: 'a form',
        action: 'deploy',
        focus: 0,
        fields: [{ name: 'name', label: 'the name', value: 'ac', kind: 'text' }],
      },
      work: { what: 'the answers of the deployment are read', since: Date.now() },
    }
    expect(viewOf(state, { columns: 120, rows: 16 }, false)).toContain(
      'the answers of the deployment are read'
    )
  })

  test('the interface names the work it is at', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const screen = new FakeScreen({ kind: 'char', char: 'n' })
    const app = new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider: azureProvider(),
      // The answers of a deployment take a while: the reader must see
      // that the interface waits for them, and for how long.
      answers: async () => {
        await gate
        return { values: {}, notes: [] }
      },
    })
    const running = app.start()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const frames = screen.frames.join('\n')
    expect(frames).toContain('the answers of the deployment are read')
    release?.()
    await running
  })
})

describe('the parts of a frame', () => {
  test('a panel is as wide as it is told to be', () => {
    for (const line of panelOf('a title that is longer than the panel', ['a line'], 20, 4, false)) {
      expect(visibleLength(line)).toBe(20)
    }
  })

  test('the bar of the keys keeps its last hint and cuts no hint in two', () => {
    const bar = keybarOf(
      [
        ['a', 'the first'],
        ['b', 'the second'],
        ['c', 'the third'],
        ['?', 'keys'],
      ],
      26,
      false
    )
    expect(bar).toBe(' a the first  ? keys')
  })

  test('a message that is longer than the line is read to its end', () => {
    expect(wrapOf('one two three four', 9, 3)).toEqual(['one two', 'three', 'four'])
    const state: State = {
      ...EMPTY,
      message: { kind: 'error', text: 'the credential is missing: set PLATFORMCTL_ADMIN_TOKEN' },
    }
    const frame = viewOf(state, { columns: 40, rows: 12 }, false)
    expect(frame).toContain('PLATFORMCTL_ADMIN_TOKEN')
    expect(frame.split('\n').length).toBe(12)
  })

  test('no line of a frame is wider than the screen', () => {
    const state: State = {
      ...EMPTY,
      page: 'tenants',
      columns: ['slug', 'name'],
      rows: [{ id: 'acme', cells: ['acme', 'Acme Inc'] }],
      detail: ['slug: acme'],
      message: { kind: 'ok', text: 'the tenant is written' },
    }
    for (const columns of [20, 60, 80, 110, 200]) {
      for (const line of viewOf(state, { columns, rows: 20 }, true).split('\n')) {
        expect(visibleLength(line)).toBeLessThanOrEqual(columns)
      }
    }
  })
})

describe('the reader of the interface', () => {
  test('the tenants are the ones of the deployment the reader is on', async () => {
    const http = new FakeHttp(FakeHttp.json(200, ONE_TENANT))
    const screen = new FakeScreen({ kind: 'down' }, { kind: 'char', char: 't' })
    const app = new Interface({
      screen,
      services: servicesOf(http, { staging: { accessUrl: 'https://access.staging.example.com' } }),
      environment: ADMINISTRATOR,
    })
    await app.start()
    expect(http.last.url).toContain('https://access.staging.example.com')
    expect(screen.frames[screen.frames.length - 1]).toContain('the tenants of staging')
  })

  test('the reader comes back to the deployment he was on', async () => {
    const http = new FakeHttp(FakeHttp.json(200, ONE_TENANT), FakeHttp.json(200, ONE_TENANT))
    const screen = new FakeScreen(
      { kind: 'down' },
      { kind: 'char', char: 't' },
      { kind: 'escape' },
      { kind: 'char', char: 't' }
    )
    const app = new Interface({
      screen,
      services: servicesOf(http, { staging: { accessUrl: 'https://access.staging.example.com' } }),
      environment: ADMINISTRATOR,
    })
    await app.start()
    expect(http.requests.length).toBe(2)
    expect(http.last.url).toContain('https://access.staging.example.com')
  })

  test('a page that cannot be read shows no row of another page', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 't' })
    const app = new Interface({ screen, services: servicesOf(new FakeHttp()), environment: {} })
    await app.start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('PLATFORMCTL_ADMIN_TOKEN')
    expect(frame).toContain('the page was not read')
    expect(frame).not.toContain('https://api.example.com')
  })

  test('a key that is not a yes or a no leaves the question where it is', async () => {
    const services = servicesOf(new FakeHttp())
    const screen = new FakeScreen({ kind: 'char', char: 'd' }, { kind: 'char', char: 'x' })
    await new Interface({ screen, services, environment: {} }).start()
    expect(screen.frames[screen.frames.length - 1]).toContain('the profile production is removed')
    expect(Object.keys((await services.profiles.read()).profiles)).toEqual(['production'])
  })

  test('a profile is removed when the reader says yes', async () => {
    const services = servicesOf(new FakeHttp())
    const screen = new FakeScreen({ kind: 'char', char: 'd' }, { kind: 'char', char: 'y' })
    await new Interface({ screen, services, environment: {} }).start()
    expect(Object.keys((await services.profiles.read()).profiles)).toEqual([])
    expect(screen.frames[screen.frames.length - 1]).toContain('n creates one')
  })

  test('a space is a letter of a field that holds a text', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, ONE_TENANT),
      FakeHttp.json(200, {}),
      FakeHttp.json(200, ONE_TENANT)
    )
    const screen = new FakeScreen(
      { kind: 'char', char: 't' },
      { kind: 'char', char: 'n' },
      { kind: 'tab' },
      ...typed('Acme Corp'),
      { kind: 'enter' }
    )
    await new Interface({ screen, services: servicesOf(http), environment: ADMINISTRATOR }).start()
    const written = http.requests[1]
    expect(JSON.stringify(written?.body)).toContain('Acme Corp')
    expect(screen.frames[screen.frames.length - 1]).toContain('the tenant is written')
  })

  test('a form the reader wrote in is not left by one key', async () => {
    const http = new FakeHttp(FakeHttp.json(200, ONE_TENANT))
    const screen = new FakeScreen(
      { kind: 'char', char: 't' },
      { kind: 'char', char: 'n' },
      ...typed('acme'),
      { kind: 'escape' }
    )
    await new Interface({ screen, services: servicesOf(http), environment: ADMINISTRATOR }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('what was written in it is lost?')
    expect(frame).toContain('a new tenant')
  })

  test('the filter of the reader keeps the rows that hold it', async () => {
    const screen = new FakeScreen({ kind: 'char', char: '/' }, ...typed('stag'), { kind: 'enter' })
    const app = new Interface({
      screen,
      services: servicesOf(new FakeHttp(), {
        staging: { gatewayUrl: 'https://staging.example.com' },
      }),
      environment: {},
    })
    await app.start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('https://staging.example.com')
    expect(frame).not.toContain('https://api.example.com')
    expect(frame).toContain('1/1 of 2')
  })
})

describe('the answers the wizard finds by itself', () => {
  const digest = (name: string): string => `ghcr.io/ggpwnkthx/${name}@sha256:${'a'.repeat(64)}`
  const provider = {
    name: 'azure',
    summary: 'Microsoft Azure',
    questions: [
      {
        name: 'environment',
        summary: 'the environment',
        kind: 'chosen' as const,
        choices: ['production', 'staging'],
      },
      { name: 'dns_zone_name', summary: 'the zone of DNS', kind: 'required' as const },
      {
        name: 'gateway_image',
        summary: 'the image of the gateway',
        kind: 'required' as const,
        shape: 'digest' as const,
      },
    ],
    signIn: async () => ({ facts: {}, message: '' }),
  }
  /** The answers of the wizard, as the tests find them. */
  const answers = async (_templates: string, _defaults: unknown, environment?: string) => ({
    values: {
      environment: environment ?? 'production',
      dns_zone_name: `${environment ?? 'production'}.example.com`,
      gateway_image: digest('gateway'),
      operator_addresses: '203.0.113.4/30',
    },
    release: 'v1.0.13',
    notes: ['the digests of the images come from the release v1.0.13'],
  })

  test('the form of a deployment holds the digests of the release', async () => {
    // The form is sent when the answers are found: the enter key waits for them.
    const screen = new FakeScreen({ kind: 'char', char: 'n' }, { kind: 'enter' })
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider,
      answers,
    }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('ghcr.io/ggpwnkthx/gateway@sha256:')
    expect(frame).toContain('203.0.113.4/30')
    expect(frame).toContain('production.example.com')
    expect(frame).toContain('the digests of the images come from the release')
  })

  test('an answer that is found is not written over what the reader wrote', async () => {
    const screen = new FakeScreen(
      { kind: 'char', char: 'n' },
      { kind: 'tab' },
      { kind: 'ctrl', char: 'u' },
      ...typed('mine.example.org'),
      { kind: 'backtab' },
      { kind: 'right' },
      { kind: 'right' },
      { kind: 'enter' }
    )
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider,
      answers,
    }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('‹ staging ›')
    expect(frame).toContain('mine.example.org')
    expect(frame).not.toContain('staging.example.com')
  })

  test('the answers follow the environment the reader names', async () => {
    const screen = new FakeScreen(
      { kind: 'char', char: 'n' },
      { kind: 'right' },
      { kind: 'right' },
      { kind: 'enter' }
    )
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider,
      answers,
    }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('staging.example.com')
    // The digests are the ones of the release, and the question says so.
    expect(frame).toContain('the images of the release v1.0.13?')
  })

  test('the form asks which subscription the deployment is written in', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 'n' }, { kind: 'enter' })
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider,
      answers: async (templates, defaults, environment) => ({
        ...(await answers(templates, defaults, environment)),
        accounts: [
          { id: 'sub-1', name: 'Pay-As-You-Go', current: false },
          { id: 'sub-2', name: 'Esquire Production', current: true },
        ],
      }),
    }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('the subscription the deployment is')
    expect(frame).toContain('2 of 5')
    // The session of the machine answers the question until the reader
    // names another subscription, and the reader says yes to its name.
    expect(frame).toContain('begins in the subscription Esquire Production')
  })

  test('a form that holds only what was found is left by one key', async () => {
    const screen = new FakeScreen(
      { kind: 'char', char: 'n' },
      { kind: 'enter' },
      { kind: 'char', char: 'n' },
      { kind: 'escape' }
    )
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      provider,
      answers,
    }).start()
    expect(screen.frames[screen.frames.length - 1]).toContain('the deployments of the machine')
  })
})

describe('the deployment the interface created', () => {
  const values = {
    name_prefix: 'platform',
    environment: 'development',
    dns_zone_name: 'platform.example.com',
    gateway_name: 'api',
    access_name: 'access',
    data_workspace_id: '22222222-2222-4222-8222-222222222222',
  }

  test('the profile of a deployment is named after it and holds its addresses', () => {
    expect(profileOfDeployment(values, { public_names_enabled: 'true' })).toEqual({
      name: 'platform-development',
      profile: {
        gatewayUrl: 'https://api.platform.example.com',
        accessUrl: 'https://access.platform.example.com',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    })
  })

  test('the address of Access is the one the templates answered', () => {
    const { profile } = profileOfDeployment(values, {
      public_names_enabled: 'false',
      access_issuer: 'https://access.internal.example.net',
    })
    expect(profile.accessUrl).toBe('https://access.internal.example.net')
    // A deployment without public names names no address of the gateway.
    expect(profile.gatewayUrl).toBeUndefined()
  })

  test('the form opens on the deployment that was written last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-runtime-'))
    try {
      for (const [environment, seconds] of [
        ['production', 1_000],
        ['development', 2_000],
      ] as const) {
        const directory = join(root, 'runtime', environment)
        await mkdir(directory, { recursive: true })
        const file = join(directory, 'terraform.tfvars')
        await writeFile(file, `environment = "${environment}"\n`)
        await utimes(file, seconds, seconds)
      }
      expect(await latestOf(join(root, 'azure'))).toBe('development')
      expect(await latestOf(join(root, 'nowhere', 'azure'))).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('the credential of a deployment of the machine', () => {
  const SECRET = 'the-token-the-deployment-created'

  /** The files of a deployment, as the wizard leaves them on the machine. */
  async function deploymentOf(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-held-'))
    const directory = join(root, 'runtime', 'development')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'terraform.tfvars'),
      [
        'name_prefix = "platform"',
        'environment = "development"',
        'dns_zone_name = "platform.example.com"',
        'access_name = "access"',
      ].join('\n')
    )
    return root
  }

  /** The tool, as the tests answer with the outputs of a deployment. */
  const tool = (issuer: string) => ({
    asked: [] as string[],
    async output(_directory: string, run: { backendConfig?: string }) {
      this.asked.push(run.backendConfig ?? '')
      return { access_issuer: issuer, access_admin_token: SECRET }
    },
  })

  test('the credential is read in the state of the deployment of the profile', async () => {
    const root = await deploymentOf()
    try {
      const port = tool('https://access.platform.example.com')
      const held = await heldOf(port, join(root, 'azure'), { name: 'platform-development' })
      expect(held.adminToken).toBe(SECRET)
      expect(held.accessUrl).toBe('https://access.platform.example.com')
      expect(port.asked).toEqual([join(root, 'runtime', 'development', 'backend.hcl')])
      // A profile of another name is the same deployment when it names the same Access.
      const renamed = await heldOf(port, join(root, 'azure'), {
        name: 'dev',
        accessUrl: 'https://access.platform.example.com/',
      })
      expect(renamed.adminToken).toBe(SECRET)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the credential of another deployment is not the credential of this one', async () => {
    const root = await deploymentOf()
    try {
      const other = await heldOf(tool('https://access.other.example.com'), join(root, 'azure'), {
        name: 'platform-development',
        accessUrl: 'https://access.platform.example.com',
      })
      expect(other.adminToken).toBeUndefined()
      expect(other.note).toContain('initialized against')
      const unknown = await heldOf(
        tool('https://access.platform.example.com'),
        join(root, 'azure'),
        {
          name: 'production',
        }
      )
      expect(unknown.adminToken).toBeUndefined()
      expect(unknown.note).toContain('holds no files')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the interface asks Access with the credential the deployment holds, and never draws it', async () => {
    const http = new FakeHttp(FakeHttp.json(200, ONE_TENANT), FakeHttp.json(200, ONE_TENANT))
    const screen = new FakeScreen({ kind: 'char', char: 't' }, { kind: 'char', char: 'r' })
    let asked = 0
    await new Interface({
      screen,
      services: servicesOf(http),
      environment: {},
      held: async () => {
        asked += 1
        return { adminToken: SECRET }
      },
    }).start()
    expect(http.requests[0]?.token).toBe(SECRET)
    // The credential is read once, and the pages that follow hold it.
    expect(asked).toBe(1)
    expect(screen.frames.join('\n')).not.toContain(SECRET)
    expect(screen.frames[screen.frames.length - 1]).toContain('acme')
  })

  test('a deployment that answers no credential says why', async () => {
    const screen = new FakeScreen({ kind: 'char', char: 't' })
    await new Interface({
      screen,
      services: servicesOf(new FakeHttp()),
      environment: {},
      held: async () => ({ note: 'this machine holds no files of a deployment named production' }),
    }).start()
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('holds no files of a deployment named production')
    expect(frame).toContain('PLATFORMCTL_ADMIN_TOKEN')
  })
})

describe('a principal and its grants', () => {
  const ALICE = '22222222-2222-4222-8222-222222222222'
  const alice = { id: ALICE, tenant: 'acme', email: 'alice@acme.example', displayName: 'Alice' }
  const grant = {
    id: '33333333-3333-4333-8333-333333333333',
    tenant: 'acme',
    userId: ALICE,
    permission: 'workspace.read',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    routeId: 'data-api',
    grantedBy: 'ops@example.com',
  }

  test('a field offers what the interface knows, and one key takes it', () => {
    const form = {
      title: 'a form',
      action: 'test',
      focus: 0,
      fields: [
        {
          name: 'permission',
          label: 'the permission',
          value: 'work',
          kind: 'text' as const,
          suggestions: ['console.admin', 'workspace.read'],
        },
      ],
    }
    const frame = viewOf({ ...EMPTY, form }, { columns: 80, rows: 14 }, false)
    expect(frame).toContain('→ takes workspace.read')
    const taken = reduce({ ...EMPTY, form }, { type: 'accept' })
    expect(fieldValue(taken.form, 'permission')).toBe('workspace.read')
    // A field that holds one of the values offers nothing more.
    expect(reduce(taken, { type: 'accept' })).toBe(taken)
  })

  test('the principals and the grants are the ones of what the reader is on', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, ONE_TENANT),
      FakeHttp.json(200, { principals: [alice] }),
      FakeHttp.json(200, { grants: [grant] })
    )
    const screen = new FakeScreen(
      { kind: 'char', char: 't' },
      { kind: 'char', char: 'p' },
      { kind: 'char', char: 'g' }
    )
    await new Interface({ screen, services: servicesOf(http), environment: ADMINISTRATOR }).start()
    expect(http.requests[1]?.url).toContain('tenant=acme')
    expect(http.requests[2]?.url).toContain(`userId=${ALICE}`)
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('the grants of alice@acme.example')
    // The grant names its principal by the address the reader knows.
    expect(frame).toContain('workspace.read')
    expect(screen.frames.join('\n')).toContain('the principals of acme')
  })

  test('a principal is registered and given its first grant without a word typed twice', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, ONE_TENANT),
      FakeHttp.json(200, { principals: [] }),
      FakeHttp.json(200, alice),
      FakeHttp.json(200, { principals: [alice] }),
      FakeHttp.json(200, { grants: [] }),
      FakeHttp.json(200, grant),
      FakeHttp.json(200, { grants: [grant] })
    )
    const screen = new FakeScreen(
      { kind: 'char', char: 't' },
      { kind: 'char', char: 'p' },
      { kind: 'char', char: 'n' },
      // The tenant is the one the reader is in: the form begins after it.
      ...typed('00u1a2b3'),
      { kind: 'tab' },
      ...typed('alice@acme.example'),
      { kind: 'enter' },
      // The interface asks for the first grant of the principal.
      { kind: 'char', char: 'y' },
      ...typed('workspace.read'),
      { kind: 'tab' },
      { kind: 'tab' },
      ...typed('data-api'),
      { kind: 'enter' }
    )
    await new Interface({ screen, services: servicesOf(http), environment: ADMINISTRATOR }).start()
    const registered = JSON.parse(http.requests[2]?.body ?? '{}')
    expect(registered).toMatchObject({ tenant: 'acme', externalSubject: '00u1a2b3' })
    const given = JSON.parse(http.requests[5]?.body ?? '{}')
    expect(given).toMatchObject({
      tenant: 'acme',
      userId: ALICE,
      permission: 'workspace.read',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      routeId: 'data-api',
    })
    const frame = screen.frames[screen.frames.length - 1] ?? ''
    expect(frame).toContain('the grant is written')
    expect(frame).toContain('the grants of alice@acme.example')
    expect(frame).toContain('alice@acme.example')
  })
})
