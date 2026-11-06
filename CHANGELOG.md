# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

## 1.0.9


## 1.0.8

### The outputs of the deployment are read as values

The tool answers with the metadata of every output — whether it is
sensitive and what its type is — and the value of an output is inside
that metadata. The CLI read the metadata and called it the value: the
outputs of the deployment were shown with their metadata, and a command
that reads a name of the deployment out of them read nothing.

### The log of the gateway names the shared state when it cannot be reached

The certificate of the deployment lives in the shared state, and a
gateway that cannot reach the shared state cannot read it: the log said
that the certificate of the deployment could not be read, and an
operator that reads it looks for a certificate that is wrong. The
certificate is not wrong: the state that holds it is not there, and the
log says that the shared state is not reachable.

### The cache of the deployment is reached over the private address of its endpoint

The zone of the private names of the cache was not linked to the network
of the deployment: the templates linked the zone of the database and the
zone of the vault, and they left the zone of the cache to Azure, which
writes the link of the zone of a private endpoint when it writes its
zone group. The resolver of Azure answers a zone for the networks that
are linked to it, and for no other, and the records that the zone group
of the endpoint writes are not answered for a network that is not
linked to the zone. The name of the cache resolved to the public address
of the cache, which is closed, and the services of the deployment could
not reach the cache at all: the gateway reported that the session store
was not reachable and that the shared state was not reachable, and it
could not read the certificate of the deployment, which lives in the
shared state.

The zone of the cache is linked to the network of the deployment now,
like the zone of the database and the zone of the vault.

The port of the cache is the port of the database of the cache, and the
database of an Azure Managed Redis answers on the port `10000`: the port
of the Redis of the community edition (`6379`) is not the port of the
cache. The templates take the port the service reports, and the port
`10000` when the service reports none.

### The public names of the deployment have a certificate

The templates wrote the public names of the deployment as custom domains
of the gateway, and they wrote them without a certificate: the provider
of the infrastructure of Azure has no resource that binds the
certificate of the environment of the container apps to a name of an
application, and it writes a custom domain without a certificate. A name
without a certificate is a name that answers in plain HTTP only, and the
callers of the deployment reach the names over HTTPS.

The wizard of the deployment binds the certificate of every public name
after the apply, with the client of Azure: the environment of the
container apps issues the certificate of the name and renews it, and the
ingress of the environment terminates the TLS of the callers with it.
The wizard says what it bound and what it could not bind, and a binding
that does not go through is not a failure of the deployment: it is
written again the next time the deployment goes on.

### The deployment takes the images of the latest release, and it proves that they read the templates

The wizard read the digests of the images of the release of the version of
the CLI, and it refused a checkout whose templates were not the ones of
that release: the images of a release and the templates of a deployment
are one release, and an image that reads a document it does not know
refuses to start.

A commit is more than its documents: a commit that moves a private
endpoint, or that keeps more than one revision of an application, writes
the documents of the commit before it. The wizard compares the
**contract** of the templates now — the route table, the names of the
secrets, the files of the secrets and the variables of the environment —
and the deployment runs the images of the release when the contract of
the checkout and the contract of the release are the same. A checkout
whose documents changed is refused, and the refusal names every document
that changed.

The release of the deployment is the latest one the platform published,
and the digests of the images are written in the values of the
deployment: a deployment runs the newest images that were published, and
it stays the one that was applied. The release of the CLI is the release
of the deployment when the latest one cannot be read. The tag of the
latest release is read from the address of the releases and not from the
API of the repository: the API answers a machine that asks it often with
a refusal, and the address of the release answers always.

### The cache of the deployment on Azure is reached over its own zone of the private names

The cache of the deployment is an Azure Managed Redis, and the templates
gave its private endpoint the zone of the Redis Enterprise,
`privatelink.redisenterprise.cache.windows.net`, a zone the name of the
cache is not a name of: the name of the cache resolved to the public
address of the cache, which is closed, and the services of the
deployment could not reach the cache at all — the gateway reported that
the session store was not reachable and that the shared state was not
reachable, and it could not read the certificate of the deployment,
which lives in the shared state.

The zone of the cache is the zone of the private names of Azure Managed
Redis, `privatelink.redis.azure.net`, the zone of the name of the
cache, `<the-name>.<the-region>.redis.azure.net`.

The subresource of the endpoint stays `redisEnterprise`: the Azure
Managed Redis is served by the resource provider
`Microsoft.Cache/redisEnterprise`, and the name of the subresource is
the name of that provider, not the name of the service. Azure refuses
the endpoint with any other name, and the answer is `GroupIds weren't
provided or do not match 'redisEnterprise'`.

