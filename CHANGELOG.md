# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

### The services are named by their role: Gateway, Access, Data, Console

Two of the four pieces of the platform carried a word the other two did
not. "The access service" and "the data service" sat next to "the
gateway" and "the console" in every list of the platform — the tables of
the documentation, the areas of the console, the map of the status board
— and the suffix read as part of the name rather than as part of the
sentence. The names are the roles now: **Gateway**, **Access**, **Data**
and **Console**. The word is gone from the names, the titles, the labels,
the tables and the drawing of the atlas.

The identifiers of the services do not move: the environment of Access is
read with `ACCESS_*`, its metrics are published with `access_*`, and the
name it answers with in the health endpoint is still `access`. The
directories, the images, the compose keys and the files of the reference
implementation keep their names as well.

The migrations keep the comments they were applied with. The ledger of the
schema holds the checksum of every applied migration, and a migration that
is changed after it was applied is refused at the start of the next
deployment; a comment is not worth a database that refuses to start.

### The titles of the documents are short, and no sentence is said twice

The titles of the documents named their service and their subject at
once — "The access service — Specification", "The data service — HTTP
API" — and a reader of the index of the documentation read the name of
the service four times in a row before reaching the subject of the
document. The titles are the subject of the document now, and the group
of the document says which service it belongs to: the console shows the
group above the title of the document and in the breadcrumb of it.

The documents also said each other twice. Forty-six sentences were
carried by two documents at once: the rule of the decisions of the
platform was in the decisions of the three services, the rules of the
catalog of a workspace were in the architecture, the operations and the
specification of the data service, and the rules of the work were in the
architecture of the gateway and of the access service. Each of them now
says it once and points at the document that holds it.

The check of the documentation reads the sentences of the prose and
refuses a sentence that two documents carry, or that one document
carries twice. The changelog is not read by it: a release that repeats
the words of an older release is a changelog that tells the truth.

### The documentation page of the console reads like a document

The page of a document repeated its title twice — once in the frame of
the console and once in the document itself — and opened with a table
of contents that took the whole first screen, so that a reader saw a
list of headings instead of the document. The index held every link in a
box of its own, and the boxes were the page.

The page shows the document now. The title is said once, the measure
of the text is the measure of a document, and the table of contents is
closed until a reader opens it. The index names every document with the
paragraph that opens it — the words of the document itself, not a
description of it — so that a reader chooses a document by what it
holds and not by its name.

### The documents of the platform say each thing once

Ten documents said the same thing twice: the rule of a decision that
changes a contract was in five of them, the rule of the catalog of a
workspace in four, the rule of the model of a workspace in four, and
the dependency rules of the gateway in its specification and in its
architecture.

Each of them now says it once and points at the document that holds
it. The rule of a decision is in the decisions of the platform, the
rules of the catalog and of the model are in the specification of the
data service, and the dependency rules of the gateway are in its
architecture.

### The probes of the three services answer the same way

The probes of the platform were three answers of three services: the
data service answered `not_ready` where the other two answered
`not-ready`, and it did not answer `draining` at all, although it
drains. A deployment reads the probes of the three services with the
same code, and a probe that answers differently in one service is a
probe the deployment cannot read.

The probes are aligned now. The vocabulary of the status of the
readiness is the vocabulary of the platform — `ready`, `draining` and
`not-ready` — and the health of every service carries the status, the
name of the role of the service and the version of the release. The
data service says that it drains before it stops admitting requests.

Every service publishes a description of its API as well. The Access answers `GET /openapi.json`, the gateway answers it on the
surface the callers reach and the control plane answers the description
of its own surface, and the description of the data service holds the
probes of the service beside the paths of the scope of a workspace.

The check of the API reads the descriptions and holds them against the
routes the code registers, and it refuses the descriptions when their
probes do not agree: the same paths, the same fields and the same
vocabulary of the status.

### The services serve the endpoints their documentation names

