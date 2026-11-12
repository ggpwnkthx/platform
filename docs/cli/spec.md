# Specification

The normative behavior of the CLI (`platformctl`): its commands, its output, its exit statuses, and what it refuses to do. This page is the program's contract, for implementers, reviewers and script authors; the [usage guide](usage.md) is advice, never a promise.

Status: 1.4.3. Runtime: Bun ≥ 1.4.3. Program name:
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
- The help of the CLI, of a group and of a command is written on the standard output, and it ends the process with the status of a command that did what it was asked: `--help` and `help` are not refusals.
- The dialog of a command — the questions, the choices and the plan that is shown before a confirmation — is written on the standard error. The standard output holds the answer of the command and nothing else, whatever the format of the answer is.
- A refusal of a command that does not exist names the command that is the closest to what the reader typed, and a refusal of an option that does not exist names the option that is the closest to it.
- A refusal may carry a hint: the next thing the reader can try. The hint is written on the standard error, after the refusal, as a line that begins with `hint:`.

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
| `--version` | | Print the version of the CLI and end the process. |
| `--help` | `-h` | Show help for the command. |

`NO_COLOR` in the environment turns colour off, whatever the option says.

The colour of the answer is a reading aid and never a meaning: the answer says the same thing in colour and without it. The colour of a state is the colour of the state — a thing that is fine is green, a thing that is refused or unreachable is red, and a thing that is pending is yellow — and the head of a table is bold. The json and the yaml of the CLI hold no colour at all.

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
| `tui` | Opens the interface of the operator (§9). |

`status` and `doctor` end with the unreachable-service status when a service does not answer.

`status --watch` shows the state again and again, in the format the reader named, and the screen is cleared on a terminal: a reader who watches the state reads the last state. The reader stops the command with a signal, and the command ends without a refusal.

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
| `access catalog list` | The providers the platform supports out of the box. |
| `access catalog steps <key>` | How the client of Access is registered at a provider. |
| `access principals list` | A page of principals. |
| `access principals create` | Registers a principal, or changes it. |
| `access principals import --file <file>` | Registers a batch of principals. |
| `access providers list` | The providers of the deployment. |
| `access providers create` | Registers a provider of a tenant, or changes it. |
| `access providers remove <id>` | Removes a provider that holds no principal. |
| `access routes list` | The routes of the logins. |
| `access routes create` | Registers a route of the logins, or changes it. |
| `access routes verify <id>` | Verifies a route of the logins, or refuses it. |
| `access credentials list` | The accounts of the local providers. |
| `access credentials create` | Writes the account of a caller of a local provider, or changes its password. |
| `access credentials remove <id>` | Removes the account of a caller of a local provider. |
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
| `infra import <address> <id>` | Writes a resource that a failed apply left in the cloud into the state of the deployment. |

The commands of the group take the same options:

| Option | Effect |
| --- | --- |
| `--directory <path>` | The directory of the templates. The default is `deploy/tofu/azure`. |
| `--runtime <path>` | The directory of the files of the deployment: the values, the plan and the configuration of the backend. The default is `deploy/tofu/runtime/<profile>`. |
| `--var-file <path>` | The file of the values of the deployment. The default is the values of the runtime directory. |
| `--name <name>` | One output of the deployment. |

A path of the deployment is a path of the checkout: the command may run
in a directory of the checkout — the CLI is run through the workspace of
a package — and the path the reader named is read from the checkout
when it is not in the directory the command runs in. A path that is
absolute is the path it is, and a command that runs outside of a
checkout reads its paths from the directory it runs in.

The tool is found on the path, or in the variable `TOFU_BINARY`. A machine that holds no tool takes the one of the release of the tool: the CLI reads the archive of the system it runs on, proves it against the digest the release published, and writes the tool in the directory `.platform/tofu/<version>` of the working directory. The variable `TOFU_DOWNLOAD` set to `off` refuses that download, and the variable `TOFU_DIRECTORY` names the directory the tool is written in. The CLI refuses a tool that is older than the version the templates ask for, and it refuses a tool that is not there. The plan is read from the json the tool writes, and the text the tool writes is never parsed: a plan that the CLI reads another way is a plan nobody proved.