### The deployment on Azure writes its resources in the subscription of the deployment

The provider of Azure wrote its resources in the subscription of the
session of the operator, and the subscription of the session is not
always the subscription of the deployment: a session that points at
another subscription writes the whole of the deployment there. The
wizard of the deployment reads the subscription of the session and
writes it in the values of the deployment, and the templates pin it:
the resources of the deployment are written in the subscription that
the values name, and in no other. A value that is empty takes the
subscription of the session, and the tenant of the deployment is pinned
the same way: the application of Access is written in the tenant of the
deployment, and not in the tenant of the session.

### The two stacks of a deployment read Azure with the same provider

The templates of the deployment pinned the provider of Azure to `~> 4.0`
and the bootstrap pinned it to `~> 4.81`: two stacks of one deployment
that read the resources of Azure with two versions of the provider are
two stacks that write the state of one deployment with two dialects. The
two pin the same version now, and the files of the lock of the providers
say so.

### The vault of the deployment has the private endpoint it promised

The templates wrote that the services of the deployment reach the vault
over a private endpoint, and no private endpoint was written: the vault
was reachable from the internet, and the services of the deployment
reached it over the public address. The vault has a private endpoint
now, in the network of the deployment, with the zone of the private
names of Azure linked to the network. The public address of the vault
stays open, because the operator writes the secrets of the deployment
in it from a machine that is not in the network of the deployment; the
access of the vault is a role of Entra ID, and the role is what
protects the secrets.

### The backup of the database is kept in a second region when the server is zone redundant

The backup of the server of PostgreSQL was kept in one region, and the
server was zone redundant: a zone that is lost takes the server with it,
and the backup of the server was in the zone that was lost. The backup is
kept in a second region when the server is zone redundant, and a server
that is not zone redundant has no standby zone and no second region.

### The logs of the deployment are kept for ninety days, and the time is a value

The workspace of the logs kept them for thirty days, and the time was
written in the templates: a deployment could not keep its logs longer
without a change of the templates. The time is a value of the
deployment now, and it is ninety days by default.

### The applications of the deployment keep more than one revision

The applications of the deployment kept one revision, and a revision
that was broken was replaced by another one while the first one was
taken away: a deployment that was rolled stopped answering while it was
rolled. They keep more than one revision now, and a revision that is
written is the one that answers.

### The state of the place where the state lives is not written in the checkout any more

The bootstrap of the deployment is the only stack that runs without a
backend, and its state is local: the state holds the name of the
account of the state of the deployment, and it was written in the
checkout of the templates, which every machine that clones the
repository holds. The wizard of the deployment copies the templates of
the bootstrap into the directory of the files of the deployment and runs
them there, and the state of a bootstrap that ran before is taken with
it.

### The console of the deployment reaches the services at their addresses in the environment

The console reached Access and the gateway at their public names, and
the environment of the console is joined to the network of the
deployment: the network has no road to the internet, and the call to a
public name waits for a timeout that never ends. The console is ready
when Access answers its discovery document, and it could only know it
when Access answered, and Access never answered: the platform said
that the probe of the readiness of the console timed out, and said
nothing about why.

The console reaches Access and the gateway at the addresses they answer
on inside the environment now. The browsers are not the console: they
reach the services at their public names, and the addresses they use
are the ones the discovery document of Access carries.

### The console answers its readiness inside the budget of the probe that asks for it

The probe of the platform gives the console three seconds, and the
console waited ten for the discovery document of Access: the probe
timed out, and the console never answered the question it was asked.
The readiness of the console is given the budget of a probe now, and a
console that cannot reach Access answers that it is not ready.

### The roles of the deployment are created by a job that can run again

The job of the migration created the role of Access and stopped when
the role was there: a job that runs again at every apply of the
deployment left the role with the password of the first apply, and
Access answered that the password of its role was refused. The roles
are created when they are missing, and their passwords are written every
time.

The grants of the roles landed in the database of the maintenance of the
server, and not in the database the roles work in: the grant of the
schema `public` was a grant of another database, and the role of Access
could not create the eight tables of its schema. The administrator of
the server answers at the database of the platform now, and the owner
of the schema of Data has the right to create the schemas of the
service in the database of Data.

### The token of the control plane holds a scope that the control plane knows

The token of the operator held the scope `admin`, and the control plane
knows three scopes: `read`, `operate` and `config`. A control plane
that is given a map it does not understand stops before it listens: the
deployment was up, and the control plane of it was not. The token
holds the scope `operate` now, and the deployment serves its route table
from a file of the vault and not from the store of the control plane.

