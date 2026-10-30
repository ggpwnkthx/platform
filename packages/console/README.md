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
│   │   ├── ability/        what the console shows, from scope and grants
│   │   ├── access/         Access administration and access context
│   │   ├── authentication/ sign-in at Access (code flow, PKCE, ID token)
│   │   ├── data/           workspace data through the gateway; form values
│   │   ├── documentation/  platform docs: the tree and its URLs
│   │   ├── operators/      operator scope, user rights
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

Islands: the status board (re-polls probes), the platform map, the list filter builder, the chip picker (group members, role permissions, the holder of a right), the grant form, the JSON field, the data access clock, the theme switch, confirmation of irreversible actions, copy-ID, and the copy buttons on documentation code blocks.

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