The documentation of the API of a service and the routes of its code
were two copies of the same fact, and they drifted: the data service
served a route that moves a field of the model, and neither the API of
the release nor the description of the API named it. A client that
reads the description of the API did not know that the route existed.

The surface of the API is checked now. The check reads the routes the
code of every service registers — the paths of the scope of a
workspace, the constants of the gateway and the routes of its control
plane — and the endpoints the documentation names, and it refuses the
two when they part company. The description of the API of the Data is read as well, and it is refused when it does not hold every
route of the service.

The check found four gaps, and they are closed: the route that moves a
field is named in the specification of the data service and in its API,
and the description of the API holds the registration of a collection,
the removal of one and the move of a field.

### The console shows the documentation of the platform

The documentation of the platform was a tree of markdown in the
repository, and a reader of the console had to leave the console to
read it. The console shows the documentation now: the documents of the
platform, the contract of each of the three services and the contract
of the console, at `/docs`.

The console holds no copy of the documentation. The documents are read
when the console is built, and the build holds them — the image of the
console holds the build of the server and nothing else, and the
documentation is a part of that build. A document is parsed when a
reader asks for it, and the console keeps what it has read.

Every link of a document is rewritten to the address of its target: a
link that names another document is the address of that document in the
console, a link that names a place of a document is the address of that
place, and a link that names a file of the repository is a link to the
repository, at the tag of the version the console carries. A tag is a
name that does not move.

The names of the headings are the names of the documentation: they come
from the same place as the ones the check of the documentation
resolves, so a link that names a heading reaches it in the console as it
does in a rendered document. The parser of the markdown refuses what
the documentation does not write, and the suite of the console reads
every document of the repository: a document that the console cannot
show is found before a reader finds it.

### The names of the headings are checked

The links of the documentation were checked, but only half of them were.
A link that pointed at a document that is not there was a dead end the
check refused, and a link that pointed at a **place** of a document — a
heading — was a dead end it ignored. The name of a heading is the text
of the heading, in lower case, without its punctuation, with the spaces
replaced by hyphens, and it is the name the reader sees in the address
of a rendered document. A link that carries a name that is not there
leads nowhere, and the reader has no way to tell that it is broken.

The names are checked now. The check resolves the path of every link
and the name of every place it names: the headings of a markdown
document, and the elements of an html document. The names of the
headings are the names the rendered documents carry, two headings of
the same name carry two names, and a heading in a block of code is a
comment of a shell: it is not a heading of the document, and the name of
it does not exist.

The engine lives in `tooling/documentation.ts` now, and not in the
command: the command runs it, and the suite of the platform proves it.
The suite holds a documentation whose links are broken, and it has to
report them — a check that never fails is not a check.

### The server of a container is ready when it answers

The machine of the development waits for the PostgreSQL of its
container before it provisions the services of the platform, and the
wait was too kind: the readiness of the server was asked on the socket
of the container, and the port of the machine was only asked to accept
a connection. The image of PostgreSQL starts a **temporary** server on
the socket alone while it initializes the data directory of a fresh
volume — it listens on nothing else — and a wait that asks the socket
answers during that phase. The runner reached the provisioning of the
data service while the temporary server was still the only server, and
the published port of the container reset the connection of the client:
`connect ECONNRESET 127.0.0.1:38423`, a failure that names a symptom
and not a cause.

The readiness of the server is now asked **on the port of the machine**:
the runner sends the startup message of the protocol of PostgreSQL, and
a server that answers it — with the request of the authentication or
with an error — is a server a client can talk to. A port that accepts
a connection and resets it is not ready, and the run waits for the
server instead of failing on the first connection.

### The console is the one interface of the platform, on HonoX

The interface of the platform was five workspaces — the console, the
admin, the operators, the status page and the design system — and a
reader who wanted to change one page had to know which of the five held
it. They are **one workspace** now: `packages/console/`. The admin, the
operators, the status page and the design system are not workspaces any
more, and the entries below that made them workspaces of their own are
superseded by this one: their pages are pages of the console.

