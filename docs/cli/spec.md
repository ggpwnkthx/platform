# Specification

The normative behavior of the CLI (`platformctl`): its commands, its output, its exit statuses, and what it refuses to do. This page is the program's contract, for implementers, reviewers and script authors; the [usage guide](usage.md) is advice, never a promise.

Status: 1.0.1. Runtime: Bun ≥ 1.4.3. Program name:
`platformctl`.

---

## 1. Terms

| Term | Meaning |
| --- | --- |
| **user** | The person who runs the CLI. |
| **command** | A name, a summary and a function. |
| **group** | A set of commands that share a subject. |
| **profile** | A deployment's settings: its addresses, its workspace and its client. |
| **credential** | The caller's token, kept in a file on the machine. |
| **answer** | What a command returns: a value for scripts, and lines for people. |

### 1.1 Invariants

The code enforces these, and no setting turns them off:

- The CLI **decides nothing**. A decision is Access's answer, and the CLI shows it. The deployment of the platform is written in OpenTofu, and the same rule holds there: the tool decides what the deployment is, and the CLI shows the plan the tool wrote.
- The CLI **never reaches a database**. It speaks HTTP to the services and holds no policy of its own.
- The CLI **never becomes an administrative endpoint**. Gateway administration is the control plane, and the CLI is one of its clients.
- A refused request is **never retried with another credential**. A token that is refused stays refused.
- A secret is **never printed**. A credential is read from the machine's credential file or from the environment, and written only to that file, which only its owner can read. The outputs of a deployment carry the credentials of the deployment, and they are held back before they are drawn.

---

## 2. Command syntax

```text
platformctl [options] <group> <command> [arguments] [options]
```

- A root command stands alone: `platformctl status`.
- A group command is prefixed by its group: `platformctl access grants list`.
- A command name may have several words, read from the left: `access grants list` is one command, not three.
- An option is written `--name`, `--name=value` or `--name value`. A boolean flag is negated with `--no-name`.
- The global options have short forms: `-o`, `-q`, `-p`, `-y` and `-h`.
- Every word after `--` is an argument, whatever it looks like.
- An option the command does not declare is refused, and so is an option that needs a value and has none. Both refusals end the process with the usage-error status (§6.2).

### 2.1 Global options

| Option | Short | Effect |
| --- | --- | --- |
| `--output <json\|yaml\|table>` | `-o` | The output format. The default is `table`. |
| `--quiet` | `-q` | Print only the names of the things. |
| `--verbose` | | Print the details of the calls. |
| `--color` | | Print in colour. The default follows the terminal. |
| `--profile <name>` | `-p` | The deployment profile to use. |
| `--dry-run` | | Print the request the command would send, and send nothing. |
| `--yes` | `-y` | Do not ask for confirmation. |
| `--request-id <id>` | | The request ID, sent in the `x-request-id` header. |
| `--help` | `-h` | Show help for the command. |

`NO_COLOR` in the environment turns colour off, whatever the option says.

---

## 3. Profiles

A profile names a deployment. It holds the gateway address, the control plane address, the Access address, the workspace, the tenant, the client and the login callback address.

Profiles live in the machine's configuration file (§8). The shell environment overrides them: the shell wins, because a shell that names a deployment means it.

The profile in use is the one named by `--profile`, else `PLATFORMCTL_PROFILE`, else the profile marked current, else `default`.

