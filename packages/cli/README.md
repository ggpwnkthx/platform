# Command line

The platform's command line workspace. What the CLI does is in [`docs/cli/`](../../docs/cli/README.md); this page covers the code.

The program is `platformctl`. It is a client of the gateway, Access and Data: it asks, and it shows the answer. It holds no policy of its own, it never reaches a database, and it has no dependency beyond the runtime.

## Layout

```
packages/cli/
├── scripts/architecture.ts
├── src/
│   ├── main.ts           process: reads the words of the reader, ends with the status of the command
│   ├── runtime/          the commands of the registry, the composition of the ports, the version
│   │   ├── commands/        one file per group of commands
│   │   ├── env.ts           the environment of the shell and the files of the machine
│   │   ├── services.ts      the ports of a command
│   │   └── version.ts       the version of the program
│   ├── app/              interface
│   │   ├── cli.ts           the dispatcher: finds the command and answers it
│   │   ├── args.ts          the reading of the words of the reader
│   │   ├── commands.ts      the shape of a command
│   │   ├── help.ts          the help of the CLI, of a group and of a command
│   │   ├── output.ts        the formats of the answer: table, json, yaml
│   │   └── prompt.ts        the confirmation of a write
│   ├── domains/          core: no sockets, no files, no answers of their own
│   │   ├── contracts.ts     the ports of the core
│   │   ├── context.ts       the profiles of the deployments and their resolution
│   │   ├── identity.ts      the login, the claims of the caller
│   │   ├── gateway.ts       the control plane of the gateway
│   │   ├── access.ts        the administration and the decisions of Access
│   │   ├── data.ts          the records and the model of a workspace
│   │   ├── status.ts        the probes of the services
│   │   ├── answer.ts        the answers of the services and their refusals
│   │   └── failure.ts       the failure of a command and the status of the process
│   └── platform/         adapters implementing the ports of the core
│       ├── http.ts          the transport, and the transport of a dry run
│       ├── files.ts         the profiles and the credential of the machine
│       ├── callback.ts      the server that waits for the answer of the provider
│       ├── browser.ts       the browser of the machine
│       └── crypto.ts        the randomness of the login
└── test/
```

The core imports neither the interface nor the adapters, and no module is in an import cycle: `packages/cli/scripts/architecture.ts` checks it with the same engine as the console.

## Commands

```bash
bun run start          # src/main.ts
bun run build          # a single binary in dist/
bun run cli            # from the root of the repository
bun run test
bun run typecheck
bun run architecture   # the core imports neither the interface nor the adapters
```

The environment of the CLI carries its own name: `PLATFORMCTL_GATEWAY_URL`, `PLATFORMCTL_CONTROL_URL`, `PLATFORMCTL_ACCESS_URL`, `PLATFORMCTL_WORKSPACE_ID`, `PLATFORMCTL_CLIENT_ID`, `PLATFORMCTL_CLIENT_SECRET`, `PLATFORMCTL_REDIRECT_URI`, `PLATFORMCTL_CONTROL_TOKEN`, `PLATFORMCTL_ADMIN_TOKEN`, `PLATFORMCTL_TOKEN`, `PLATFORMCTL_PROFILE` and `PLATFORMCTL_TIMEOUT_MS`.