The words of the tool are shown on the standard error as they come when the tool takes a while: an operator who sees nothing for minutes does not know whether the CLI is working. The answer of the command stays on the standard output, and the words of the tool are never part of it.

`infra apply` shows the plan and asks before it applies: the plan is what the reader answers about, and the question names what the plan does, counted. The plan is shown before the question whatever the format of the answer is, and `--yes` does not hide it: the plan that is applied is the plan that was shown. `--dry-run` writes the plan and applies nothing.

A resource that a failed apply left in the cloud is not in the state, and the next apply refuses to create it again. `infra import` writes it into the state, and the deployment goes on. The identifier of the resource is the one the cloud names it by.

The wizard of a deployment does the same on its own: an apply that is refused because a resource is already there makes the wizard look for that resource in the cloud, write it in the state, and run the plan again. The resource is found by the name the refusal carries, and the provider of the deployment is the one that looks for it.

A refusal names the resource and the group of the resources it belongs to, and the two names are not to be mixed: the wizard takes the name that carries the kind of the resource. A resource that lives in another group, or in another subscription, holds the name the deployment wants and cannot be taken over: the wizard refuses and says where the name is held.

A resource that was deleted and not purged keeps the name it had, and the name cannot be used again: the cloud cannot see the resource, and the wizard cannot import it. The wizard asks the operator, and purges the resource when the operator says yes; what is left of the resource is lost. `--yes` answers the question of the purge with yes.

A resource that the deployment cannot take over, and whose name the deployment can change, is named differently: the wizard asks the operator, the name of the resource of the deployment changes, the values are written again, and the plan is run again with them. A wizard that did not find the resource says where it looked, and what the operator can do about it.

### 5.8 Deploy

The wizard of a deployment collects the values of a deployment and signs the operator in to the system of the provider. The provider is the command: `deploy azure` prepares a deployment on Microsoft Azure.

The wizard tells its steps as they happen, on the standard error: the wizard takes minutes, and an operator who sees nothing for minutes does not know whether the CLI is working. The answer of the wizard keeps the summary of what happened on the standard output.

The answer of the wizard is what the apply did: the plan is shown before the question, and a plan that is told again after the apply reads as a plan that is still to come. The resources the apply changed are named in the answer, and they are counted in the past, because an apply is an answer and not a question.

The wizard binds what the templates of the deployment cannot write. The public names of the deployment are custom domains of the gateway, and the provider of the infrastructure of Azure writes a custom domain without a certificate: it has no resource that binds the certificate of the environment of the container apps to a name of an application. The certificate of a name is bound by the client of Azure, and the environment of the container apps issues it and renews it. The wizard binds the certificate of every public name after the apply, and it says what it bound and what it could not bind: a binding that does not go through is not a failure of the deployment, and it is written again the next time the deployment goes on.

The wizard checks the registration of the tenant of the deployment before the first login. The issuer of the registration is the issuer that the provider names, character for character, and the secret of the client of the provider is a secret that the provider accepts: a registration that the provider refuses refuses every login of the tenant. The wizard asks the provider the way a login asks it — it presents the secret of the client and a code that does not exist — and it names what the provider refuses, with the code of the refusal of the provider. A provider that cannot be reached is not a deployment that is refused: the check says nothing, and the first login tells the rest.

The certificate of a name is validated with the record of the name. Every public name of the deployment is a record of `CNAME` at the application of the gateway, and the environment proves the ownership of the name with it. The validation of `HTTP` asks the name for a challenge, and the answer comes from the application behind the name: the gateway answers the calls of the callers and nothing else, and the challenge is not a call of a caller.

