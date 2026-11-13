# Usage

How to use `platformctl` against a deployment: install it, write your first profile, sign in, do everyday operator work, use it from scripts, and fix common refusals. It is for operators and developers; the exact behavior is in the [specification](spec.md).

## Install

Each platform release publishes the CLI as its own archive for every supported platform. The archive carries the runtime, so it needs nothing else.

```bash
curl -sSLO https://github.com/ggpwnkthx/platform/releases/download/v1.6.1/platformctl-1.6.1-linux-x64.tar.gz
tar -xzf platformctl-1.6.1-linux-x64.tar.gz
install platformctl-1.6.1-linux-x64/platformctl /usr/local/bin/platformctl
platformctl --help
```

In the repository, run the CLI from source:

```bash
bun run cli --help
```

To build the binary yourself, run `bun run --cwd packages/cli build`; it lands in `dist/platformctl`.

## Find your way

The help of the CLI names every command, and the help of a group names every command of the group:

```bash
platformctl --help            # the commands of the root and the groups
platformctl access --help     # the commands of the group
platformctl access grants list --help
platformctl help access grants list
```

`--help` and `help` are not refusals: they print what you asked for and end with the status of a command that did what it was asked. A word that names no command is a refusal, and it names the command that is the closest to what you typed:

```console
$ platformctl stat
error: the command "stat" is not one of the CLI
hint: did you mean "status"?
```

The version of the CLI is one flag away:

```bash
platformctl --version
```

The answer is painted when the terminal paints it: a thing that is fine is green, a thing that is refused or unreachable is red, and the head of a table is bold. Turn the colour off with `--no-color`, or with `NO_COLOR` in the environment. The json and the yaml hold no colour, so a script reads the same bytes either way.

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

## The identity of a tenant

A tenant signs its people in at an OpenID Connect provider, and the platform supports a set of them out of the box. The catalog holds them, and the steps of a preset say how the client of Access is registered at the vendor:

```bash
platformctl access catalog list
platformctl access catalog steps --key okta
```

A preset fills the issuer, the scopes and the algorithms of a provider, and it never constrains what a tenant registers. A tenant that brings a provider of its own names the preset `custom`:

```bash
platformctl access providers create --tenant acme --catalog okta \
  --issuer https://acme.okta.example --idp-client-id … --idp-client-secret …
```

The domain of the addresses of a tenant is what names it when the platform serves several of them: a caller types its address and the browser goes to the provider of its tenant. A route names the tenant and the provider, and it waits for its proof: the owner of the domain publishes the challenge of the route as a TXT record of `_access` of the domain, or the operator of the platform vouches for it.

```bash
platformctl access routes create --tenant acme --key acme.example --provider okta
platformctl access routes verify <id> --verification operator
```

## The interface of the operator

```bash
platformctl tui
```

The interface draws the deployments of your machine, the state of their services and the tenants, the principals and the grants of the deployment. It reads the credentials of your shell and not the profiles, and it asks before it writes. The keys of the interface are in [The interface](tui.md).

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

# write a resource that a failed apply left in the cloud into the state
platformctl infra import azurerm_key_vault.platform \
  /subscriptions/…/resourceGroups/…/providers/Microsoft.KeyVault/vaults/…
```

`infra apply` writes the plan, shows it, and applies **that** plan once you confirm it. The plan that is applied is the plan you read:

```bash
platformctl infra apply
```

The plan is shown before the question, on the standard error, whatever the format of the answer is: `--output json` changes the answer of the command, and it does not change what you are shown before you confirm. `--yes` answers the question with yes; it does not hide the plan.

`deploy azure` recovers on its own from the failures a leftover of an earlier run causes. A resource that is already in the cloud and not in the state is imported into the state, and the plan is run again: every resource the tool names is imported, not one of them, because a plan that holds one resource of a hundred refuses the hundredth one. A resource that was deleted and not purged still holds its name, and the name cannot be used again: the wizard asks before it purges the resource, and purging it loses what is left of it. A resource that cannot be taken over at all, and whose name the deployment can change, is named differently: the wizard asks before it changes the name. Pass `--yes` to answer yes to the questions.

When the state of the deployment cannot be read — the backend changed and the state could not be moved with it — the plan that follows is the plan of a deployment whose state is empty, and the resources of the deployment that are already there are not in it. The wizard says so before the plan is written, and the question of the plan names it again: `the state of the deployment is empty: the plan creates 87, changes 0 and destroys 0: the deployment is applied?`.

The commands work on the deployment of the profile, and the directories are named when they are not the ones the profile says:

```bash
platformctl infra plan \
  --directory deploy/tofu/azure \
  --runtime deploy/tofu/runtime/production