The console is an application of **HonoX**: the routes are files of
`src/app/routes/`, the pages are rendered on the server with `hono/jsx`,
and Vite builds the files of the browser and the server. The parts of a
page that live in the browser are **islands**: the board of the status
reads the probes again every ten seconds, the map of the platform lights
the exchanges of a request without a new page, a list is filtered with
rows instead of json, the members of a group are picked by their names,
and the masthead says how long the access of the caller to the data is
left. The console worked without a script; it does not any more, and a
page is still a document before its islands live.

What the console shows and what it calls do not move: the sign-in at the
access service with PKCE, the token of the caller kept on the server and
forwarded to the gateway, the scope of an operator read from the access
context on every page (`console.status`, `console.admin`,
`console.platform`), the refusals of the services shown as they are. The
console gains the pages of the history of a record and its rollback, of
the aggregates of a collection, of the registration of a team in one
batch, and of the export of the audit of a tenant.

The core of the console — `src/domains/` — imports neither the interface
nor HonoX, and `bun run architecture` holds it. The tests build the
console with Vite and serve the build against fakes of the contracts it
speaks. The image is built from `packages/console/Dockerfile`, and it
holds the build and the process, and no module of the development.

### The roles of a tenant

A permission is a flat key today: a grant names one permission, and a
tenant that has thirty of them grants thirty times. The **roles** name
the sets: a role holds permissions, and a grant may name the role
instead of the permission.

A role may **name another role**: the permissions of the named role are
the permissions of the role that names it, and the naming is transitive.
A role that names itself, directly or through other roles, would hold
itself forever and the decision would never answer — the schema refuses
the cycle, and the administration refuses it before the write.

The model of the access service is **eight tables** now: the role, the
permissions it holds and the roles it names join the five of §3, and a
grant names a permission **or** a role, and not both. The decision is
still **one statement**: it reads the roles the subject holds, expands the
nesting with a recursive statement of the same query, and the reason of a
refusal is the reason it was before.

The tables of the roles carry the **isolation of the tenants** like the
others, and the **empty scope is the scope of the platform**: the setting
of the scope leaves its placeholder on the session, and a policy that
reads `current_setting(…) is null` treats every row of the platform as
invisible on a connection that has run a scoped statement — the write of a
role is then refused by the policy of the table. The test of the schema
holds the rule for every table of the domain, so a table that is added
with the other form does not break the administration on the second
call.

The administration grew three endpoints — `PUT /v1/admin/roles`, `GET
/v1/admin/roles` and `DELETE /v1/admin/roles/{id}` — and the session of
a tenant is **twelve calls** now: the smoke test of a deployment calls
every one of them. The console has a page of the roles per tenant, and a
right is granted to a user or to a group by its permission **or by its
role**.

The machine of the development seeds the roles as well: the role of the
reader holds the permission of the reader, the role of the editor holds
the permission of the editor and names the role of the reader, and the
rights of the data are held by the principal and by the group of the
editors. Every seeded thing is used, and the two planes stay apart:
the rights of the data are on the route of the data service, and the
rights of the console are on the route of the console.

### The console draws what the caller may do as one ability

The console asked the services what the caller may do in twelve places,
and every place asked it again: `collection.actions.includes('create')`,
`collection.readableFields.includes(field.name)`, `scope.administers ===
'platform'`. The questions were right and the answers were right, and a
rule that changed in one page did not change in the others.

The console draws those answers as **one ability** now, built from the
two contracts it is a client of: the scope of the operator for the
console, and the metadata of the data service for a collection. The
ability is a mirror and never an authority — the access service decides
who holds a permission, and the data service decides what a permission
grants — and every rule of it is an upper bound of what the caller may
do: the console hides what the services refuse, and it shows what they
allow.

The library is `@casl/ability`, and the console holds neither of its
wildcards: no rule carries the action `manage`, and no rule carries the
subject `all`. A rule that grants no field names a field that no column
of a manifest can carry, because a rule without fields holds every field
of its subject.

