# Console

The platform's web interface: people read and change workspace data, operators administer access, and anyone can check service status. It is a client of the gateway, Access and Data; it reaches no database and decides nothing.

## Concepts

- **Places.** Five: overview, workspaces, operators, status and documentation. What each shows and calls: [spec §6.2](spec.md#62-places).
- **Session.** The browser holds only a signed session identifier; the caller's token stays on the server ([spec §3](spec.md#3-sessions)).
- **Operator scope.** The keys `console.status`, `console.admin` and `console.platform`, read from Access on every page ([spec §4](spec.md#4-operator-scope)).
- **Ability.** What the console shows mirrors what the services allow: it may hide an action, never grant one ([spec §5](spec.md#5-ability)).
- **Documentation.** The console serves this `docs/` tree from its build ([spec §6.4](spec.md#64-documentation)).

The workspace is [`packages/console/`](../../packages/console/), a [HonoX](https://github.com/honojs/honox) app rendered on the server and built with Vite; interactive parts are islands. A `§N` reference in code, tests or these pages points to a section of [spec.md](spec.md).

## Next

| To | Read |
| --- | --- |
| Try it locally | [Quickstart](../platform/quickstart.md) |
| Deploy it, and see which credentials it holds | [Operations](operations.md) |
| Know exactly what it does and refuses | [Specification](spec.md) |
| Change its code | [Workspace README](../../packages/console/README.md) |

No other program depends on a console contract: every answer it shows comes from a service, under that service's spec.