```

A path of the deployment is a path of the checkout, and the command may run in a directory of the checkout — the CLI is run through the workspace of a package. The path you name is read from the checkout when it is not in the directory the command runs in, so the command above works from the root of the checkout and from the workspace of a package alike.

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

The wizard of a deployment signs you in to the provider, asks what the deployment needs, writes the file of the values, and goes on with the deployment:

```bash
platformctl deploy azure
```

It signs you in with the Azure CLI, so it opens a browser the first time and it lets you pick the subscription when you hold more than one. It asks only what it cannot answer itself: the names the deployment answers under and the identifiers of the tenant and of the workspace. The subscription of the deployment is the one it signed in to, and it writes it in the values of the deployment: the templates write their resources in that subscription, and not in the subscription of the session.

The wizard checks what it needs before it asks anything: the templates of the deployment, the OpenTofu binary and your identity in Azure. If one of them is missing, the wizard says so in a second instead of after twenty questions.

A value that is a selection is never typed. The environment of the deployment is a selection: the wizard shows the three environments the templates take — development, staging and production — and you pick one of them, by its number or by its name. An answer that is not one of the choices is asked again, and answering nothing takes the default of the question.

One question may be left unanswered: the zone of DNS that holds the names of the deployment. Name the zone and the deployment writes the records of the names in a zone of Azure, and you delegate the zone at your registrar with the `NS` records the deployment answers with. Answer nothing and you write the records of the names yourself, and the deployment tells you which ones.

An answer the deployment cannot use — an identifier that is not an identifier, a digest that is not a digest — is refused at the question, and the question is asked again. The wizard does not wait until the end of the interview to tell you that the first answer was wrong.

The values of a deployment that is already there are the defaults of the questions: the wizard reads the file of the values of the deployment of the environment and offers every answer of it, so a second run is a matter of pressing enter. The example of the templates is the default of everything the deployment does not hold.

The digests of the images are not asked: they are read from the release of the platform, and the release carries the digest of every image it published. The release is the latest one the platform published, and the digests it names are written into the values of the deployment, so the deployment stays pinned even when the latest release moves. To run another release:

```bash
platformctl deploy azure --release 1.1.0
platformctl deploy azure --release latest
```

`latest` is the release the platform published last, and it is the default. The images of a release read the route table of the deployment, the files of its secrets and the variables of its environment, and an image that reads a document it does not know refuses to start. The wizard therefore compares the **contract** of the templates of the checkout with the contract of the templates of the release — the route table, the names of the secrets, the files of the secrets and the variables of the environment — and the deployment goes on when the two are the same: a checkout that is ahead of the release and writes the same documents runs the images of the release.

A checkout whose templates write a document the images of the release do not know is refused, and the refusal names the document that changed. Fetch the tag of the release first (`git fetch --tags`), or name the digests of the images of another build in the file of the answers.

The documents are compared by their fields and by the values that are not addresses: a comment that changed and the address of a service that moved are not a difference, and the deployment goes on.

The wizard writes the file of the values, `deploy/tofu/runtime/production/terraform.tfvars`, and then it continues:

1. It asks for the addresses that reach the account of the state of the deployment. The account holds the state and the secrets of the deployment, and it is closed to every other address. The public address of your machine is read and offered as the default, so answering nothing takes it; type another address when your machine reaches the internet through another one.

The service that holds the state refuses a range of one address, so the range of the address of your machine is the range of four addresses that holds it: `159.96.225.85` becomes `159.96.225.84/30`. A range you name yourself is used as it is, and a range that is narrower than the service takes is widened to the range that holds it.
2. It runs the bootstrap of the templates, which creates the resource group and the storage account of the state. The bootstrap runs in the directory of the files of the deployment, `deploy/tofu/runtime/<environment>/bootstrap`: the state of the bootstrap is local, and a local state is written in the directory the tool runs in. That state holds the name of the account of the state of the deployment, and the checkout of the templates is not the place of a credential.
3. It writes the configuration of the backend of the state, `deploy/tofu/runtime/production/backend.hcl`.
4. It initializes the templates against that backend.
5. It writes the plan, shows it, and applies it once you confirm it. The plan that is applied is the plan you read. The plan is shown before the question whatever the format of the answer is, and `--yes` does not hide it.
6. It binds the certificate of every public name of the deployment. The names are custom domains of the gateway, and the environment of the container apps issues the certificate of a name and renews it. The binding waits for the records of DNS of the name, so a name whose records are not in place yet is bound the next time the deployment goes on. The wizard says what it bound and what it could not bind.

The OpenTofu binary is found on the path, or downloaded by the CLI when the machine holds none, so the steps above need no tool installed by hand.

The wizard tells every step as it happens, on the standard error, because the wizard takes minutes and a wizard that says nothing looks like a wizard that is stuck. Its questions and its confirmations are on the standard error too. Its answer ends on the standard output: a script that reads the answer reads the answer and nothing else.

The answer is what the deployment did, and not the plan that was shown before the question:

```text
the deployment is applied