The reason of a refusal of the client of Azure is told, and not its traceback. The client of Azure writes a traceback when it refuses, and the reason of the refusal is the line of the exception that refused: an operator can act on the reason and on no part of a traceback.

The binding of a name waits for the records of DNS of the name, and the wait is a wait of minutes: the wizard says what it waits for as it waits for it, on the standard error. The job of the migration of the schema and the wait for Access to come up are told the same way: a deployment that goes on says so, and an operator — or an interface that runs the wizard — is never left with a silence that lasts minutes. A wait of the client of Azure that goes on too long ends: the client is stopped, and the binding is written again the next time the deployment goes on.

The wizard checks the delegation of the zone of the names before it applies the plan. The zone of the names is delegated at the registrar of the domain, and the delegation names the name servers of the zone. The environment of the container apps proves the ownership of a name with a record of DNS, and the record is read in the public DNS, where the records of a zone that is delegated elsewhere are not there. The wizard refuses the deployment before the plan is applied — the refusal names the name servers the delegation has to hold — and it tells the delegation after every apply: the delegation is the one record the operator writes, and a zone that is created again is served by other name servers.

A question of the wizard is asked in the words of the CLI, in lower case, and the default of the question is written in brackets after it: the operator answers nothing and takes the default. The question is written on one line and the answer is written on the next, after a marker.

A dry run writes nothing, tells the steps the deployment takes in the words of the deployment, and applies nothing. It signs nobody in either: it reads the facts the machine of the operator already holds, and it asks what it cannot read. The steps name what the deployment does and not the commands of the tool: the commands of the tool are the business of the tool.

| Command | Effect |
| --- | --- |
| `deploy azure` | Signs the operator in to Azure, asks the questions the deployment needs, writes the file of the values, creates the place where the state of the deployment lives, initializes the templates, shows the plan, and applies the plan once the operator confirms it. |

The wizard asks a question when it cannot answer it itself. A question that has a value in the example of the templates shows the value the operator may take, and a question that names the deployment has no default: the operator types it. The facts the provider reads from its own system are never asked again.

A question whose value is a selection is asked with the choices: the operator picks one of them, by its number or by its name, and an answer that is not one of them is asked again. A selection is never typed: the environment of the deployment is development, staging or production, and the wizard offers the three and takes the one that is picked. The default of a selection is the answer the operator confirms by answering nothing.

A question the deployment can do without is asked, and the operator may answer nothing: the zone of DNS that holds the names of the deployment is a zone the operator may write the records of by hand, and an empty answer leaves the records to the operator.

An answer that the deployment cannot use is refused at the question, and the question is asked again: an identifier that is not an identifier and a digest that is not a digest are refused there, and not at the end of the interview, where the operator has already answered everything. A question with choices is asked again when the answer is not one of the choices.

The wizard refuses what is missing before it asks anything. The templates of the deployment and their bootstrap, the tool that writes the infrastructure and the identity of the operator are checked before the first question: a wizard that answers twenty questions and refuses afterwards has taken the time of the operator for nothing. A dry run runs no tool, and it applies nothing.

The values of a deployment that is already there are the defaults of the questions: the wizard reads the file of the values of the deployment of the environment and offers every answer of it, so a second run is a matter of confirming them. The example of the templates is the default of everything the deployment does not hold, and the environment of the deployment that is already there is the default of the environment when it is the only one that is there.

The digests of the images of the platform are read from the release of the platform: the release carries the digest of every image it published, and a digest that is copied by hand is a digest that is wrong the day the tag moves. The release is the latest one the platform published, and the digests are written in the values of the deployment, so the deployment stays the one that was applied. The release is read before the provider is asked for a session, and a release the reader named and that is not there is a failure that names the release. The digest of the image of the client of PostgreSQL is read from the registry that holds it: it is the one image of a deployment that the platform does not publish. What cannot be read is asked, and the wizard says why.

