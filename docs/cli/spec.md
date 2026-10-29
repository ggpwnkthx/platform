# Specification

The normative behavior of the command line: the commands it offers, the
answer it gives, the status its process ends with, and what it refuses
to do. What is written here is the contract of the program; the guides
that come with it are advice and never a promise.

Status: 1.0.0. Runtime: Bun ≥ 1.4.3. Name of the program:
`platformctl`.

---

## 1. Terms

| Term | Meaning |
| --- | --- |
| **reader** | The person who runs the CLI. |
| **command** | A name, a summary and a function. |
| **group** | A set of commands that share a subject. |
| **profile** | The names of a deployment: its addresses, its workspace and its client. |
| **credential** | The token of the caller, kept in the file of the machine. |
| **answer** | What a command returns: a value for a script, and lines for a person. |

Invariants, enforced in code and not configurable:

- The CLI **decides nothing**. A decision is the answer of Access, and
  the CLI shows it.
- The CLI **never reaches a database**. It speaks HTTP to the services,
  and it holds no policy of its own.
- The CLI **never becomes an administrative endpoint**. The
  administration of the gateway is the control plane, and the CLI is one
  of its clients.
- A refusal is **never retried with another credential**. A token that
  is refused stays refused.
- A secret is **never printed**. A credential is read from the file of
  the machine or from the environment, and it is written nowhere but in
  the file that only its owner reads.

---

## 2. The shape of a command

```
platformctl [options] <group> <command> [arguments] [options]
```

- A command of the root stands alone: `platformctl status`.
- A command of a group is named by its group: `platformctl access grants list`.
- A command may be named by several words, and the words are read from
  the left: `access grants list` is one command and not three.
- An option is `--name`, `--name=value` or `--name value`. A flag that
  is refused is `--no-name`.
- A short name exists for the options of the CLI: `-o`, `-q`, `-p`, `-y`
  and `-h`.
- The words after `--` are arguments, whatever they look like.
- An option the command does not declare is refused, and so is an option
  that needs a value and has none. Both refusals end the process with
  the status of a usage error (§6).

### 2.1 The options of the CLI

| Option | What it does |
| --- | --- |
| `--output <json\|yaml\|table>` | The format of the answer. The default is `table`. |
| `--quiet` | The answer holds the names of the things only. |
| `--verbose` | The answer holds the details of the calls. |
| `--color` | The answer is in colour. The default follows the terminal. |
| `--profile <name>` | The profile of the deployment. |
| `--dry-run` | The command prints the request it would send, and sends nothing. |
| `--yes` | The command does not ask the reader to confirm. |
| `--request-id <id>` | The id of the request, written in the `x-request-id` header. |
| `--help` | The help of the command. |

`NO_COLOR` in the environment turns the colour off, whatever the option
says.

---

## 3. The profiles

A profile names a deployment. It holds the address of the gateway, the
address of the control plane, the address of Access, the workspace, the
tenant, the client and the address of the callback of a login.

The profiles live in the file of the configuration of the machine, and
the environment of the shell overrides them: the shell wins, because a
shell that names a deployment is a shell that means it.

| Name of the variable | What it names |
| --- | --- |
| `PLATFORMCTL_PROFILE` | The profile of the shell. |
| `PLATFORMCTL_GATEWAY_URL` | The address of the gateway. |
| `PLATFORMCTL_CONTROL_URL` | The address of the control plane. |
| `PLATFORMCTL_ACCESS_URL` | The address of Access. |
| `PLATFORMCTL_WORKSPACE_ID` | The workspace of the commands of the data. |
| `PLATFORMCTL_TENANT_ID` | The tenant of the commands of the access. |
| `PLATFORMCTL_CLIENT_ID` | The client of the login. |
| `PLATFORMCTL_CLIENT_SECRET` | The secret of the client. |
| `PLATFORMCTL_REDIRECT_URI` | The address of the callback of a login. |
| `PLATFORMCTL_CONTROL_TOKEN` | The credential of the control plane. |
| `PLATFORMCTL_ADMIN_TOKEN` | The credential of the administration of Access. |
| `PLATFORMCTL_TOKEN` | The credential of the caller, for a script. |
| `PLATFORMCTL_TIMEOUT_MS` | The timeout of a call, in milliseconds. |

A command that needs an address and has none is refused with the status
of a usage error, and the refusal names the variable that names it.

The CLI reads no variable of a service: a deployment that sets
`GATEWAY_HOST` does not configure the CLI with it.

---

## 4. The identity of the caller

`platformctl login` signs the caller in the way a program signs in: it
opens the login of the provider, the provider sends the caller back with
a code, and the code is exchanged for a token. The proof of the caller
is a challenge (`S256`), and the state of the login is checked.

The address of the callback is on the machine of the caller, and the
tenant has to allow it: a provider that sends the caller to an address
it does not know refuses the login. The CLI names the address it uses
when it has none.

The credential is kept in the file of the state of the machine, in a file
only its owner can read. `platformctl logout` removes it.

`platformctl whoami` reads the claims of the credential at the discovery
of Access, and it reads nothing else.

---

## 5. The commands

### 5.1 The root

| Command | What it does |
| --- | --- |
| `login` | Signs the caller in and stores the credential. |
| `logout` | Removes the credential of the machine. |
| `whoami` | Shows the claims of the caller. |
| `status` | Reads the probes of the health and of the readiness of the services. |
| `version` | Shows the version of the CLI and the versions the deployment answers. |
| `doctor` | Checks the profile, the credential and the state of the services. |

`status` and `doctor` end the process with the status of an unreachable
service when a service does not answer.

### 5.2 The context

