# Console

The console's code workspace: its layout, the rules that keep it in shape, and the commands maintainers run. What the console does and how to deploy it is in [`docs/console/`](../../docs/console/README.md).

It is a [HonoX](https://github.com/honojs/honox) app: routes are files, pages render on the server with `hono/jsx`, interactive parts are islands, and Vite builds it.

## Layout

```text
packages/console/
├── vite.config.ts        build: client (dist/static) and server (dist/server)
├── Dockerfile            image: the build and the process, nothing else
├── scripts/architecture.ts
├── scripts/documentation.ts  reads the platform docs into the build
├── src/
│   ├── main.ts           process: serves the build, or the sources through Vite
│   ├── runtime/          composition: configuration, logging, client composition
│   ├── domains/          core rules: no HonoX, no pages
│   │   ├── ability/        what the caller may do: the rules and their reasons
│   │   ├── access/         Access administration and access context
│   │   ├── authentication/ sign-in at Access (code flow, PKCE, ID token)
│   │   ├── data/           workspace data through the gateway; form values
│   │   ├── documentation/  platform docs: the tree and its URLs
│   │   ├── operators/      operator scope, rights, what a permission opens and where
│   │   ├── session/        sessions and pending logins
│   │   ├── status/         service probes
│   │   ├── map/            platform map (the atlas facts)
│   │   └── transport/      call timeouts and failures
│   └── app/              wiring and interface
│       ├── server.ts       HonoX application
│       ├── client.ts       browser script: hydrates the islands
│       ├── style.css       stylesheet: the atlas palette, light and dark
│       ├── routes/         pages, one file per route
│       ├── islands/        interactive parts of pages
│       ├── components/     page building blocks
│       └── middleware/     session, scope, guards, form handling
└── test/
```

| Directory | Holds |
| --- | --- |
| `src/domains/` | Rules: ability, access, authentication, data, documentation, operators, session, status, map. |
| `src/app/` | Wiring: routes, middleware, components, islands. |
| `src/runtime/` | Composition: configuration, services, logging. |

A domain holds rules and never transport; the app holds routes and never rules. The core imports neither the interface nor HonoX. `bun run architecture` rejects imports that break this direction, and CI runs it.

Islands: the status board (re-polls probes), the platform map, the list filter builder, the chip picker (group members, the groups of a user, role permissions), the grant form (who, what, where, until, and what the right opens there), the JSON field, the data access clock, the theme switch, confirmation of irreversible actions, copy-ID, and the copy buttons on documentation code blocks.

## Showing what the caller may do

A page never decides what to show with a condition of its own. It asks the ability (`src/domains/ability/`), which is built with [CASL](https://casl.js.org/) from what the services answered, and it draws the answer with the pieces of `src/app/components/why.tsx`:

| To | Use |
| --- | --- |
| Ask whether the caller may, and why not | `ability.can(action, subject)` and `reasonOf(ability, action, subject)`: the reason is the one of the rule that decides. |
| Ask about one thing | `tenantOf(slug)` and `permissionOf(key)` name a tenant and a permission with the facts a rule reads. |
| Draw an action | `ActionLink`, or `Can` with `DisabledAction`: a link when the action is allowed, the same control disabled with its reason when it is not. |
| Draw a list of yes and no | `Capabilities`, from `consoleCapabilitiesOf` or `workspaceCapabilitiesOf`. |
| Close a tab | The `locked` reason of a tab (`Tabs`, `WorkspaceTabs`). |
| Refuse a form | The same question again in the handler: the page that receives a form trusts no form. |

A new rule goes in the domain, with its reason and a test; a page that needs it asks for it by name. The rule is an upper bound and the services decide ([spec §5](../../docs/console/spec.md#5-ability)): draw a refusal, do not hide one.

## Decisions

The console takes no decisions of its own. As a client, its decisions are those of the services it talks to, recorded in the [platform decisions](../../docs/platform/decisions.md) and the [gateway decisions](../../docs/gateway/decisions.md).

## Commands

```bash
bun run build          # dist/
bun run start          # src/main.ts
bun run test           # core, and the build against fake contracts
bun run typecheck
bun run architecture   # core imports neither the interface nor HonoX
```

For development, run `bun run dev` at the repository root: it starts the platform with the console from source, so page edits show on the next load. Environment: [`.env.example`](.env.example) and [console configuration](../../docs/console/configuration.md).
