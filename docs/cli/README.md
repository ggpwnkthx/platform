# Command line

`platformctl` is the platform's command line: operators and developers use it to check a deployment, publish route tables, administer Access and work with workspace records. This page explains what it is and where to read next.

## What it does

The CLI is a client of the gateway, Access and Data. It sends a service a request and shows the service's answer. It holds no policy of its own, never reaches a database, and has no dependency beyond the Bun runtime.

It has two kinds of commands, told apart by what they touch:

| Kind | Talks to | Examples |
| --- | --- | --- |
| Client commands | The services' HTTP contracts | `platformctl data items list notes`, `platformctl access grants put …` |
| Deployment operator commands | The deployment's state, from the operator's machine | `platformctl routes apply ./routes.json` |

Operator commands use the same kind of contract as client commands. Gateway administration is the control plane, a separate process, and the CLI is one of its clients like any other.

## Where it sits

```text
platformctl ──> gateway ──> Data          data commands, with the caller's token
            ──> control plane             routes, sessions
            ──> Access                    login, whoami, access commands
```

## Command groups

| Group | Covers |
| --- | --- |
| `context` | Deployment profiles and the CLI's own files |
| `routes` | The gateway's route table, through its control plane |
| `sessions` | Callers' sessions and their cached decisions |
| `access` | Access tenants, principals, grants, groups, roles, audit and decisions |
| `data` | A workspace's records, model and audit |

The root commands are `login`, `logout`, `whoami`, `status`, `version` and `doctor`.

## Key concepts

| Concept | Meaning | Defined in |
| --- | --- | --- |
| Profile | The addresses, workspace, tenant and client of one deployment, stored on your machine | [spec §3](spec.md#3-profiles) |
| Credential | Your token after `platformctl login`, readable only by you | [spec §4](spec.md#4-sign-in) |
| Exit status | A number from `0` to `8` that tells a script what happened | [spec §6.2](spec.md#62-exit-status) |

## Find your way

| To | Read |
| --- | --- |
| Install it, set up a profile, sign in, script it | [Usage](usage.md) |
| Know every command, option, format and exit status | [Specification](spec.md) |
| Change its code | [Workspace README](../../packages/cli/README.md) |

From a checkout of the repository, try it with:

```bash
bun run --cwd packages/cli status
bun run --cwd packages/cli --help
```

The published binary carries the runtime inside it and needs nothing else; see [Usage](usage.md#install).

## Status

Version 1.0.0. The code lives in [`packages/cli/`](../../packages/cli/).
