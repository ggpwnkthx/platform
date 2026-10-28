# Console

The platform's web interface: people read and change workspace data, operators administer access, and anyone can check service status. It is a client of the gateway, access service and data service; it reaches no database and decides nothing.

The workspace is [`packages/console/`](../../packages/console/), a [HonoX](https://github.com/honojs/honox) app rendered on the server and built with Vite. Interactive parts of a page are HonoX islands.

It has five places: **overview**, **workspaces**, **operators**, **status** and **documentation**.

## Start here

| You want to | Read |
| --- | --- |
| See what each page shows | [Places](spec.md#62-places) |
| Know how the docs are served | [Documentation](spec.md#64-documentation) |
| Review the console | [Specification](spec.md), then [Security](security.md) |
| Deploy it | [Operations](operations.md) |
| Develop it | [Workspace README](../../packages/console/README.md) |

## Pages

| Page | What it covers |
| --- | --- |
| [spec.md](spec.md) | **Normative contract**: requests, sessions, operator scope, pages. Change this first when behavior changes. |
| [security.md](security.md) | Credentials the console holds and never holds, and where trust stops |
| [operations.md](operations.md) | Environment, deployment, probes, secret rotation |
| [CHANGELOG.md](../../CHANGELOG.md) | Platform releases and each one's contract changes |

A `§N` reference in code, tests or these pages points to a section of [spec.md](spec.md).

No other program depends on a console contract: every answer it shows comes from a service, under that service's spec.