The images of a release and the templates of the deployment are one release: an image reads the route table of the deployment, the files of its secrets and the variables of its environment, and an image that reads a document it does not know refuses to start. The wizard refuses a checkout whose templates are not the ones of the release, unless the **contract** of the templates is the same: the contract is the documents the templates write — the route table, the names of the secrets, the files of the secrets and the variables of the environment — and the contract of the release is the contract of the templates at the tag of the release. A checkout that is ahead of the release and writes the same documents runs the images of the release, and the wizard says that it does. A checkout whose documents changed is refused, and the refusal names every document that changed. A checkout that holds no tag of the release proves nothing, and the wizard refuses to run the images of another line than the line of the CLI with it.

The contract of a document is the document without its comments and without the addresses of the deployment: a comment is a word for the reader of the templates, and an address is a value of the deployment. A checkout that writes another address of a service writes the same document, and the images of the release read the address they are given.

The wizard writes the file of the values of the deployment, in the runtime directory of the deployment. The values that are there are the answers of an earlier run, and the wizard does not throw them away: when the operator chooses the same values, the file is left alone, and when the operator chooses other ones, the operator is asked whether the file is written again. `--yes` answers that question with yes, and `--force` writes the file without asking it. A reader who answers no keeps the values that are there, and the refusal ends with the usage-error-free status of a thing that changed underneath the command.

The answers of the operator are told before the deployment goes on, on the standard error: the deployment takes minutes, and an answer that is wrong is caught before the minutes and not after them.

A deployment that was not applied is refused with what the tool said, and not with the summary of the recovery: the reason of the failure of a deployment is the reason the tool gave.

The state of the deployment is locked when another run holds its lock, and the tool refuses to write the plan at all. A run that was killed leaves the lock behind it: the wizard names the lock, the one who holds it and the moment it was taken, and the operator says whether that run is still there. The lock is freed when it is not, and the refusal names the command that frees it when the operator says no.

The wizard goes on with the deployment. The place where the state of the deployment lives is the bootstrap of the templates, and the account of that state is closed to every address but the ones of the operator: the wizard reads the public address of the machine of the operator and offers it as the default of the question, and the operator confirms it by answering nothing or changes it by typing another address. The service that holds the state refuses a range of one address, so the range of an address is the range of four addresses that holds it, and a range that is narrower than the service takes is widened to the range that holds it. The variable `PLATFORMCTL_ADDRESS_SERVICE` names the service the address is read from, and `PLATFORMCTL_ADDRESS_LOOKUP` set to `off` refuses the reading. The group of the state is named after the deployment and the word `state`, and it is not the group of the deployment: the templates create that one. The configuration of the backend of the state is what the bootstrap answers, and the wizard writes it in the runtime directory as `backend.hcl`. The bootstrap itself runs in the runtime directory, in `bootstrap` under it: the state of the bootstrap is local, and it is written in the directory the tool runs in, and it holds the name of the account of the state of the deployment. The templates are then initialized against that backend, the plan is written and shown, and the plan that was shown is the plan that is applied, once the operator confirms it.

The shared key of the account of the state is off, and the access to the state is a role of Entra ID: the bootstrap grants the operator the role that reads and writes the state, and the identity of the operator is the one of the session of the client of Azure. The place where the state lives was created a moment ago, and the data plane of the account sees the container of the state a little after the management plane created it: the templates are initialized again while the init fails. The configuration of the backend may have changed, and the state of the deployment may have to move with it: the tool migrates the state when it can, and keeps it where it is when it cannot, and the operator is told when the state did not move. A state that could not be read is a state that is empty, and the plan of an empty state is the plan of a deployment whose resources are not in the state: the wizard names it in the question the operator answers, and the resources that the tool names are written in the state before the plan is run again. The wizard writes the configuration of the backend only when the tool answered with one: a tool that answers with a diagnostic instead of a configuration is a failure of the bootstrap, and the failure names what the tool said. A bootstrap that fails is a failure of the tool, and the wizard never hides it behind a configuration it read before.