the deployment created 5, changed 27 and destroyed 0

action  kind                       address
create  azurerm_container_app      azurerm_container_app.access
update  azurerm_container_app      azurerm_container_app.console
```

The plan is counted in the future, because it is a question, and the apply is counted in the past, because it is an answer.

Before the deployment takes its minutes, the wizard tells you the answers it collected, so a typo is caught in a second and not after the minutes:

```text
the deployment goes on with these answers:
  name_prefix       platform
  environment       production
  dns_zone_name     example.com
  gateway_name      api
```

To answer without a terminal, put the answers in a file:

```bash
platformctl deploy azure --answers ./answers.tfvars
```

The file holds the values in the shape of the example of the templates, and the addresses of the operator in one value:

```bash
name_prefix = "platform"
operator_addresses = "203.0.113.4/32"
```

The public address of your machine is read from a service that answers with it, and the reader of the CLI can name another service, or refuse the reading:

```bash
export PLATFORMCTL_ADDRESS_SERVICE=https://my-service.example/ip
export PLATFORMCTL_ADDRESS_LOOKUP=off
```

The values of a deployment that is already there are the answers of an earlier run, and the wizard does not throw them away. When you choose the same values, the file is left alone. When you choose other ones, the wizard asks whether the file is written again: `--yes` answers yes, and `--force` writes it without asking. A dry run writes nothing, tells you the steps, and applies nothing:

```bash
platformctl deploy azure --dry-run
```

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
| `the values of the deployment are already there` | The runtime directory holds a deployment, and the values you chose are not the ones it holds | Answer yes when the wizard asks, pass `--force`, or name another `--runtime` |
| `the templates of the deployment hold no bootstrap` | The templates hold no stack that creates the place where the state lives | Check out the templates of the release |
| `the addresses that reach the account of the state … are needed` | The account of the state is closed to every address | Name the addresses of the operator in the file of the answers |
| `the address … is not a range` | The address is not in the notation of a network | Write the address with its mask, for example `203.0.113.4/32` |
| `the place where the state of the deployment lives cannot be created` | The bootstrap of the templates failed | Read the message of the tool, and run `tofu -chdir=deploy/tofu/runtime/<environment>/bootstrap apply` yourself |
| `the place where the state of the deployment lives was not created` | The bootstrap of the templates failed | Read the message of the tool: it names the resource that could not be created |
| `the configuration of the backend of the state cannot be read` | The tool answered with something that is not a configuration | Run `tofu -chdir=deploy/tofu/runtime/<environment>/bootstrap apply` and read what it says |
| `the state of the deployment is locked …` | Another run holds the lock of the state | The wizard asks before it frees the lock: answer yes when that run is not there anymore, or free the lock with the command the message names |