| Variable | Names |
| --- | --- |
| `PLATFORMCTL_PROFILE` | The shell's profile. |
| `PLATFORMCTL_GATEWAY_URL` | The gateway address. |
| `PLATFORMCTL_CONTROL_URL` | The control plane address. |
| `PLATFORMCTL_ACCESS_URL` | The Access address. |
| `PLATFORMCTL_WORKSPACE_ID` | The workspace for data commands. |
| `PLATFORMCTL_TENANT_ID` | The tenant for access commands. |
| `PLATFORMCTL_CLIENT_ID` | The login client. |
| `PLATFORMCTL_CLIENT_SECRET` | The client's secret. |
| `PLATFORMCTL_REDIRECT_URI` | The login callback address. |
| `PLATFORMCTL_CONTROL_TOKEN` | The control plane credential. |
| `PLATFORMCTL_ADMIN_TOKEN` | The Access administration credential. |
| `PLATFORMCTL_TOKEN` | The caller's credential, for scripts. |
| `PLATFORMCTL_TIMEOUT_MS` | The timeout of a call, in milliseconds (default `30000`). |

The three credential variables (`PLATFORMCTL_CONTROL_TOKEN`, `PLATFORMCTL_ADMIN_TOKEN`, `PLATFORMCTL_TOKEN`) are read only from the environment; a profile never stores them. An empty variable does not override a profile setting.

A command that needs an address and has none is refused with the usage-error status, and the refusal names the variable to set.

The CLI reads no service's variables: a deployment that sets `GATEWAY_HOST` does not configure the CLI with it.

---

## 4. Sign-in

`platformctl login` signs the caller in the way a native program does: it opens the provider's login page, the provider sends the caller back with a code, and the CLI exchanges the code for a token. The caller's proof is a PKCE challenge (`S256`), and the login's state is checked.

The callback address is on the caller's machine, and the tenant must allow it: a provider refuses a login that would send the caller to an address it does not know. When no callback address is configured, the CLI refuses and names an example address to use.

The credential is kept in the machine's credential file, which only its owner can read. `platformctl logout` removes it.

`platformctl whoami` reads the credential's claims from Access's userinfo endpoint (`/oauth/userinfo`, the one its discovery document names) and reads nothing else.

---

## 5. Commands

### 5.1 Root commands

| Command | Effect |
| --- | --- |
| `login` | Signs the caller in and stores the credential. |
| `logout` | Removes the machine's credential. |
| `whoami` | Shows the caller's claims. |
| `status` | Reads the services' health and readiness probes. |
| `version` | Shows the CLI's version and the versions the deployment reports. |
| `doctor` | Checks the profile, the credential and the services' state. |

`status` and `doctor` end with the unreachable-service status when a service does not answer.

### 5.2 Context

| Command | Effect |
| --- | --- |
| `context list` | Lists the machine's profiles. |
| `context show [name]` | Shows the profile as resolved. |
| `context current` | Shows the shell's profile. |
| `context set <name>` | Writes a profile; settings not given are kept. |
| `context remove <name>` | Removes a profile. |
| `context paths` | Shows the CLI's files on this machine. |

### 5.3 Routes

The gateway's control plane holds the route table and runs as a separate process. Its scopes are not a hierarchy, and the CLI never asks for a scope other than the one its credential holds.

| Command | Effect |
| --- | --- |
| `routes get` | The active route table, with its revision. |
| `routes history` | A page of the table's revisions. |
| `routes validate <file>` | Checks a table and writes nothing. |
| `routes apply <file>` | Writes a table as a new revision. |
| `routes rollback <revision>` | Writes an older revision again, as a new revision. |
| `routes replicas` | The replicas that serve the table. |
| `routes audit` | The control plane's write trail. |

`routes apply` is a compare-and-swap: the write names the revision it replaces, and the service refuses it when the active revision has moved. The CLI reads the active revision first and says which revision the write replaces; `--revision` names one explicitly. The table is validated before it is written unless `--skip-validate` is given.

### 5.4 Sessions

| Command | Effect |
| --- | --- |
| `sessions revoke --subject <subject>` | Ends a caller's sessions. |
| `sessions purge-decisions --subject <subject>` | Purges the decisions cached for a caller. |

Callers' sessions cannot be listed: the gateway has no endpoint for them, and the CLI does not invent one.

### 5.5 Access

