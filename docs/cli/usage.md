# Usage

How to use `platformctl` against a deployment: install it, write your first profile, sign in, do everyday operator work, use it from scripts, and fix common refusals. It is for operators and developers; the exact behavior is in the [specification](spec.md).

## Install

Each platform release publishes the CLI as its own archive for every supported platform. The archive carries the runtime, so it needs nothing else.

```bash
curl -sSLO https://github.com/ggpwnkthx/platform/releases/download/v1.0.0/platformctl-1.0.0-linux-x64.tar.gz
tar -xzf platformctl-1.0.0-linux-x64.tar.gz
install platformctl-1.0.0-linux-x64/platformctl /usr/local/bin/platformctl
platformctl --help
```

In the repository, run the CLI from source:

```bash
bun run cli --help
```

To build the binary yourself, run `bun run --cwd packages/cli build`; it lands in `dist/platformctl`.

## Write your first profile

A profile records a deployment's addresses once; the shell environment can override any of them later ([spec §3](spec.md#3-profiles)).

1. Write the profile and make it current with `--use`:

   ```bash
   platformctl context set production \
     --gateway-url https://api.example.com \
     --control-url https://control.internal.example.com \
     --access-url https://access.example.com \
     --workspace 11111111-1111-4111-8111-111111111111 \
     --client-id platform \
     --use
   ```
2. Check what the CLI resolved:

   ```bash
   platformctl context show
   ```

Pass the client secret with `--client-secret` from your own shell. The CLI stores it in the profiles file and never prints it. Settings you leave out of a later `context set` keep their earlier values.

The profiles file is `${XDG_CONFIG_HOME:-$HOME/.config}/platformctl/config.json`; `platformctl context paths` shows the exact path on your machine.

## Sign in

The login opens your provider's page in a browser, and the provider sends you back to an address on your machine. Your tenant must allow that address; set it with `PLATFORMCTL_REDIRECT_URI` (or `--redirect-uri`, or in the profile).

```bash
export PLATFORMCTL_REDIRECT_URI=http://127.0.0.1:8765/oauth/callback
platformctl login --tenant acme
platformctl whoami
```

On a machine without a browser, add `--print-url`: the CLI prints the login address for you to open elsewhere.

The CLI stores your credential in a file only you can read. Run `platformctl logout` to remove it.

Scripts authenticate with a token instead and never open a browser:

```bash
export PLATFORMCTL_TOKEN="$(cat ./token)"
platformctl data items list notes --output json
```

## Everyday work

| Task | Command |
| --- | --- |
| Is the deployment answering? | `platformctl status` (add `--watch` to repeat every five seconds) |
| What is wrong with my setup? | `platformctl doctor` |
| Which route table revision is active? | `platformctl routes get` |
| Does my table pass validation? | `platformctl routes validate ./routes.json` |
| Publish a route table | `platformctl routes apply ./routes.json` |
| Go back to an earlier revision | `platformctl routes rollback 7` |
| End the sessions of a compromised account | `platformctl sessions revoke --subject alice@gateway.test` |
| Give a principal a permission | `platformctl access grants put --tenant acme --user-id b1c2 --permission workspace.read` |
| Find out why a caller is refused | `platformctl access decide --subject <principal id> --workspace <workspace id>` (the subject is the principal row id, not the provider subject) |
| Read the records of a collection | `platformctl data items list notes --limit 20` |
| Change a record | `platformctl data items update notes r1 --body ./record.json --etag '"7"'` |

Every command that changes something asks before it acts. Pass `--yes` when no one is there to answer, and `--dry-run` to see the request without sending it.

## Credentials

| Credential | Set with | Used by |
| --- | --- | --- |
| Control plane | `PLATFORMCTL_CONTROL_TOKEN` | `routes`, `sessions` |
| Access administration | `PLATFORMCTL_ADMIN_TOKEN` | `access` |
| Decision | `PLATFORMCTL_ADMIN_TOKEN`, or `--decision-token` | `access decide` |
| Caller | The machine's credential from `login`, or `PLATFORMCTL_TOKEN` | `data` |

The control plane's scopes are not a hierarchy. A token that may operate may not write the route table, and a token that may write it may not purge a session. The CLI never retries with a different credential, and a scope refusal has its own exit status.

## Scripting

Ask for JSON and branch on the exit status:

```bash
set -euo pipefail

platformctl --output json access grants list --tenant acme \
  | jq -r '.grants[] | select(.revokedAt == null) | .id'
```

The statuses a script most often meets are `3` (the credential is no longer valid), `5` (the thing changed underneath the command) and `7` (a service could not be reached). The full table is in [spec §6.2](spec.md#62-exit-status).

## When something refuses

| The message starts with | Meaning | Fix |
| --- | --- | --- |
| `the credential of the control plane is missing` | The variable is not set | Set `PLATFORMCTL_CONTROL_TOKEN` |
| `the caller is not signed in` | No credential on this machine | Run `platformctl login`, or set `PLATFORMCTL_TOKEN` |
| `the credential of the caller is no longer valid` | The token expired | Run `platformctl login` again |
| `no workspace is named` | Neither the profile nor the command names a workspace | Pass `--workspace`, or set `PLATFORMCTL_WORKSPACE_ID` |
| `the address of the callback is missing` | The login has no callback address for the tenant to send you back to | Set `PLATFORMCTL_REDIRECT_URI` and allow it in the tenant |
| `the profile "…" names no …` | The profile lacks an address the command needs | Set the variable the message names, or add it to the profile |
| `the active revision is not the expected one` | The route table moved underneath the write | Read the revision again, then write |
| `the service cannot be reached` | The network or the service is down | Check `platformctl status` |
| `the command changes something and nobody can confirm it` | No terminal to ask for confirmation | Pass `--yes` |
