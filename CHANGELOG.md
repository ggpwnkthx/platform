# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

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
