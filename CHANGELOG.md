# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

### A crash of the tool that writes the deployment is told with the reason of the crash

The tool that writes the deployment crashes when it cannot read the
directory of the templates, and the crash is a stack trace of the tool:
the operator reads the trace and not the name of the file that is in
the way. The tool answers with the reason when it is asked what it
cannot read, and the CLI asks it.

A crash is not a state that becomes reachable: the templates are not
initialized again, and the operator is told at once.

The check of the deployment holds the directory of the templates to the
files of the templates: a file that is not a file of the templates is a
file that nobody owns, and the tool reads the whole directory.

### The credentials of a deployment on Azure are strong enough for the services that read them

The templates of the deployment on Azure generated their credentials as
passphrases, and the services count the bytes of a credential the way
they read it: a passphrase of forty characters is a credential of thirty
bytes, because the characters of a passphrase are the characters of
base64. The gateway and Access refused to start with the credentials
they were given, and the deployment was a deployment that was down.

The templates now generate their credentials as thirty-two bytes in
hexadecimal, and every one of the three readings of a secret counts
those as thirty-two bytes. The check of the deployment holds the
templates to the rule of the services: a credential that a service
counts in fewer than thirty-two bytes is reported before the
deployment, and not by a service that stops.

The shared credential of the decisions was missing on the side of
Access: the gateway presents its token on `POST /v1/decisions`, and
Access accepts it as the token of the deployment. The templates write
it once, and the two services hold the same value.

### The wizard of a deployment says what it is doing

The wizard of a deployment said everything at the end: the operator
watched a terminal that said nothing for the minutes the deployment
takes, and then read the same facts twice. The wizard now tells every
step as it happens, on the standard error, and its answer holds only
what the deployment did, on the standard output.

A dry run of the wizard printed the commands of the tool, with paths
that no operator would write: the steps of the deployment are now told
in the words of the deployment, and the commands of the tool stay the
business of the tool.

The questions of the wizard were sentences of documentation, written in
a capital, and they had no marker of the prompt. They are asked in the
words of the CLI, in lower case, with the default in brackets and the
answer on the next line. A refusal that names a value the deployment
cannot use names the question and not the variable of the template, and
it shows the shape the answer needs.

The plan of a deployment says what it does, counted, in the same words
everywhere it is told: the line above the plan, the question of the
operator and the answer of the command.

### The CLI says where you are and what you can do

The CLI told a reader who typed a word that names nothing that the
word names nothing, and left the reader to guess what to type next.
The refusal now names the command that is the closest to the word, and
the option that is the closest to the option. The help of the CLI
names the commands of the root as well as the groups, its columns line
up, and the usage of a command is the way the command is really
written. The help of a group is not a refusal any more: it ends with
the status of a command that did what it was asked, and `help` is a
command of a group as well as of the root. The version of the CLI is
one flag away, with `--version`.

The answer is painted when the terminal paints it: the thing that is
fine is green, the thing that is refused or unreachable is red, and
the head of a table is bold. The colour was a promise the CLI did not
keep before: the option was there and nothing was painted. The json and
the yaml hold no colour, so a script reads the same bytes either way.

Every table of the CLI is drawn by the same drawing now, so every table
of the CLI lines up the same way, and the plan of the deployment says
what it does, counted, before it says what it does. A refusal that
knows what the reader can do about it carries a hint, and the hint is
written under the refusal.

### The wizard of a deployment goes on with the deployment

The wizard of a deployment wrote the file of the values and told the
operator what to do next. It now continues on its own: it reads the
public address of the machine of the operator and offers it as the
default of the question of the addresses that reach the account of the
state, it runs the bootstrap of the templates, it writes the
configuration of the backend of the state, it initializes the templates
against it, and it shows the plan and applies it once the operator
confirms it. The plan that is applied is the plan that was shown. The
service that holds the state refuses a range of one address, so the
range of the address of the machine is the range of four addresses that
holds it. The values of a deployment that is already there are the
defaults of the questions, so a second run is a matter of confirming
them. The configuration of the backend of the state carries the name of
the file of the state, because the key of the backend is the name of
the blob that holds the state, and the shared key of the account of the
state is off.
The configuration of the backend of the state is written only when the
tool answered with one: the tool answers with a diagnostic when the
state of the bootstrap holds no output, and a diagnostic in the file of
the backend is a file the tool cannot read. A bootstrap that fails is a
failure of the tool, and the CLI does not hide it behind a configuration
it read before. The place where the state lives was created a moment
ago, and the data plane of the account sees the container of the state a
little after the management plane created it: the templates are
initialized again while the init fails. The configuration of the backend
may have changed, and the state of the deployment may have to move with
it: the tool migrates the state when it can, and keeps it where it is
when it cannot. The shared key of the account of the state is off, and
the access to the state is a role of Entra ID: the bootstrap grants the
operator the role that reads and writes the state. A dry run writes the values,
tells the steps and applies nothing, and the commands of the `infra`
group still do one step at a time.