| Command | What it does |
| --- | --- |
| `context list` | The profiles of the machine. |
| `context show [name]` | The profile as it is resolved. |
| `context current` | The profile of the shell. |
| `context set <name>` | Writes a profile; the names that are not given are kept. |
| `context remove <name>` | Removes a profile. |
| `context paths` | The files of the CLI on this machine. |

### 5.3 The routes

The control plane of the gateway holds the route table, and it is a
process of its own. Its scopes are not a hierarchy, and the CLI never
asks for another scope than the one its credential holds.

| Command | What it does |
| --- | --- |
| `routes get` | The route table that is active, with its revision. |
| `routes history` | A page of the revisions of the table. |
| `routes validate <file>` | Checks a table and writes nothing. |
| `routes apply <file>` | Writes a table as a new revision. |
| `routes rollback <revision>` | Writes an older revision again, as a new revision. |
| `routes replicas` | The replicas that serve the table. |
| `routes audit` | The trail of the writes of the control plane. |

`routes apply` is a compare-and-swap: the write names the revision it
replaces, and the service refuses the write when the revision moved.
The CLI reads the active revision first, and it says which revision the
write replaces. The table is validated before it is written, unless
`--skip-validate` is given.

### 5.4 The sessions

| Command | What it does |
| --- | --- |
| `sessions revoke --subject <subject>` | Ends the sessions of a caller. |
| `sessions purge-decisions --subject <subject>` | Purges the decisions that are cached for a caller. |

The sessions of the callers are not readable: the gateway has no
endpoint for them, and the CLI does not invent one.

### 5.5 The access

| Command | What it does |
| --- | --- |
| `access tenants list` | The tenants of the deployment. |
| `access tenants create` | Registers a tenant, or changes it. |
| `access principals list` | A page of the principals. |
| `access principals create` | Registers a principal, or changes it. |
| `access principals import --file <file>` | Registers a batch of principals. |
| `access grants list` | A page of the grants. |
| `access grants put` | Gives a grant, or changes it. |
| `access grants revoke <id>` | Revokes a grant. |
| `access groups list` | The groups of the deployment. |
| `access groups create` | Writes a group, or changes it. |
| `access roles list` | The roles of the deployment. |
| `access roles put` | Writes a role, or changes it. |
| `access roles remove <id>` | Removes a role. |
| `access audit list` | The audit of the administration. |
| `access audit export` | The audit as a file of csv or of json lines. |
| `access decide` | Asks Access for a decision. |
| `access context` | Reads the capabilities of a principal in a workspace. |

`access decide` ends the process with the status of a refusal when the
decision is a denial, so that a script branches on it.

### 5.6 The data

Every command of the data goes through the gateway, and it works on one
workspace: the workspace of the profile, or the one of `--workspace`.

| Command | What it does |
| --- | --- |
| `data me` | The identity of the caller in the workspace. |
| `data schema [collection]` | The metadata of the collections. |
| `data items list <collection>` | A page of the records. |
| `data items get <collection> <id>` | One record. |
| `data items create <collection>` | Creates a record. |
| `data items update <collection> <id>` | Changes a record. |
| `data items delete <collection> <id>` | Removes a record. |
| `data items versions <collection> <id>` | The history of a record. |
| `data items version <collection> <id> <version>` | One version of a record. |
| `data items rollback <collection> <id> <version>` | Rolls a record back. |
| `data aggregate <collection>` | The aggregate of a collection. |
| `data audit` | The audit of the workspace. |
| `data model show` | The model of the workspace. |
| `data model collection add\|update\|remove` | The collections of the model. |
| `data model field add\|update\|remove\|move` | The fields of a collection. |
| `data model relation add\|update\|remove` | The relations of a collection. |

The body of a write is read from a file (`--body`) or from the words of
the reader (`--data`), and it is json. A change carries the validator
of the record it believes it changes (`--etag`), and a creation may
carry the key that makes it repeatable (`--idempotency-key`).

---

## 6. The answer

### 6.1 The formats

| Format | What it is for |
| --- | --- |
| `table` | The default: a list of records is a table, and one thing is a list of facts. |
| `json` | A script reads it. Its shape does not change within a major version. |
| `yaml` | The same facts, for a person who writes them down. |

`--quiet` prints the names of the things only, and it is the answer a
script wants when it pipes the CLI into another command.

### 6.2 The status of the process

| Status | What it means |
| --- | --- |
| `0` | The command did what it was asked. |
| `1` | The command failed, and the reason is not one of the ones below. |
| `2` | The command was asked something it cannot answer. |
| `3` | The caller is not authenticated, or its credential is no longer valid. |
| `4` | The thing the command names is not there. |
| `5` | The thing the command names is there, and it changed under it. |
| `6` | A policy refused the command. |
| `7` | A service of the deployment could not be reached. |
| `8` | The request was refused because it was not a valid one. |

The code of the service decides the status, and the status of the answer
decides it when the code is unknown. A failure is a message on the
standard error, and never a stack trace.

---

## 7. The safety of a command that changes something

- A command that changes something asks the reader before it changes it,
  unless `--yes` is given. A command that waits for an answer nobody
  can give is refused with the status of a usage error.
- `--dry-run` sends nothing: the answer holds the request that would
  have been sent.
- A write of the route table names the revision it replaces.
- A change of a record carries the validator of the record it believes
  it changes, and a refusal of the precondition is a status of its own.

---

## 8. The files of the CLI

| File | What it holds |
| --- | --- |
| `${XDG_CONFIG_HOME:-$HOME/.config}/platformctl/config.json` | The profiles of the deployments. |
| `${XDG_DATA_HOME:-$HOME/.local/share}/platformctl/credentials.json` | The credential of the caller, readable by its owner only. |

The CLI writes nothing else: it leaves no cache, no log and no state
that a reader of the directory has to guess the meaning of.
