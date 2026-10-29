# Operations

Using the command line against a deployment: where it comes from, how a
profile is written, how a caller signs in, and what an operator does
with it. The behavior it has is in the [specification](spec.md).

## Where it comes from

The release of the platform publishes the CLI as an archive of its own,
for every supported platform. The archive carries the runtime inside it,
and it needs nothing else.

```bash
curl -sSLO https://github.com/ggpwnkthx/platform/releases/download/v1.0.0/platformctl-1.0.0-linux-x64.tar.gz
tar -xzf platformctl-1.0.0-linux-x64.tar.gz
install platformctl-1.0.0-linux-x64/platformctl /usr/local/bin/platformctl
platformctl --help
```

In the repository, the CLI runs from the sources:

```bash
bun run cli --help
```

Its binary is built with `bun run --cwd packages/cli build`, and it lands in `dist/platformctl`.

## The first profile

A profile names a deployment. It is written once, and the environment
of the shell overrides it.

```bash
platformctl context set production \
  --gateway-url https://api.example.com \
  --control-url https://control.internal.example.com \
  --access-url https://access.example.com \
  --workspace 11111111-1111-4111-8111-111111111111 \
  --client-id platform \
  --use

platformctl context show
```

The secret of the client is a secret: it is given to the command in the
shell of the operator, it is written in the file of the profiles, and it
is never printed by the CLI.

The file of the profiles lives in `${XDG_CONFIG_HOME:-$HOME/.config}/platformctl/config.json`.
The path is shown by `platformctl context paths`.

## The first login

The login opens the page of the provider, and the provider sends the
caller back to an address of the machine. That address has to be allowed
by the tenant, and it is named by `PLATFORMCTL_REDIRECT_URI`.

```bash
export PLATFORMCTL_REDIRECT_URI=http://127.0.0.1:8765/oauth/callback
platformctl login --tenant acme
platformctl whoami
```

The credential is kept in the file of the state of the machine, in a
file only its owner can read, and `platformctl logout` removes it.

A script authenticates itself with a token instead, and never opens a
browser:

```bash
export PLATFORMCTL_TOKEN="$(cat ./token)"
platformctl data items list notes --output json
```

## The everyday work

| Task | Command |
| --- | --- |
| Is the deployment answering? | `platformctl status` |
| What is broken in my setup? | `platformctl doctor` |
| Which revision of the route table is active? | `platformctl routes get` |
| Does my table pass the validation? | `platformctl routes validate ./routes.json` |
| Publish a route table | `platformctl routes apply ./routes.json` |
| Go back to the previous revision | `platformctl routes rollback 7` |
| End the sessions of a compromised account | `platformctl sessions revoke --subject alice@gateway.test` |
| Give a principal a permission | `platformctl access grants put --tenant acme --user-id b1c2 --permission workspace.read` |
| Why is a caller refused? | `platformctl access decide --subject 00u1a2b3c4d5 --workspace acme` |
| Read the records of a collection | `platformctl data items list notes --limit 20` |
| Change a record | `platformctl data items update notes r1 --body ./record.json --etag '"7"'` |

Every command that changes something asks before it changes, and
`--yes` answers for the operator who is not there to answer.

## The credentials of the services

| Credential | The variable that names it | The commands that use it |
| --- | --- | --- |
| The control plane | `PLATFORMCTL_CONTROL_TOKEN` | `routes`, `sessions` |
| The administration of Access | `PLATFORMCTL_ADMIN_TOKEN` | `access` |
| The decision | `PLATFORMCTL_ADMIN_TOKEN`, or `--decision-token` | `access decide` |
| The caller | The credential of the machine, or `PLATFORMCTL_TOKEN` | `data` |

The scopes of the control plane are not a hierarchy: a token that may
operate may not write the route table, and a token that may write it may
not purge a session. The CLI never retries with another credential, and
a refusal of the scope is a status of its own.

## In a script

```bash
set -euo pipefail

platformctl --output json access grants list --tenant acme \
  | jq -r '.grants[] | select(.revokedAt == null) | .id'
```

The status of the process tells the script what happened: `3` is a
credential that is no longer valid, `5` is a thing that changed under
the command, and `7` is a service that could not be reached.

## When something refuses

| The refusal | What it means | What to do |
| --- | --- | --- |
| `the credential of the control plane is missing` | The variable is not set | Set `PLATFORMCTL_CONTROL_TOKEN` |
| `the caller is not signed in` | There is no credential on this machine | Run `platformctl login`, or set `PLATFORMCTL_TOKEN` |
| `the credential of the caller is no longer valid` | The token expired | Run `platformctl login` again |
| `the workspace is not named` | No workspace in the profile and none in the command | Pass `--workspace` |
| `the address of the callback is missing` | The tenant cannot be reached by the login | Set `PLATFORMCTL_REDIRECT_URI` and allow it in the tenant |
| `the active revision is not the expected one` | The route table moved under the write | Read the revision again, then write |
| `the service cannot be reached` | The network or the service is down | Check `platformctl status` |