### A resource that a failed apply left in the cloud is imported

A resource that a failed apply left in the cloud is not in the state of
the deployment, and the next apply refuses to create it again: the
error names the resource that is already there, and the CLI tells how
to write it in the state. The command
`platformctl infra import <address> <id>` writes the resource into the
state, and the deployment goes on. The wizard of a deployment does it on
its own: an apply that is refused because a resource is already there
makes the wizard look for that resource in the cloud, write it in the
state, and run the plan again. The refusal of the provider of the
deployment names the resource and the group of the resources it
belongs to, and the two names are not to be mixed: the name of the
resource is the one that carries the kind of the resource. A resource
that lives in another group, or in another subscription, holds the name
the deployment wants and cannot be taken over: the wizard refuses and
says where the name is held. A resource that was deleted and not purged
keeps the name it had, and the cloud cannot see it: the wizard looks for
it in the directory of the deleted resources of the cloud, asks the
operator, and purges it when the operator says yes. A resource that the
deployment cannot take over at all, and whose name the deployment can
change, is named differently: the wizard asks the operator, writes the
values again, and runs the plan again with them. A wizard that did not
find the resource says where it looked. The import reads the templates, and the
templates read the values of the deployment: the import is told where
the values are.

### The operator writes the secrets of the deployment

The vault of the deployment is written through its data plane, and the
data plane answers to the roles of Entra ID: the operator holds the
role that writes the secrets of the deployment, and the services hold
the role that reads them. The templates declare the identifier of the
operator, the wizard of the deployment reads it from the client of
Azure and writes it in the values, and the templates wait for the
permission to reach the token of the operator before they write the
first secret.

### The cache of the deployment is an Azure Managed Redis

Azure Cache for Redis is retired, and Azure refuses to create it: the
cache of the deployment is an Azure Managed Redis now, the service that
replaces it. The private endpoint of the cache names the new service and
its private zone, and the addresses of the cache are `rediss://`, because
the new service speaks TLS.

### The ingress of the services does not name an exposed port

The exposed port of an ingress is the port of a TCP ingress, and the
service refuses it on an app that speaks HTTP: the ingresses of the
deployment name the port of their service, which is the exposed port by
default.

### The zone of the database is the one Azure gives it

The zone of the server and the zone of its standby are read by the
provider, and a plan that tries to change a zone is a plan the service
refuses: a zone only moves when it is exchanged with the standby zone.
The templates hold the zones out of the plan now.

### The bootstrap registers the resource providers the deployment needs

The templates of a deployment do not register the resource providers of
the subscription: a deployment of the platform does not have the
permission to register them. The bootstrap runs as the operator, and it
now registers the providers the deployment needs before the first apply
of the templates, and it waits for them.

### The profile of the container apps is named after its tier

The provider sends the counts of a workload profile it does not know as
a consumption one, and the service refuses the counts of a consumption
profile: the profile of the environment of the deployment is named
`Consumption`, which is the name the provider reads.

### The plan of a deployment is shown before it is applied

The wizard of a deployment asked whether the deployment was applied
before it showed the plan: the operator answered about a number it had
not seen. The plan is now shown before the question, and the question
names what the plan does, counted: the resources it creates, the ones
it changes and the ones it destroys.

### The tiers of the templates hold the names the provider takes

The tier of the cache of Redis was `P1` and the tier of the profile of
Front Door was `Standard_Azure`: those are the names the portal of Azure
shows, and the provider takes `Premium` and `Standard_AzureFrontDoor`. A
plan of a deployment refused both. The defaults of the templates and
the example of the values now carry the names the provider takes.