### The operators speak of users and of rights

The **operators** package is the face of the administration of the Access, and it speaks the words of an operator: **users**, **groups**
and **rights**. A user is a principal of the access service and a right
is a grant of it, and the service keeps its own words: the operators
translate them.

The rights are **bound to a tenant** — `operator.rights.for('acme')` —
so that the tenant is not repeated in every call, and they name a user
the way a caller knows it: by its id or by its e-mail. The members of a
group are named the same way, and the operators translate them into the
identities of the provider that the service takes.

The lists answer a **page** of rows and not a body of json: the rows,
the number of rows in all, and whether there is a page after this one.

The scope of the operator is an **operator**: it holds the tenant of the
caller, its keys, and the rights it holds with the credential of its
scope. The routes of the console never handle that credential, and the
scope of an operator is opened with `openOperator`.

The console serves the access of one user at
`/operators/tenants/{slug}/users/{id}`: the rights it holds by itself,
and the rights it holds through the groups of it.

### The admin of a workspace, and the model of the workspace in realtime

The **studio** is retired. The **admin** takes its place:
`packages/admin/`. It is the workbench of the administrator of a
workspace, and it holds the two places a workspace has — the **content**
of its collections and the **data model** that shapes them. The console
serves it at `/admin`, and the rail of the workspace names the two
places and the collections of the section the reader is in.

The data model is the new part. A workspace holds its own **logical**
model, above the physical model of the deployment: the labels of the
collections and of their fields, the constraints, the relations, and the
fields that the workspace does not serve. The model is applied to the
manifest of the deployment when the catalog of a workspace is resolved,
and it is applied **in realtime** — a change of the model is the change
of the schema of the workspace for every request that follows it.

The model never creates a table and never alters one: the deployment
holds the tables, a field of the model is a column of the table of its
collection, and the type of a field is the type of its column. The
writes of the model require the permission `data.model.write`.

The API of the data service grows the paths of the model: `GET /model`,
and the writes of the collections, of the fields and of the relations.

### The two halves of the console are workspaces of their own

The **admin** and the **operators** were parts of the console. They are
**workspaces of the repository** now: `packages/admin/` and
`packages/operators/`. The admin holds the pages of the data of a
workspace and the client of the data service they read; the operators
hold the pages of the administration of the access service, the clients
of the administration and of the contract of the access context, and the
scope of the operator.

The console keeps what is the console: the session of the caller, the
routes, the frame of the pages and the sign in. It serves the pages of
the two halves, and the rules of the sheet that draw them travel with
them: the studio draws the rail of a workspace, the head of a column
that sorts and the split of a record, and no other page of the platform
carries those rules.

### The status page is a workspace of its own

The status page — the page that shows the state of the three services of
a deployment and the map of the platform — was a part of the console.
It is a **workspace of the repository** now: `packages/status/`. The
page is read by anybody, and it shows the facts of the deployment and
nothing about a tenant, a caller or an operator; the console is a
client behind the gateway, and a page that anybody reads does not belong
to it.

The console still serves the page at `/`: it is the one that knows the
urls of the services and the token of their metrics, it reads the probes
and hands the answers to the page, and the page draws them.

The pieces every page of the platform is made of — the table, the badge
of a state, the card, the form, the theme and the sheet — live in
`packages/ui/` now. The console and the status page share them, and
neither of them holds a copy of them: a design system that is copied
is a design system that drifts.

### The console of the platform

The platform had three services and no way to look at them: the data of
a workspace was reachable through the API of the data service, and the
administration of the access service was reachable through its
endpoints. Both are contracts of machines, and neither of them is a
place where a human reads.

The **console** is the web application of the platform. It is a client
of the platform, like any other client: it knows the contract of the
version `v1` of the API of the data service and the contract of the
administration of the access service, and nothing else. It never reaches
a database, it never reads a manifest and it never decides what a caller
may do.