### The wizard of a deployment starts the job of the migration

The job of the migration waits for the hand of the operator, and the
services that read the database of the deployment do not start without
the roles it creates: a deployment that was applied was a deployment
whose Access answered that the password of its role was refused. The
wizard starts the job when the deployment is applied, and the operator
starts it by hand when the wizard could not.

### The images of the platform carry the fix of the advisory of musl

Alpine has published a fix for an integer overflow in `musl`, and the
base image of the images of the platform is a build of a tag that was
not rebuilt: the images carried the library that the fix is for, and
the scan of the image refused every image of the platform.

The images patch the library in the base image, and the patch is the one
of Alpine: the version of the fix is the floor of the patch, and the
patches that follow it are taken as well. The check of the images holds
every advisory that the images have to carry the fix of, and not one.

### The services of the deployment reach each other at the address of the ingress
The address of a service inside the environment of the container apps is
the name of the environment and the port of its ingress, and the
templates wrote the port of the container on the name of the
environment: the traffic to that port is dropped, and every call to
every service of the deployment waited for a timeout that never ended.
The gateway answered `504` for Access and for Data, and the console
never became ready: the console is ready when Access answers its
discovery document, and it could not reach it.

The upstreams of the route table name the ingress of the environment,
and the three services that are not published have an ingress that
speaks the plain HTTP. The gateway is published, and its ingress
terminates the TLS of the three public names: the console reaches the
gateway at its public name.

The route table of the gateway is written in the vault, and the gateway
reads it when its revision starts: a table that changed and a gateway
that did not start again is a gateway that serves the table of the last
apply. The digest of the table is a variable of the gateway, and it is
what makes the revision start.

### The push of a commit cuts the tag of the release

The workflow of the tag was started by the completion of the CI of the
commit, and a push that carried a version that went up waited for the CI
to end before anything happened: the run of the workflow said that it
was skipped, and the reason of the skip was the conclusion of another
run. The push of the commit starts the workflow now, and the workflow
waits for the CI of that commit: the version of the tag is the version
of the package of the root, and a CI that is red cuts no tag.

The tag is still pushed with the token of the workflow, and GitHub
starts no workflow for a push that carries it: the release is dispatched
by the workflow that cut the tag, and a tag that a person pushes starts
the release by itself.

### The cache of the deployment holds the sessions and the state that the replicas share

The deployment puts the sessions of the callers in the database `0` of
the cache and the state that the replicas share in the database `1`, and
the templates created the cache in the Balanced tier: the Balanced tier
holds one database, and the shared state of the deployment was in a
database the cache did not have. The gateway served the sessions of the
callers and said that the shared state was not reachable, and the rate
limits and the cached decisions of the deployment were not kept.

The tier of the cache is Premium now, and the tier is the one the
deployment needs: the tier that holds more than one database.


## 1.0.7


## 1.0.6


## 1.0.5

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

### The place where the state of the deployment lives is taken over when it is there

The state of the place where the state of the deployment lives is a file
of the machine of the operator, and the file is lost when the
directory of the templates is cleaned: the resources of the place are
there, and the state of the place does not know them, and the apply
refuses to create them again.

The resources that are already there are written in the state of the
place and the place is created again, the way the resources of a
deployment that a failed apply left behind are taken over. The tool is
told the values of the place when it writes a resource in its state: a
resource that is written with other values than the ones of the apply
is a resource the next apply wants to change.

A resource of another group is not taken over: the name is not ours,
and the state of the deployment does not belong to a group that is not
its group.

### A role assignment that is already there is taken over

The provider refuses to create a role assignment that is already there,
and it names the identifier of the assignment instead of the identifier
of the resource: the state of the deployment cannot take it over, and
the place where the state of the deployment lives is never created.

The assignment is found in the directory of the assignments of the
subscription, and the state of the deployment takes it over.

The CLI says what it did when it cannot find the assignment: the
operator is not left with the refusal of the provider and no word of
what the CLI did.

The name of an assignment in the cloud carries the dashes of the
identifier, and the refusal of the provider does not: the assignment is
found by its name and not by the end of its identifier.

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

The answer of the wizard held the plan of the deployment after the
apply: a plan that is told again once it is applied reads as a plan
that is still to come, and the operator reads the numbers of the plan
as numbers of work that is left. The answer holds what the apply did,
and it counts it in the past, because an apply is an answer and not a
question.

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

### The container of the state is named by the identifier of the account

The templates of the container of the state named the account that
holds it by its name, and the provider of Azure deprecated the argument
that does that: the container is named by the identifier of the account
now, and the warning the provider wrote on every bootstrap is gone. The
name of a resource is the name of a resource, and the identifier of a
resource is not its name.

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

