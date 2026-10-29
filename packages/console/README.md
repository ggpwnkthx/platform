# Console

The platform's web interface workspace. What the console does and how to deploy it is in [`docs/console/`](../../docs/console/README.md); this page covers the code.

It is a [HonoX](https://github.com/honojs/honox) app: routes are files, pages render on the server with `hono/jsx`, interactive parts are islands, and Vite builds it.

## Layout

```
packages/console/
├── vite.config.ts        build: client (dist/static) and server (dist/server)
├── Dockerfile            image: the build and the process, nothing else
├── scripts/architecture.ts
├── scripts/documentation.ts  reads the platform docs into the build
├── src/
│   ├── main.ts           process: serves the build, or the sources through Vite
│   ├── runtime/          configuration, logging, client composition
│   ├── domains/          core: no HonoX, no pages
│   │   ├── access/         Access administration and access context
│   │   ├── authentication/ sign-in at Access (code flow, PKCE, ID token)
│   │   ├── data/           workspace data through the gateway; form values
│   │   ├── documentation/  platform docs: the tree and its URLs
│   │   ├── operators/      operator scope, user rights
│   │   ├── session/        sessions and pending logins
│   │   ├── status/         service probes
│   │   ├── map/            platform map (the atlas facts)
│   │   └── transport/      call timeouts and failures
│   └── app/              interface
│       ├── server.ts       HonoX application
│       ├── client.ts       browser script: hydrates the islands
│       ├── style.css       stylesheet: the atlas palette, light and dark
│       ├── routes/         pages, one file per route
│       ├── islands/        interactive parts of pages
│       ├── components/     page building blocks
│       └── middleware/     session, scope, guards, form handling
└── test/
```

Islands: the status board (re-polls probes), the platform map, the list filter builder, the group member picker, the JSON field, the data access clock, the theme switch, confirmation of irreversible actions, copy-ID, and the copy buttons of the code blocks of the documentation.

## Commands

```bash
bun run build          # dist/
bun run start          # src/main.ts
bun run test           # core, and the build against fake contracts
bun run typecheck
bun run architecture   # core imports neither the interface nor HonoX
```

For development, run `bun run dev` at the repository root: it starts the platform with the console from source, so page edits show on the next load. Environment: [`.env.example`](.env.example) and [console operations](../../docs/console/operations.md).