The state of the deployment belongs to the tool: the wizard writes the values and the configuration of the backend, and the tool writes the state and the plan.

The wizard takes the options of the group:

| Option | Effect |
| --- | --- |
| `--directory <path>` | The directory of the templates. The default is the `deploy/tofu/azure` of the checkout the wizard finds by walking up from the directory it runs in. |
| `--runtime <path>` | The directory of the files of the deployment. The default is `deploy/tofu/runtime/<environment>`, and the environment is one of the values of the deployment. |
| `--answers <file>` | The file of the answers of the operator. The wizard asks nothing when the file holds every answer. |
| `--force` | Write the values over the values that are there. |
| `--release <version>` | The release of the platform the deployment runs: a version, with or without its tag, or `latest`. The default is the latest release the platform published, and the digests of the images are written in the values of the deployment, so the deployment stays the one that was applied. |

---

## 6. Output

### 6.1 Formats

| Format | Use |
| --- | --- |
| `table` | The default: a list of records is a table, and a single thing is a list of facts. |
| `json` | For scripts. Its shape does not change within a major version. |
| `yaml` | The same facts, for a person to keep. |

`--quiet` prints only the names of the things, which is what a script wants when it pipes the CLI into another command. The name of a thing is its id, its key, its slug, its subject or its name, in that order, and a thing that holds none of them is printed as it is.

Every table of the CLI is drawn the same way: the columns line up, the head of the table is bold, and a cell that is a state is painted with the colour of the state.

The plan of the deployment says what it does, counted, before it says what it does: the reader sees how many resources the plan touches before the plan itself. The plan that is shown before a confirmation is shown on the standard error, whatever the format of the answer is: the answer of a command holds the answer and nothing else.

### 6.2 Exit status

| Status | Meaning |
| --- | --- |
| `0` | The command did what it was asked. The help of the CLI is such a command. |
| `1` | The command failed for a reason not listed below. |
| `2` | Usage error: the command was asked something it cannot answer. |
| `3` | The caller is not authenticated, or its credential is no longer valid. |
| `4` | The thing the command names does not exist. |
| `5` | The thing the command names exists, and it changed underneath the command. |
| `6` | A policy refused the command. |
| `7` | A service of the deployment could not be reached. |
| `8` | The request was refused as invalid. |

The service's error code decides the status; when the code is unknown, the HTTP status of the answer decides it. A failure is a message on standard error, never a stack trace. A refusal that carries a hint writes the hint on the standard error too, after the refusal.

---

## 7. Safety of writes

- A command that changes something must ask for confirmation first, unless `--yes` is given. When no one can answer the prompt, the command is refused with the usage-error status.
- `--dry-run` sends nothing: the answer holds the request that would have been sent.
- A route table write names the revision it replaces.
- A record change carries the validator of the record it expects to change, and a failed precondition has its own status.
- An apply of the deployment applies the plan that was shown, and the question names what the plan destroys.
- The plan is shown before the question of an apply whatever the format of the answer is, and `--yes` does not hide it: `--yes` answers the question with yes, and it does not hide the plan the answer is about.

---

## 8. Files

| File | Holds |
| --- | --- |
| `${XDG_CONFIG_HOME:-$HOME/.config}/platformctl/config.json` | Deployment profiles. |
| `${XDG_DATA_HOME:-$HOME/.local/share}/platformctl/credentials.json` | The caller's credential, readable by its owner only. |

The CLI writes nothing else: no cache, no log, and no state whose meaning someone would have to guess.

The wizard of a deployment writes one more file: the file of the values of the deployment, in the runtime directory of the deployment. It holds no credential — the secrets of the deployment are generated by the tool and written into the vault of the deployment.