**Two halves, one identity.** The **studio** shows the collections of a
workspace, the records, the aggregates and the audit, and it lets the
caller change what the policies of the deployment let it change. The
**operators** show the tenants, the principals, the groups, the grants
and the audit of the access service, and they let an operator act on
them. Both halves read the same session: the console authenticates the
caller against the access service with the authorization code flow and
PKCE, holds the token of the caller on its own server, and forwards it
to the gateway for the calls of the data. The browser holds an opaque
identifier of a session and nothing else.

**The scope of an operator is read, never assumed.** The console reads
the keys that the access service holds for the caller on the route of
the console, in the contract of the access context, and it acts with the
credential of the tenant of the operator or with the credential of the
platform. The keys of the route of the console are `console.status`,
`console.admin` and `console.platform`.

**Every page is a document.** The console is rendered on the server and
it works without a script of the browser: the pages are html, the forms
are forms, and the refusals of the services are the refusals of the
data service and of the access service, shown as they are.

**It is a workspace of the repository, and it is not a service of the
platform.** The console is deployed behind the gateway, it holds the
credential of its client and the credential of the operator, and it
never holds the private key of the gateway: a console that could sign an
identity would be a console that could impersonate the gateway. The
workspace is `packages/console/`, the documentation is in
`docs/console/`, and the image is built from
`packages/console/Dockerfile`.

### The atlas of the platform

The platform was three services, three contracts and a tree of
documentation, and a reader who wanted to hold the whole of it in one
view had to read all of it. The **atlas** is one page that holds it: the
callers, the three services, the stores, the identity provider, and the
contracts between them, drawn in the ink of the console.

It is a document of html with a script in it, and it is **not** a page
of the console: the console is rendered on the server and works without
a script, and the atlas is an instrument of reading, not an operator
surface. It has no build step, it lives in the documentation, and the
command that opens it is `bun run atlas`.

A request is a path over the map: a read, a write, a sign-in and an
administration light the hops they cross, in order, with the contract of
each hop and the refusal it makes. Every station and every hop of the
map is also a row of a table, so the atlas reads as a document with the
scripts of the browser disabled, and the check of the documentation
refuses it when a path of the code it names is not there.

The artifact is `docs/platform/atlas.html`, the brief of it is in
`.impeccable/surfaces/atlas.md`, and the documentation of the platform
points at it.

The **console** carries the same facts on the page of its status, and
it draws them in a style a reader of a status page can follow: the
participants of a request stand in lanes, and the exchanges of a request
are the rows that cross from one lane to another. A drawing of sixteen
exchanges between ten stations is a hairball; in lanes, no two lines
cross, and a path of a request is read from the top to the bottom. A
record is read and written on the same path, so the map offers one path
for it and not two. The rows are named by what they are in the story of
the platform — *the credential*, *the access*, *the permissions*, *the
rows* — and not by the contract they speak, and the lanes stand in the
order of the flow, so that the flow of a request is never interrupted by
a lane it does not cross. The
console holds no script and it works with the scripts of the browser
disabled, so the map is driven by the target of the url. The console
carries the map and nothing else: the explanations of the map are the
documentation's business. The console and the atlas hold the facts of
the platform in their own copy, and the check of the documentation
refuses them when they part company.

### The vestiges of the retired repositories are gone

The retirement of the three repositories left a few of their names
behind, and the mechanical renaming of the prose left a few of their
sentences half-renamed. A name that names a repository that does not
exist names nothing, and a sentence that names two services at once
says nothing either.

**What was left of the names.** The formatter of the platform ignored
the directory of the state of a development machine of the retired
repository of the access service: it ignores the directory of the
service now. The operations of the data service named two metrics that
the service does not publish any more: it names the metrics of the role
now, `data_access_requests_total` and `data_access_duration_ms`.