| Command | Effect |
| --- | --- |
| `access tenants list` | Lists the deployment's tenants. |
| `access tenants create` | Registers a tenant, or changes it. |
| `access principals list` | A page of principals. |
| `access principals create` | Registers a principal, or changes it. |
| `access principals import --file <file>` | Registers a batch of principals. |
| `access grants list` | A page of grants. |
| `access grants put` | Gives a grant, or changes it. |
| `access grants revoke <id>` | Revokes a grant. |
| `access groups list` | Lists the deployment's groups. |
| `access groups create` | Writes a group, or changes it. |
| `access roles list` | Lists the deployment's roles. |
| `access roles put` | Writes a role, or changes it. |
| `access roles remove <id>` | Removes a role. |
| `access audit list` | The administration audit. |
| `access audit export` | The audit as a CSV or JSON Lines file. |
| `access decide` | Asks Access for a decision. |
| `access context` | Reads a principal's capabilities in a workspace. |

`access decide` ends with the policy-refusal status when the decision is a denial, so a script can branch on it.

### 5.6 Data

Every data command goes through the gateway and works on one workspace: the profile's, or the one given with `--workspace`.

| Command | Effect |
| --- | --- |
| `data me` | The caller's identity in the workspace. |
| `data schema [collection]` | Collection metadata. |
| `data items list <collection>` | A page of records. |
| `data items get <collection> <id>` | One record. |
| `data items create <collection>` | Creates a record. |
| `data items update <collection> <id>` | Changes a record. |
| `data items delete <collection> <id>` | Removes a record. |
| `data items versions <collection> <id>` | A record's history. |
| `data items version <collection> <id> <version>` | One version of a record. |
| `data items rollback <collection> <id> <version>` | Rolls a record back. |
| `data aggregate <collection>` | A collection's aggregate. |
| `data audit` | The workspace's audit. |
| `data model show` | The workspace's model. |
| `data model collection add\|update\|remove` | The model's collections. |
| `data model field add\|update\|remove\|move` | A collection's fields. |
| `data model relation add\|update\|remove` | A collection's relations. |

A write's body is JSON, read from a file (`--body`) or from the command line (`--data`). A change carries the validator of the record it expects to change (`--etag`), and a creation may carry a key that makes it safe to repeat (`--idempotency-key`).

### 5.7 Infrastructure

The deployment of the platform is written in OpenTofu. The CLI runs the tool, it reads the plan the tool answers with, and it draws what the tool decided. The CLI never computes a plan, never interprets a change, and never writes a file of the deployment: the state, the values and the plan belong to the deployment, and the tool writes them.

| Command | Effect |
| --- | --- |
| `infra plan` | Writes the plan of the deployment and shows what it changes. Nothing is applied. |
| `infra apply` | Writes the plan, shows it, and applies **that** plan once the reader confirms it. |
| `infra output` | The outputs of the deployment. |
| `infra validate` | Checks the templates against the schemas of the providers. No cloud is needed. |

The commands of the group take the same options:

| Option | Effect |
| --- | --- |
| `--directory <path>` | The directory of the templates. The default is `deploy/tofu/azure`. |
| `--runtime <path>` | The directory of the files of the deployment: the values, the plan and the configuration of the backend. The default is `deploy/tofu/runtime/<profile>`. |
| `--var-file <path>` | The file of the values of the deployment. The default is the values of the runtime directory. |
| `--name <name>` | One output of the deployment. |

The tool is found on the path, or in the variable `TOFU_BINARY`. The CLI refuses a tool that is older than the version the templates ask for, and it refuses a tool that is not there. The plan is read from the json the tool writes, and the text the tool writes is never parsed: a plan that the CLI reads another way is a plan nobody proved.

`infra apply` asks before it applies, and the question names what the plan destroys. `--dry-run` writes the plan and applies nothing.

### 5.8 Deploy

The wizard of a deployment collects the values of a deployment and signs the operator in to the system of the provider. The provider is the command: `deploy azure` prepares a deployment on Microsoft Azure.

