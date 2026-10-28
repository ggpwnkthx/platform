# The console

The interface of the platform: the web application in which people read
and change the data of their workspaces, operators administer the access
service, and anybody reads the state of the services. It is a **client**
of the gateway, the access service and the data service, and it decides
nothing.

It is an application of [HonoX](https://github.com/honojs/honox): the
routes are files, the pages are rendered on the server with `hono/jsx`,
and the parts of a page that live in the browser are islands. Vite builds
it.

The documentation is in [`docs/console/`](../../docs/console/README.md).

## The layout

```
packages/console/
├── vite.config.ts        the build: the client (dist/static) and the server (dist/server)
├── Dockerfile            the image: the build and the process, and nothing else
├── scripts/architecture.ts
├── scripts/documentation.ts  the build reads the documentation of the platform
├── src/
│   ├── main.ts           the process: it serves the build, or the sources through Vite
│   ├── runtime/          the configuration, the log and the composition of the clients
│   ├── domains/          the core: no HonoX, no page
│   │   ├── access/         the administration and the access context of the access service
│   │   ├── authentication/ the sign-in at the access service (code flow, PKCE, id token)
│   │   ├── data/           the data of a workspace, through the gateway; the values of a form
│   │   ├── documentation/  the documentation of the platform: the tree and the urls of it
│   │   ├── operators/      the scope of an operator, the rights of a user
│   │   ├── session/        the sessions and the logins in flight
│   │   ├── status/         the probes of the services
│   │   ├── map/            the map of the platform (the facts of the atlas)
│   │   └── transport/      the budget and the failures of a call
│   └── app/              the interface
│       ├── server.ts       the application of HonoX
│       ├── client.ts       the script of the browser: it hydrates the islands
│       ├── style.css       the sheet: the palette of the atlas, light and dark
│       ├── routes/         the pages, one file per route
│       ├── islands/        the parts of a page that live in the browser
│       ├── components/     the pieces of the pages
│       └── middleware/     the session, the scope, the guards and the forms of a request
└── test/
```

The islands are the status board that reads the probes again, the map of
the platform, the filter builder of a list, the picker of the members of
a group, the field of json, the clock of the access to the data, the
theme, the confirmation of an act that cannot be undone and the copy of
an identifier.

## The commands

```bash
bun run build          # dist/
bun run start          # src/main.ts
bun run test           # the core, and the build against fakes of the contracts
bun run typecheck
bun run architecture   # the core imports neither the interface nor HonoX
```

On a development machine, `bun run dev` at the root of the repository
starts the platform and the console with it, from the sources: a change
of a page is the page you read next. The environment is in
[`.env.example`](.env.example) and in
[the operations](../../docs/console/operations.md).