The tool that writes the infrastructure writes its own files: the working directory of the tool, the plan and the state of the deployment. They belong to the deployment and not to the CLI, and the CLI writes none of them itself.

---

## 9. The interface

`tui` draws the state of a deployment on the terminal of the reader. It is a client of the same services as the commands, and it asks them the same questions: it holds no policy of its own, and it decides nothing that a command does not decide.

### 9.1 What it needs

- A terminal: the interface reads the keys of the reader, and it refuses to start without one.
- The credentials of the shell: the administration of Access, the control plane of the gateway and the caller. A profile holds none of them (§3), and the interface reads none of them from a profile.
- The credential of the administration of a deployment of the machine, when the shell holds none: the deployment created it, and the interface reads it in the outputs of the deployment (§5.7), the first time a page needs it. The credential is held in the memory of the interface: it is written nowhere, and it is never drawn (§1.1). The deployment of a profile is the one whose files are on the machine and whose name, or whose address of Access, is the one of the profile; the address of Access the templates answer is checked against the profile, and a credential the templates answer for another deployment is refused.
- The credential of the deployment, when the credential of the shell is refused: the credential of the shell comes first, and a shell that holds the credential of another deployment is refused by this one. The interface reads the credential of the deployment it works on and asks again, and it says that the credential of the shell was refused.

### 9.2 The pages

| Page | What it reads | What it writes |
| --- | --- | --- |
| Deployments | The file of the profiles (§8). | The file of the profiles: a profile is edited, made current or removed. |
| A deployment | The probes of the gateway, of the control plane and of Access. | Nothing. |
| Tenants | The administration of Access. | A tenant, when the reader writes one. |
| Principals | The administration of Access: the principals of the deployment, or of the tenant the reader came from. | A principal, when the reader registers one. |
| Grants | The administration of Access: the grants of the deployment, of the tenant or of the principal the reader came from. | A grant, when the reader gives one, and the revocation of a grant. |
| A new deployment | The questions of the provider of the deployment. | The deployment itself, through the wizard of the CLI (§5.8). |

### 9.3 The keys

The interface reads the keys of the terminal and nothing else: a script that drives it writes the keys to the terminal, and a reader who presses them gets the same answer.

| Key | What it does |
| --- | --- |
| `↑` `↓`, `k` `j` | Moves the selection, and the selection stays inside the list. On the page of the deployments the selected deployment is the one the other pages work on. |
| `pgup` `pgdn`, `home` `end` | Moves the selection by a page, and to the first and the last row. |
| `/` | Filters the list: the rows that hold the text the reader types are kept, whatever the case. `enter` keeps the filter, and `esc` clears it. |
| `enter` | Opens the selected deployment or the form of the selected tenant, and sends the form the reader is in. |
| `n` | Opens the form of a new thing, according to the page. |
| `a` | Applies the deployment of the selected profile again: it opens the form of that deployment with the answers of its environment and with the images of the release, and the deployment is applied when the reader sends the form and confirms it. A deployment this machine holds no files of is not applied again, and the interface says so. |
| `e` | Opens the form of the selected profile or tenant. |
| `c` | Makes the selected profile the one of the machine. |
| `d` | Removes the selected profile or revokes the selected grant, after the reader confirms it. |
| `r` | Reads the page again. |
| `t` `p` `g` | The tenants, the principals and the grants. On the tenants, `p` and `g` are the principals and the grants of the selected tenant; on the principals, `g` is the grants of the selected principal; elsewhere they are the ones of the deployment. The reader goes back up the way they came down. |
| `tab`, `↓` | The next field of a form; `shift` and `tab` together, and `↑`, are the field before. |
| `←` `→` | Moves in the value of a field that holds a text, and changes the value of a field that holds a choice. `→` at the end of a value takes what the field offers. `home` and `end` are the ends of the value, and `ctrl` and `u` together erase it. |
| `space` | Changes the value of the field: the next choice, or the other side of a yes or a no. In a field that holds a text it is a letter. |
| `esc` | Clears the filter, goes back, or leaves the form. A form the reader wrote in is left after the reader confirms it. |
| `?` | The keys of the interface. |
| `q`, `ctrl` and `c` | Quits, and the terminal is given back the way it was found. |