**What was left of the prose.** The renaming of the repositories and of
the vocabulary was mechanical, and it cut a few sentences in two and
joined the halves back to back: a list of the cutover of a tenant of the
access service lost two of its items, the backup of the service lost the
sentence that says what it backs up, the operations of the gateway lost
the step that names the pool of the database, and the decisions of the
data service lost the two decisions that the renaming swallowed. The
sentences are whole again.

**It is a change of the documentation only.** No behaviour of the
platform moves, and no version moves: the platform has one release line,
and the version lines the retired repositories carried are not continued
here.

### The vocabulary of the services is named by their role

The three services were published from three repositories of their own,
and the names they carried are the names of those repositories. Those
repositories do not exist any more, and a name that names a repository
that does not exist names nothing: a deployment that sets a variable of
a retired name sets a variable that no service reads, a dashboard that
watches a metric of a retired name watches a metric that is never
published, and an upstream that verifies a header of a retired name
verifies nothing.

The identifiers of a service carry the name of its role now:

| The identifiers of a service | The name they carry |
| --- | --- |
| The variables of the environment of the gateway | the prefix `GATEWAY_` |
| The variables of the environment of the access service | the prefix `ACCESS_` |
| The variables of the environment of the data service | the prefix `DATA_` |
| The metrics of the gateway | the prefix `gateway_` |
| The metrics of the access service | the prefix `access_` |
| The metrics of the data service | the prefix `data_` |
| The name a service answers with | the name of its role |

The cookies, the headers of the identity, the tables, the namespaces of
the shared state and the names of the services in the specifications
carry the name of the role as well, and the fixture of the signature of
the identity is signed again with the new type of the protected header.

**It is a migration of the deployments.** A deployment that sets the
variables of the retired names has to set the new ones, the dashboards
and the alerts have to watch the new metrics, and an upstream that
verifies the identity of a request has to verify the new header. The
specifications of the services list the names they read, and the
documentation of the platform lists the environment of a deployment.

**The check of the vocabulary is new.** It reads the files that name the
services and refuses the identifiers whose name is not the name of the
role of their service. It does not name the names that are gone: it
refuses every identifier but the ones of the roles, and a list of dead
ends is a list that has to be kept — and one that names them again.

### The services are named by their role

The three services were published from three repositories of their own,
and those repositories are retired. The names they carried are the names
of those repositories, and a name that names a repository that does not
exist names nothing: the platform names the three by their role — the
gateway, the access service and the data service — in the workspaces, in
the code, in the deployments and in the documentation.

**The vocabulary of a service moves with it.** What the specifications
describe is the contract of a service, and the contract carries the name
of the role of the service: the metrics, the headers of the identity, the
cookies, the tables, the namespaces of the shared state and the prefixes
of the environment are named by the role of the service they belong to
(decisions 11 and 13).

What the platform owns moves: the code of the workspaces, the
identifiers, the databases of the deployments, the clients of the
identity provider, the hosts of the development machine, the files of
the fixtures and the names of the directories of the state of a
development machine.

**The version numbers of the retired repositories are gone.** A fixture
that carried the version of a contract of a retired repository carries
the version of the platform now, and the version lines the retired
repositories carried are not continued: there is one version, the
version of the platform, and every file that names a release names the
same one — the package, the image, the runtime, the specification and
the documentation (decision 4).

### The repositories of the services are retired

The three repositories the services were published from do not exist any
more. Everything the platform said about them was a dead end: a clone
that failed, an image that was not published, a release that was not
reachable, and a document that sent an operator to a dead end.

The platform names one repository, one set of images and one release
line now, and the version of a service is the version of the platform.
The status of a specification is the release that carries it: the three
specifications are at `1.0.0`, and the check of the versions proves that
the package, the image, the runtime, the specification and the
documentation name the same release.

The compatibility suite clones the repository of the platform now, and
the manual of it names the platform and not a repository of a service.

**The check of the repositories is new.** It reads every file of the
platform and refuses the ones that name a repository the platform does
not have.

