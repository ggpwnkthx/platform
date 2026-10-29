# Command line

`platformctl` is the command line of the platform. It is a client of the
gateway, Access and Data: it asks a service a question, and it shows the
answer the service gave. It holds no policy of its own, and it never
reaches a database.

The CLI has two faces, and they are told apart by what they touch:

| Face | What it talks to | Examples |
| --- | --- | --- |
| Client commands | The HTTP contracts of the services | `platformctl data items list notes`, `platformctl access grants put …` |
| Operator commands of a deployment | The state of the deployment, from the machine of the operator | `platformctl routes apply ./routes.json` |

Every command of the second face goes through the same contracts as the
first one: the administration of the gateway is the control plane, a
process of its own, and the CLI is one of its clients like any other.

## Reading path

1. [Specification](spec.md) — the commands, the answer, the statuses of the process, the safety of a write.
2. [Operations](operations.md) — the profiles, the login, the everyday work of an operator.

## The groups

| Group | What it holds |
| --- | --- |
| `context` | The profiles of the deployments and the files of the CLI |
| `routes` | The route table of the gateway, through its control plane |
| `sessions` | The sessions of the callers and the decisions they wait for |
| `access` | The tenants, the principals, the grants, the roles and the decisions of Access |
| `data` | The records, the model and the audit of a workspace |

The commands of the root are `login`, `logout`, `whoami`, `status`,
`version` and `doctor`.

## A first run

```bash
bun run --cwd packages/cli status
bun run --cwd packages/cli --help
```

The published binary carries the runtime inside it and needs nothing
else: see [Operations](operations.md).
