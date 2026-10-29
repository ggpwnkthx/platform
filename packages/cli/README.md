# Command line

The CLI's code workspace: its layout, its import rules and the commands maintainers run. What the CLI does and how to use it is in [`docs/cli/`](../../docs/cli/README.md).

The program is `platformctl`, a client of the gateway, Access and Data that sends a request and shows the answer. It has no policy of its own, no database access and no dependency beyond the runtime.

## Layout

```text
packages/cli/
├── scripts/architecture.ts
├── src/
│   ├── main.ts           process: reads the command line, exits with the command's status
│   ├── runtime/          command registry, port composition, version
│   │   ├── commands/        one file per command group
│   │   ├── env.ts           shell environment and the machine's file paths
│   │   ├── services.ts      the ports a command receives
│   │   └── version.ts       the program's version
│   ├── app/              interface
│   │   ├── cli.ts           dispatcher: finds the command and runs it
│   │   ├── args.ts          command-line parsing
│   │   ├── commands.ts      the shape of a command
│   │   ├── help.ts          help for the CLI, a group and a command
│   │   ├── output.ts        output formats: table, json, yaml
│   │   └── prompt.ts        confirmation before a write
│   ├── domains/          core: no sockets, no files, no output of its own
│   │   ├── contracts.ts     the core's ports
│   │   ├── context.ts       deployment profiles and their resolution
│   │   ├── identity.ts      login, the caller's claims
│   │   ├── gateway.ts       the gateway's control plane
│   │   ├── access.ts        Access administration and decisions
│   │   ├── data.ts          a workspace's records and model
│   │   ├── status.ts        service probes
│   │   ├── answer.ts        service answers and refusals
│   │   └── failure.ts       command failures and exit statuses
│   └── platform/         adapters implementing the core's ports
│       ├── http.ts          transport, and the dry-run transport
│       ├── files.ts         the machine's profiles and credential
│       ├── callback.ts      the local server that waits for the provider's redirect
│       ├── browser.ts       the machine's browser
│       └── crypto.ts        randomness for the login
└── test/
```

The core imports neither the interface nor the adapters, and no module is in an import cycle. `packages/cli/scripts/architecture.ts` checks this with the same engine as the console.

## Commands

```bash
bun run start          # src/main.ts
bun run build          # a single binary in dist/
bun run cli            # from the repository root
bun run test
bun run typecheck
bun run architecture   # the core imports neither the interface nor the adapters
```

The CLI's environment variables all carry its own prefix: `PLATFORMCTL_GATEWAY_URL`, `PLATFORMCTL_CONTROL_URL`, `PLATFORMCTL_ACCESS_URL`, `PLATFORMCTL_WORKSPACE_ID`, `PLATFORMCTL_TENANT_ID`, `PLATFORMCTL_CLIENT_ID`, `PLATFORMCTL_CLIENT_SECRET`, `PLATFORMCTL_REDIRECT_URI`, `PLATFORMCTL_CONTROL_TOKEN`, `PLATFORMCTL_ADMIN_TOKEN`, `PLATFORMCTL_TOKEN`, `PLATFORMCTL_PROFILE` and `PLATFORMCTL_TIMEOUT_MS`. Their meanings are in [spec §3](../../docs/cli/spec.md#3-profiles).