**The record of the retired repositories is gone.** The plan of the
merge named the three repositories, and the changelogs of the services
carried the version lines they had: the releases of a repository that
does not exist are not reachable, and the versions of a line that is not
continued are not versions. The plan of the merge is deleted, the three
services have no changelog of their own, and the changelog of the
platform is the record of the three of them.

**The check does not name the repositories that are gone.** It refuses
every repository but the one of the platform, and every image but the
three of it: a name that the platform does not own is a dead end,
whatever it is, and a list of dead ends is a list that has to be kept —
and one that names them again.

**What the repositories carried is gone with them.** The fixture of the
signature of the identity carried the revision of the repository the
gateway was published from: it carries the revision of the platform now.
The file of the ACL users of the shared state, the roles of the database
of the gateway and the identifiers of the deployments are named after
their role, and not after the repository they came from — and the
vocabulary of a service moves with them (decision 13).

### The evidence of the decisions is checked

The decisions of the workspaces record, for each decision, the place
that proves it. The citations were prose, and prose drifts: a test that
is renamed leaves a decision that points at nothing, and a suite that
no job runs leaves a decision that points at a test nobody executes.

The evidence is checked now. The check reads the column of the evidence
of the tables of the decisions, and it reports a cited path that is not
there and a cited test that the continuous integration does not run. The
continuous integration is read to answer the second question: the
commands of the workflows are parsed, the scripts of the workspaces are
read in their manifests, and the tests they name are the ones that run.

A cited suite that is not a test file — a conformance suite that the
tests of an integration import — is reached by a test that runs, and a
file that the runtime preloads runs with every test of its workspace.
Both are accepted.

### The runtime is tested on several versions

The gateway refuses to start on a runtime that does not have the
boundaries it relies on, and the versions of the runtime that are tested
are the ones of the contract and the one that is released. A runtime
that changes a boundary is a runtime that changes what the gateway
answers, and the continuous integration did not notice: it ran the
suites on one version only.

The continuous integration runs the suites of the gateway on the oldest
runtime that is supported, on the patch that is released with the
platform and on the newest one. The suites of the network are the ones
that hold the boundaries: the early answer of an upstream while the
upload runs, the cancellation of the producer of the body, the refusal
of the handshake of an upstream websocket and the upgrade of the caller
with the headers of the gateway.

The refusal itself is proved as well: the gateway is started on the
runtime the measurements of `docs/gateway/runtime.md` were made on, and
it has to refuse to start and to name the boundaries that are missing.

### The first deployment is written down

The operations of the platform held the three deployments, the
addresses, the probes and the secrets. The order of the steps of a
deployment that starts from nothing was in the documentation of the
three contracts, and an operator had to assemble it.

The walk is written down in [the operations of the
platform](docs/platform/operations.md): the secrets, the roles and the
database, the migrations, the workspace of the registry, the tenant and
the grants of the access service, the route table of the gateway, the
stack and the check that the three deployments talk to each other.

### The timeout of a handshake of an upstream is a timeout

The gateway held two timers for the same deadline: the timer of the
library of the websockets and its own. The timer of the library was
registered first, so it fired first, and it ended the handshake with an
error that the gateway read as a **network failure**. An upstream that
accepts the connection and never answers the handshake was therefore
reported as an upstream that is down, and not as an upstream that is
slow.

The refusal of a handshake of an upstream is reported apart from a
network failure (decision 3 of the gateway), and an operator could not
tell the two apart. The library now has a deadline that is later than
the one of the gateway, and the gateway's timer decides.

The suite that proved it was never run: `test/network/` of the gateway
holds the boundaries of the transport — the early answer of an upstream
while the upload runs, the cancellation of the producer of the body, the
refusal of the handshake of an upstream websocket and the upgrade of the
caller with the headers of the gateway (decision 1). It runs in the
continuous integration now, with the suites of the parsers and the soak
of the gateway.

### The client has a gate of its own