The forms of a principal and of a grant hold what the interface knows: the tenant and the principal the reader came from, and the workspace of the profile. Their fields offer the tenants of the deployment, the principals of the tenant by their address, and the permissions, the workspaces, the routes and the operators the grants the interface has read name; a field takes any text, and an offer is never the only answer. A principal the reader names by its address is written in the grant by its identifier. A principal that is registered holds no grant, and the interface asks at once whether to give it one: a yes opens the form of a grant of that principal.

The work of the interface is named and timed: the line above the keys says what the interface waits for — the answers of a deployment, the deployment itself — and how long it has been waiting for it, and the frame is drawn again while the work goes on. A reader who sees a frame that does not move knows that the interface is at work, and not that it is hung. The reader who waits for a long work leaves it with `ctrl` and `c` together, and the terminal is given back the way it was found.

### 9.4 What it refuses

- A terminal that is not one: the interface is refused with the usage-error status.
- A page whose credential is missing: the page says why the credential of the deployment could not be read and which variable names it, and the other pages keep working.
- A write whose reader does not confirm it: nothing is written. The removal of a profile, the revocation of a grant and the creation of a deployment are confirmed by `y` and refused by `n` or `esc`, and a key that is neither leaves the question where it is.
- An answer that comes after the reader left its page: the answer is the answer of another page, and it is not drawn.
- A secret on the screen: the secrets of a tenant are written and never drawn.

### 9.5 The creation of a deployment

The creation of a deployment is the wizard of the CLI and not a second one. The interface collects the answers of the operator, writes them in a file of answers, and runs `deploy` with it: the wizard asks nothing, because every question of the file is answered, and the words of the wizard are the log of the interface. The deployment is applied with the plan the wizard shows.

The form holds what the wizard reads and what it offers (§5.8): the digests of the images of the latest release, the digest of the image of the client of PostgreSQL, the range of the public address of the machine, and the answers of the deployment of the chosen environment that is already there. An answer that is found is written in a field the reader did not write in, and never over what the reader wrote; the answers follow the environment when the reader names another one. What cannot be read is a line of the log, and its question is the reader's to answer.

The digests of the release that the reader left as they were found are not written in the file of the answers: the interface runs `deploy` with `--release` and the tag of the release the form showed, so the wizard reads the digests itself and proves the templates against that release (§5.8). A reader who names a digest brings the images, and the file of the answers carries them.

A deployment the interface applied is written as a profile (§3): the name of the profile is the prefix and the environment of the deployment, and it holds the address of the gateway and of Access under the public names of the deployment — the address of Access is the one the templates answered, when they answered one — and the workspace. A deployment without public names names no address of the gateway, and the interface says that the profile holds none. The profile becomes the current one when the machine has none, and a profile of that name that is already there keeps the settings the deployment does not name. The form opens on the answers of the deployment whose values were written last.

A deployment that is already there is applied again by its environment. The key `a` on the page of the deployments opens the form of the deployment of the selected profile with the answers of that environment and with the images of the release, the reader sends it, and the deployment is applied. The answers of a deployment this machine holds no files of are no answers at all: the interface says that the deployment cannot be applied again, and the reader names the environment in the form of a new deployment instead.

The subscription of the deployment is a question of the form when the session of the machine holds more than one: the wizard of the command line asks it at the sign in, and the deployment the interface runs has nobody to ask. The file of the answers names the subscription the reader chose as `subscription_id`, and the sign in takes the subscription the answers name without asking (§5.8). A `deploy` that holds several subscriptions, no answer and nobody to ask is refused, and the refusal names the subscriptions and the value that chooses one.