### The deployment writes the records of the names of the deployment

The names of the deployment are the subdomains of a domain, and the
domain is a zone of DNS. The operator wrote the records of the names by
hand: a `CNAME` of every name at the application of the gateway, and a
`TXT` record that proves the ownership of every name. The records are
the records of a zone, and a zone of Azure holds them: the deployment
writes the records of the names when the operator names the zone, and
the operator writes one thing only — the delegation of the zone at the
registrar, with the name servers the deployment answers with.

A zone that is named in the group of the operator outlives the
deployment, and the deployment writes the records of the names in it
and creates nothing. A zone that the deployment creates lives in the
group of the deployment and dies with it.

### The names of the deployment are labels in a zone

The wizard asked for the public name of every service and then for the
zone that holds the names: the zone was asked twice, in two shapes, and
the names of the deployment could be outside the zone the operator
named. The names of the deployment are the labels of the services in the
zone of the deployment, and the wizard asks for the zone and for the
labels: the public name of a service is the label and the zone, and the
templates write the name once.

A deployment that names its zone in the values file and deploys the
templates of an earlier version has to name the labels and the zone
instead of the names: the names the templates compose are the names the
deployment answered under.

### The paths of a deployment are paths of the checkout

The CLI reads the paths of a deployment from the directory it runs in,
and the CLI is run through the workspace of a package: the workspace is
a directory of the checkout, and a path the operator typed is a path of
the checkout and not a path of the workspace. A command that named the
templates of the deployment was told that the directory of the
deployment is not there, and the path it looked for was the path of the
workspace.

The CLI finds the checkout by walking up from the directory it runs in,
and it reads a path that is not there from the checkout. A path that is
absolute is the path it is, and a command that runs outside of a
checkout reads its paths from the directory it runs in.

The script of the root that runs the CLI runs it in the directory the
operator is in, and not in the workspace of the package: the working
directory of a command is the working directory of the operator.

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

### The name of the server of the database of a deployment on Azure resolves

The deployment on Azure created the zone of the private names of the
database and did not link it to the network of the deployment. The
resolver of Azure answers the zone for the networks that are linked to
it, and for no other: the name of the server of the database did not
resolve at all, and Access and Data failed to start with a name they
could not find.

The templates link the zone of the database to the network of the
deployment, the way the zone of the cache is linked to it by the
private endpoint of the cache.

### The public key of the identity of the gateway is written under the name that Data reads

The deployment on Azure wrote the public key of the identity of the
gateway into the file that is named after the secret that carries it,
`identity-signing-public-key`, and the bindings of Data named the
file of the key: `identity-signing.public.pem`. Data read a file that
was not there, and refused to start.

The name of a secret of a vault is a name of dashes, and the name of a
file of the platform is a name of dots: the templates write the file
of the key under the name that every other deployment gives it.

### The images of the platform carry the fix of the advisory of zlib

Alpine has published a fix for a heap overflow in `zlib`, and the base
image of the images of the platform is a build of a tag that was not
rebuilt: the images carried the library that the fix is for, and the
scan of the image refused every image of the platform.

The images patch the library in the base image, and the patch is the one
of Alpine: the version of the fix is the floor of the patch, and the
patches that follow it are taken as well. Every stage of every image
starts from the stage that patches the library, and the check of the
images holds them to that rule: a stage that starts from the image of
the runtime carries the library that the fix is for.

### The release of the binaries installs the dependencies of the platform before it packs the client

The release of the binaries packed the client of Data without
installing the dependencies of the platform, and packing a package runs
the script of the package: the client is compiled with the compiler of
TypeScript, and the compiler is a dependency of the platform. The job
asked the image of the runner for a compiler, and the image of the
runner changed: the release of the binaries failed in ten seconds, and
the release held no client and no binary of the CLI.

The job installs the dependencies of the platform before it packs the
client, and the check of the workflows holds every job that packs a
package to that rule: a job that packs a package and installs nothing
is reported.

### The wizard of a deployment refuses the templates that are not the ones of the release of its images

The wizard pinned the images of a release and the templates of the
checkout, and it did not compare the two: a checkout that is ahead of
the tag of the release holds templates that the images of the release
do not know. A gateway that reads a route table of a version it does
not know refuses to start, and the operator reads it in the log of a
container that was deployed minutes before.

The wizard compares the templates of the checkout with the tag of the
release and refuses the deployment when they are not the same. An
operator who names the digests of the images of another build in the
file of the answers brings the templates of that build too, and the
wizard does not compare the two.


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