The command of the architecture of the platform ran the four workspaces
of the repository, and one of them had no architecture check: the
client is a published package, and it was the only workspace without a
gate.

The client has a gate now: it has no dependency, it imports nothing of
the service, and its modules have no cycle. A client that imports a
package drags that package into the tree of every consumer, and a client
that imports the source of the service cannot resolve it in the package
that is published.

### The baseline of the compatibility is a pinned revision

The baseline of the compatibility suite was the tree of the working
directory: the references of the suites were the workspaces of the
repository, and a suite compared the tree with itself. The suite proved
that the tree agrees with the tree.

The manifest pins a revision now, and the references are cloned at it:
the gateway and the access service of the pinned revision are tested
against the access service and the data service of the tree. The local
repository is the source of the clone when it holds the pinned revision,
so a runner that has the revision does not need the network to test it.

The candidates are the tree of the working directory, and they may carry
the changes they are meant to carry. The harness proves that the suites
did not change them: the tracked changes of a candidate are the ones of
the beginning of the run when the run ends.

### The workspaces live in `packages/`

The three workspaces of the platform moved from the root of the
repository to `packages/`: `packages/gateway/`, `packages/access/` and
`packages/data/`. The tree of the repository is the one of a
monorepo, and the name of a workspace is the name of its role.

The move touches the coordinates of the repository, and nothing else: the
contracts of the three services are the same, the images keep their
names, and the commands of the platform are the same with the path of
the workspace:

```bash
bun run --cwd packages/gateway test
bun run --cwd packages/access test
bun run --cwd packages/data test
```

The lockfile of the root, the manifests of the compatibility suite, the
Dockerfiles of the three images and the stacks of `deploy/compose` name
the new paths.

The runner of the compatibility suite of the access service finds the
root of the platform again: it read the manifest of the references in
the directory of the workspace, and the suite could not start at all.

### The platform starts with one command

`bun run dev` starts the whole platform in development mode: the
PostgreSQL server of the development machine, the identity provider, the
access service, the data service and the gateway.

The runner applies the migrations of the data service, it registers the
workspace of the development in the registry of the service, and it
seeds the access service with a tenant, a principal, a group and the
grants of the route. The login of a browser goes through the three
services: the gateway sends it to the access service, the access service
sends it to the identity provider, and the decision of the Access is what lets the gateway forward the request to the Data.

The runner of the gateway alone, with its fixtures and nothing but bun,
is `bun run dev:gateway`.

### The minimum environment of the platform

The file `.env.min` of the root holds the variables that the stacks of
`deploy/compose` refuse to start without, with the example values of a
development machine:

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

The check of the deployment (`bun run deploy:check`) fails the build
when a variable that a stack requires is not in the file.

### One directory of the deployment

Every file of a deployment is in `deploy/`, and the three services of the
platform are deployed there **on their own** and as part of the
**composition** of the three.

| Before | After |
| --- | --- |
| `gateway/deploy/`, `data/deploy/`, `docker-compose.yml` | `deploy/compose/`, `deploy/kubernetes/` |
| the route table and the bindings of the root of `deploy/` | `deploy/config/` |
| the fixtures of the data service in `data/deploy/secrets/` | `deploy/fixtures/secrets/` |

Each service has a stack of its own (`deploy/compose/gateway.compose.yaml`,
`deploy/compose/access.compose.yaml`, `deploy/compose/data.compose.yaml`)
and a base of manifests of its own
(`deploy/kubernetes/base/{gateway,access,data}`), and the composition of
the three is `deploy/compose/platform.compose.yaml` and
`deploy/kubernetes/overlays/platform`.

The stacks of a deployment — the four files of
`deploy/compose/production/` — take their secrets from the environment
of the orchestrator, and the secrets of the data service are files that
the secret manager of the deployment writes.

The check of the directory (`bun run deploy:check`) fails the build when
a deployment file drifts out of `deploy/`, when a service is not
deployed on its own and in the composition, or when an image of a
deployment does not carry the version of the platform.

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
