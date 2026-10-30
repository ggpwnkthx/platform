# Usage

How to use `platformctl` against a deployment: install it, write your first profile, sign in, do everyday operator work, use it from scripts, and fix common refusals. It is for operators and developers; the exact behavior is in the [specification](spec.md).

## Install

Each platform release publishes the CLI as its own archive for every supported platform. The archive carries the runtime, so it needs nothing else.

```bash
curl -sSLO https://github.com/ggpwnkthx/platform/releases/download/v1.0.4/platformctl-1.0.4-linux-x64.tar.gz
tar -xzf platformctl-1.0.4-linux-x64.tar.gz
install platformctl-1.0.4-linux-x64/platformctl /usr/local/bin/platformctl
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

## The infrastructure of the deployment

The deployment is written in OpenTofu. The CLI runs the tool and shows what it decided:

```bash
# what would change
platformctl infra plan

# what would change, as a script reads it
platformctl --output json infra plan | jq -r '.changes[] | "\(.action) \(.address)"'

# the templates hold against the schemas of the providers
platformctl infra validate

# the addresses the deployment answers with
platformctl infra output
```

`infra apply` writes the plan, shows it, and applies **that** plan once you confirm it. The plan that is applied is the plan you read:

```bash
platformctl infra apply
```

The commands work on the deployment of the profile, and the directories are named when they are not the ones the profile says:

```bash
platformctl infra plan \
  --directory deploy/tofu/azure \
  --runtime deploy/tofu/runtime/production
```

The tool is found on the path, or in `TOFU_BINARY`:

```bash
export TOFU_BINARY=/usr/local/bin/tofu
```

A machine that holds no tool does not need one installed by hand: the CLI reads the archive of the tool for the system it runs on, proves it against the digest the release published, and writes it in `.platform/tofu/<version>` of the directory you run the CLI in. The next run finds it there. To refuse the download:

```bash
export TOFU_DOWNLOAD=off
```

The values of the deployment, the plan and the state of the deployment belong to the deployment: they live in the runtime directory, and the CLI writes none of them itself.

## Prepare a deployment

The wizard of a deployment signs you in to the provider, asks what the deployment needs, writes the file of the values, and tells you what to do next:

```bash
platformctl deploy azure
```

It signs you in with the Azure CLI, so it opens a browser the first time and it lets you pick the subscription when you hold more than one. It asks only what it cannot answer itself: the names the deployment answers under and the identifiers of the tenant and of the workspace.

The digests of the images are not asked: they are read from the release of the platform, and the release carries the digest of every image it published. The release is the version of the CLI by default, because the CLI, the templates of the deployment and the images are one version line. To run another release:

```bash
platformctl deploy azure --release 1.1.0
platformctl deploy azure --release latest
```

`latest` is the release the platform published last. The digests it names are written into the values of the deployment, so the deployment stays pinned even when the latest release moves.

The wizard writes one file, `deploy/tofu/runtime/production/terraform.tfvars`, and prints the rest of the procedure — the state of the deployment, the configuration of the backend, the plan and the apply.

To answer without a terminal, put the answers in a file:

```bash
platformctl deploy azure --answers ./answers.tfvars
```

The file holds the values in the shape of the example of the templates. The wizard refuses to write the values over the values that are there unless you pass `--force`.

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
| `the tool that writes the infrastructure is not on the path` | OpenTofu is not installed, and the download of the release is refused | Install it, set `TOFU_BINARY`, or unset `TOFU_DOWNLOAD` |
| `the tool that writes the infrastructure is too old` | The tool is older than the templates ask for | Install a newer OpenTofu |
| `the directory of the deployment is not there` | The runtime directory of the profile does not exist | Pass `--runtime`, or create it |
| `the values of the deployment are not there` | The file of the values is missing | Copy `terraform.tfvars.example` into the runtime directory |
| `the deployment is not initialized` | The tool has no working directory for the templates | Run the `tofu init` the message names |
| `the client of Azure is not on the path` | The Azure CLI is not installed, or not on the path | Install it, or set `AZURE_CLI` |
| `the sign in to Azure did not leave a session` | The sign in was interrupted | Run `az login` and try again |
| `the operator holds no subscription of Azure` | The account holds no subscription | A deployment needs one |
| `the deployment is not ready` | An answer is not the shape the deployment needs | Read the message: it names the value |
| `the values of the deployment are already there` | The runtime directory holds a deployment | Pass `--force`, or name another `--runtime` |