### The tool that writes the infrastructure is downloaded when the machine holds none

A machine that holds no OpenTofu took the tool from the path and
refused the command when the tool was not there. The CLI now reads the
archive of the release for the system it runs on, proves it against the
digest the release published, and writes the tool in the directory
`.platform/tofu/<version>` of the working directory. The tool of the
path of the machine still comes first, `TOFU_BINARY` still names the
tool to run, `TOFU_DOWNLOAD` set to `off` refuses the download, and
`TOFU_DIRECTORY` names the directory the tool is written in.

## 1.0.4

The versions 1.0.1 to 1.0.3 were attempted and never shipped: the
images of a release that failed its gates were not withdrawn, and a
release that leaves an image behind is not a release. The entries of
this release are the entries of the release that ships.





## 1.0.0

The **first release of the platform**: the merge of the three
repositories into one repository with three workspaces.

The three services are the same services, with the same behaviour and
the same contracts. What changed is the shape of the source, the shape
of the continuous integration and the shape of the documentation.

### One repository, three workspaces

The three services were published from three repositories of their own,
and each of them is a workspace of this repository now:

| The service | The workspace |
| --- | --- |
| The gateway | `packages/gateway/` |
| The access service | `packages/access/` |
| The data service | `packages/data/` |

One `bun install` installs the three workspaces, one lockfile pins every
dependency, and the root of the repository is the only place a
dependency is declared.

The three services stay separate processes. A workspace never imports
the source of another one: the services talk over HTTP, and the merge
keeps that.

### One continuous integration

There were three workflows of the continuous integration, three
workflows of the release and three taggers. They were close to each
other and they drifted.

There is one workflow of the continuous integration, one tagger, one
workflow of the images and one workflow of the binaries. The jobs of the
three services are the jobs that existed, and they are the same jobs.

### One version line

The tag of a release is `v1.0.0` of this repository, and it publishes
the three images and the three binaries at the same version. The status
of a specification is the release that carries it.

The images carry the name of the role of the service:
`ghcr.io/ggpwnkthx/gateway`, `ghcr.io/ggpwnkthx/access` and
`ghcr.io/ggpwnkthx/data`. A deployment that pinned the name of an image
has to name the new one.

The **environment** of the services is renamed with them: the prefixes
`GATEWAY_`, `ACCESS_` and `DATA_` are the contract of a deployment, and
they are what a deployment of the platform reads.

The published client of the data service keeps its name:
`@data-backend/client` is a package that consumers install, and renaming
it would break them.

### One baseline of the compatibility

The baseline of the compatibility suite named two repositories and two
commits: the gateway and the access service had a source of their own.

The baseline is the revision of this repository now, and the references
of the suite are the workspaces of it. A run may still test a published
revision of a service: the environment names a repository and a commit,
and the suite clones them.

### One version

The three services were three repositories, and each of them carried a
version of its own. The platform has one version, and every file that
names a release names the same one:

| Workspace | The version of the platform |
| --- | --- |
| `packages/gateway/` | `1.0.0` |
| `packages/access/` | `1.0.0` |
| `packages/data/` | `1.0.0` |
### The gateway is the front door of the platform

The gateway was the only service an API caller reached, and the console
and Access were published beside it. The gateway is the only public
service of a deployment now: it serves the names of the deployment, and
it forwards the request to the service that answers under the name the
caller asked for.

Two things make it possible. The table of the routes names the names of
the gateway (`hosts`), and the endpoints the gateway serves itself — the
login, the callback, the logout, the document of the API — answer on
those names and on no other name: on another name, the path belongs to
the service that is reached under that name, and the route of the
console claims the path of the console. A route that forwards to a
service of the platform sends the name the caller asked for
(`upstreamHost`), so an issuer of tokens and a console answer under the
name of the deployment.

### The gateway terminates the TLS of the callers

The gateway did not terminate TLS: a proxy in front of it did. It
terminates the TLS of the callers when it has a certificate of the
deployment, and it obtains that certificate itself: it asks an authority
of certificates for a certificate of the names of the deployment, it
answers the challenge of the authority, it publishes the certificate in
the shared state — the replicas of a deployment serve the same
certificate — and it renews it before it expires, without closing the
connections that are open.

A deployment that has an edge of its own does not give the gateway a
certificate, and the gateway serves plain HTTP behind it.