| Command | Effect |
| --- | --- |
| `deploy azure` | Signs the operator in to Azure, asks the questions the deployment needs, writes the file of the values, and tells the operator what to do next. |

The wizard asks a question when it cannot answer it itself. A question that has a value in the example of the templates shows the value the operator may take, and a question that names the deployment has no default: the operator types it. The facts the provider reads from its own system are never asked again.

The digests of the images of the platform are read from the release of the platform: the release carries the digest of every image it published, and a digest that is copied by hand is a digest that is wrong the day the tag moves. The digest of the image of the client of PostgreSQL is read from the registry that holds it: it is the one image of a deployment that the platform does not publish. What cannot be read is asked, and the wizard says why.

The wizard writes one file: the file of the values of the deployment, in the runtime directory of the deployment. It refuses to write it over the values that are there, unless `--force` is given. The state, the plan and the configuration of the backend belong to the tool, and the wizard writes none of them.

The wizard takes the options of the group:

| Option | Effect |
| --- | --- |
| `--directory <path>` | The directory of the templates. The default is the `deploy/tofu/azure` of the checkout the wizard finds by walking up from the directory it runs in. |
| `--runtime <path>` | The directory of the files of the deployment. The default is `deploy/tofu/runtime/<environment>`, and the environment is one of the values of the deployment. |
| `--answers <file>` | The file of the answers of the operator. The wizard asks nothing when the file holds every answer. |
| `--force` | Write the values over the values that are there. |
| `--release <version>` | The release of the platform the deployment runs. The default is the version of the CLI, and the CLI shares the version line of the platform. |

---

## 6. Output

### 6.1 Formats

| Format | Use |
| --- | --- |
| `table` | The default: a list of records is a table, and a single thing is a list of facts. |
| `json` | For scripts. Its shape does not change within a major version. |
| `yaml` | The same facts, for a person to keep. |

`--quiet` prints only the names of the things, which is what a script wants when it pipes the CLI into another command.

### 6.2 Exit status

| Status | Meaning |
| --- | --- |
| `0` | The command did what it was asked. |
| `1` | The command failed for a reason not listed below. |
| `2` | Usage error: the command was asked something it cannot answer. |
| `3` | The caller is not authenticated, or its credential is no longer valid. |
| `4` | The thing the command names does not exist. |
| `5` | The thing the command names exists, and it changed underneath the command. |
| `6` | A policy refused the command. |
| `7` | A service of the deployment could not be reached. |
| `8` | The request was refused as invalid. |

The service's error code decides the status; when the code is unknown, the HTTP status of the answer decides it. A failure is a message on standard error, never a stack trace.

---

## 7. Safety of writes

- A command that changes something must ask for confirmation first, unless `--yes` is given. When no one can answer the prompt, the command is refused with the usage-error status.
- `--dry-run` sends nothing: the answer holds the request that would have been sent.
- A route table write names the revision it replaces.
- A record change carries the validator of the record it expects to change, and a failed precondition has its own status.
- An apply of the deployment applies the plan that was shown, and the question names what the plan destroys.

---

## 8. Files

| File | Holds |
| --- | --- |
| `${XDG_CONFIG_HOME:-$HOME/.config}/platformctl/config.json` | Deployment profiles. |
| `${XDG_DATA_HOME:-$HOME/.local/share}/platformctl/credentials.json` | The caller's credential, readable by its owner only. |

The CLI writes nothing else: no cache, no log, and no state whose meaning someone would have to guess.

The wizard of a deployment writes one more file: the file of the values of the deployment, in the runtime directory of the deployment. It holds no credential — the secrets of the deployment are generated by the tool and written into the vault of the deployment.

The tool that writes the infrastructure writes its own files: the working directory of the tool, the plan and the state of the deployment. They belong to the deployment and not to the CLI, and the CLI writes none of them itself.
