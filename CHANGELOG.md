# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

### A caller is asked for the address of its login

A shared client serves several tenants, and the login had nowhere to ask which one the caller belongs to: the tenant of the login was the default tenant of the platform, and a caller of another tenant was sent to the provider of the wrong one.

Access asks for the address of the caller now, with a page of its own: one field, one button, no script and no style of another site. The domain of the address names the tenant with that `email_domain`, and the browser goes to the provider of that tenant. The page names no tenant of the platform: an answer that says whether a domain is known tells a caller which tenants the platform holds. An address that names no tenant is the default tenant of the platform, and the login goes on.

The provider of a login is the default provider of its tenant now, and the specification said so already: the registration of the tenant is the default provider, and a caller is never asked to choose between the providers of a tenant that has one. A tenant whose default provider is disabled and that has several providers still answers with the page that lists them.

**Contract:** [access spec §5.2](docs/access/spec.md#52-resolving-the-tenant), [access spec §5.2.1](docs/access/spec.md#521-resolving-the-provider), [access spec §5.2.2](docs/access/spec.md#522-the-address-of-the-login).

### A domain names the tenant and the provider of a login

The routes of the logins are a table of their own now, `sso_routes`: a domain of addresses, and an address of its own, name the tenant of a login and the provider the login signs in at. A tenant holds several domains, and a domain of a tenant may name a provider of its own — the staff of a tenant sign in at one directory and its contractors at another, and nobody is asked to choose.

A route is a hint that the platform proves before it routes anything. The owner of a domain publishes a TXT record of `_access` of the domain that carries the challenge of the route, and the operator of the platform may vouch for a domain instead: a tenant proves its own domains and nobody else's, and a route that waits for its proof routes nothing. The address of a caller that names no proven route goes on with the default tenant of the platform, and the default provider of that tenant.

The login of a tenant that signs its people in at several providers asks the caller for the address of the login now, and the address names the provider the caller signs in at. A tenant with one provider asks nothing: the browser goes straight to the directory of the tenant, as it did.

The domains the tenants of the platform already carry are proven: the operator of the platform wrote them, and the operator is the proof of a domain. The domain of a tenant that a tenant credential writes waits for its proof.

**Contract:** [access spec §3.13](docs/access/spec.md#313-sso_routes), [access spec §5.2.2](docs/access/spec.md#522-the-address-of-the-login), [access spec §10.18](docs/access/spec.md#1018-the-routes-of-the-logins).

### The routes of the logins are administered from the CLI

The CLI reads and writes the routes of the logins: `platformctl access routes list` shows them, `platformctl access routes create` registers one, and `platformctl access routes verify` proves it. The command that registers a route prints the challenge of the domain and the record that has to carry it.

**Contract:** [cli spec §5.5](docs/cli/spec.md#55-access).

### The catalog of the providers of the platform

Every provider of a tenant is an OpenID Connect provider, and there is no vendor in the code of the login — but registering one meant knowing the issuer of the vendor, the scopes it knows and the steps of its registration.

The CLI holds the catalog now: `platformctl access catalog list` shows the providers the platform supports out of the box, and `platformctl access catalog steps --key <key>` shows how the client of Access is registered at one of them. A preset fills the scopes and the algorithms of a provider of a tenant or of the tenant itself, and it never constrains what a tenant registers: the preset `custom` is the free-form path.

**Contract:** [cli spec §5.5](docs/cli/spec.md#55-access).

### The tree of the platform holds no advisory of node-forge

Four advisories of `node-forge` were published on the tenth of November: an Ed25519 verification that accepts small-order public keys, a TLS client that crashes on a handshake it does not like, and a regular expression that a header of an answer of `forge.http` may make slow. The tree of the platform holds `node-forge` — the gateway asks for the certificates of a deployment with it — and the lockfile held the version the advisories are about, so the audit of the dependencies refused every build of the platform, and the tag of the release with it.

The version that carries the fix is 1.4.3, and the dependency that wants `node-forge` accepts it: the lockfile moves by one line, and the audit of the tree is green again. The rows that are already written keep the value they hold: the fix is a fix, and it changes nothing of what the platform does.

## 1.3.1

### The first identity of a tenant administers it

A tenant that provisioned its identities kept its administration for the operator of the platform: the flag was off by default, and the first person who signed in at the provider of the tenant was nothing. Every tenant of a deployment had to be granted its administration by hand, one call per tenant, before anybody could do anything in it.

The flag is on by default now. A tenant that is created and names neither hands the administration of itself to the first identity that signs in at it: the principal that is created first is given the grant that opens the administration of the tenant, and the ones that come after are given nothing. A tenant that provisions its identities by hand turns it off, and the operator of the platform grants its administration by hand.

The rows that are already written keep the value they hold: the default is the value of a tenant that is created, and a tenant that exists keeps the administration it has. A change of a flag is the work of the operator of the tenant, and it is audited.

**Contract:** [access spec §3.1](docs/access/spec.md#31-tenants), [access spec §6.4](docs/access/spec.md#64-unknown-identity).


## 1.3.0

### A tenant signs its people in at several providers

A tenant held the registration of one provider in its own row, and the platform could not serve a tenant that signs its people in at two: the login had nowhere to ask the caller which one it signs in at, and the administration had no endpoint for a second provider.

The providers of a tenant are rows of their own now, `tenant_providers`, and the row of the tenant keeps the registration of the **default** provider — the one the administration writes — because that is the surface the administration already had. The two are written by the same statements: the default provider of a tenant and the tenant itself are one change, and a tenant whose default provider row is missing refuses every login.

The slug of a provider is the handle a login names, and it never changes: the mapping key of a principal is the triple `(tenant, provider, subject)` now, because two providers of a tenant hand out the same `sub`. A person who signs in at two providers of a tenant has two principals and two sets of grants, and the two know nothing of each other; linking two external identities to one principal stays deferred.

The login of a tenant that has several providers and a request that names none is a **choice**: Access answers the authorization with a page that lists the providers of the tenant, and every entry is a link back to the authorization with the request of the caller and the slug of the provider. The choice is the caller's, the page writes no state before it, and it carries no script and no style of another site.

The administration has three endpoints for the providers of a tenant, and the default provider is not one of them: it is the registration of the tenant, and it is changed with the tenant. A provider that is created carries a complete registration, a change that names another provider and no secret of it is refused, and a provider that holds principals is not removed. **Contract:** [access spec §3.11](docs/access/spec.md#311-tenant_providers), [access spec §5.2.1](docs/access/spec.md#521-resolving-the-provider), [access spec §10.16](docs/access/spec.md#1016-the-providers-of-a-tenant).

### A tenant signs its people in with a password of its own

A tenant whose people sign in somewhere else had no way to hold an account of its own: the platform was a broker and nothing else, and a tenant without a provider of its own had nothing to offer its callers.

A **local** provider is a provider of the platform: it holds its own identities, and the caller signs in at Access itself with an address and a password. The accounts live in a table of their own, `local_credentials`, with the argon2id verifier of the password. The credential is the identity of the caller — the `sub` of a local provider is the id of the row — and the principal it creates belongs to the provider and to the tenant.

The answer of a refused sign-in says nothing about the accounts of the tenant: an address that names no account, a wrong password, a disabled account and a locked account are the same refusal, with the same code and the same text. When the address names no account, the service verifies the password against nothing, so the time of the answer does not tell the accounts apart. The guessing is expensive too: the failures of an address are counted in the shared store under a namespace of their own, and the failures of a credential lock it at the fifth one, and the lock doubles with every failure.

The page of the password is served by Access: the caller never leaves the origin of the service, and the state of the login travels in two cookies — the one of the callback and the one of the page. The verifier of the PKCE of the gateway never leaves the cookie, and the form carries the state of the provider, which cannot be forged.

The operator writes the accounts: three endpoints answer the credentials of the local providers of a tenant, and the answer never carries the verifier of a password. A local provider is refused on a tenant that shares its client, because a caller that chooses a password to sign in at would move between the tenants of the platform. The reset of a password and the second factor are deferred: the operator writes the password of an account, and the password is the only secret of it for now. **Contract:** [access spec §3.12](docs/access/spec.md#312-local_credentials), [access spec §5.4.1](docs/access/spec.md#541-the-local-provider), [access spec §10.17](docs/access/spec.md#1017-the-credentials-of-the-local-providers).


### The interface reads the credential of the deployment when the shell holds another one

The interface of the operator asks the administration of Access with the credential of the shell, and the credential of the shell comes first: a shell that names a deployment means it. A shell that holds the credential of *another* deployment was refused by this one, and the interface showed the refusal of the service — `GET /users: a valid administration token is required` — and stopped there. The interface holds the credential of the deployment it works on, in the state of the deployment, and it asks again with it: the credential of the shell is refused, the interface says so, and the page is read.

The outputs of a deployment are the outputs of its state, and the tool reads the outputs of the state the templates are initialized against — one deployment at a time. The CLI read the outputs of the deployment it was initialized against, and not the deployment it was asked about: `infra output --runtime <the runtime of a deployment>` answered with the outputs of another deployment, and the interface could read the credential of a deployment that was not the one of the profile. The templates are now read against the state of the deployment they are named after, and the state of the other deployment is left where it is.

The address of Access names a deployment when it names one. Two deployments of the platform may answer under the same names — the zone of the names is shared, and the labels of the names are not — and the credential of one of them is not the credential of another: the interface reads the credential of the deployment the profile names, and refuses to read one when the address names two. **Contract:** [CLI spec §9.1](docs/cli/spec.md#91-what-it-needs).

### The certificate of a name is validated with the record of the name

The deployment binds the certificate of every public name after the apply, with the client of Azure. The client asked the environment of the container apps to validate the name over HTTP: the validation asks the name for a challenge, and the answer comes from the application behind the name. The gateway of the deployment answers the calls of the callers and nothing else — the challenge is not a call of a caller — and the environment refused the certificate of every name.

The certificate of a name is validated with the record of the name: every public name of the deployment is a record of `CNAME` at the application of the gateway, and the environment proves the ownership of the name with it. The validation of the certificate is the validation of the record.

The reason of a refusal is told, and not the traceback of the client of Azure. The client caught the refusal of the environment and wrote a traceback of its own, and the traceback was in the log of the deployment where the reason of the refusal should have been: the reason is the line of the exception that refused, and the traceback around it is the client of Azure talking about itself. **Contract:** [CLI spec §5.8](docs/cli/spec.md#58-deploy).

### The deployment says that the zone of the names is not delegated

The deployment of the platform on Azure binds the public names to the gateway as custom domains of its application, and the environment of the container apps proves the ownership of a name with a record of DNS. The record is read in the public DNS, and the public DNS reads the records of the zone the delegation of the zone names — the delegation at the registrar of the domain, which names the name servers of the zone.

The deployment wrote the record in the zone it manages and bound the names anyway, and the environment refused the name with a refusal that names the record it did not find: `InvalidCustomHostNameValidation: A TXT record pointing from asuid.api.example.com to <the code> was not found`. The record was there, in the zone of Azure, with the right name and the right value: the zone was delegated to other name servers, and the records of a zone that is delegated elsewhere are not in the public DNS. A zone that is created again is served by other name servers, and the delegation of a zone that is not there anymore names nothing.

The wizard checks the delegation before it applies the plan that binds the names, and it refuses the deployment with the reason: the zone of the names is served by `ns1-05.azure-dns.com` and the delegation of the zone names `ns1-01.azure-dns.com`, and the records to write at the registrar are named. The refusal is made before the apply and not at its end: an apply that binds the names takes minutes, and it fails at its end with a reason the operator cannot act on. The wizard tells the delegation after every apply as well — the delegation is the one record the operator writes — and the zone of the names is not destroyed with the deployment: a zone that dies with it is a zone that is created again, and a zone that is created again is served by other name servers.

A zone of a name is delegated once: the same name in two groups of resources, or in two subscriptions, is two zones with two sets of name servers, and only one of them can be delegated at the registrar. **Contract:** [CLI spec §5.8](docs/cli/spec.md#58-deploy).


## 1.2.1

### The caller of the console signs in once

The token of Access lives five minutes, and the console kept it on the server: the caller was sent to the provider of the tenant again every five minutes, and the badge of the header offered the renewal as a thing to choose. The platform held no refresh token at all, and the specification deferred the feature.

Access issues one now, to a client that asks for it with the scope `offline_access`: an opaque token of thirty-two bytes, kept under its hash, spent by its first exchange and rotated by the exchange that redeems it. The gateway asks for no scope, and it is given none.

The console renews the token of the caller on the server, a minute before it dies: the browser is never sent to the provider of the tenant, and it never sees a token. The badge of the header counts the renewed token down, and a session that cannot renew itself offers the sign-in again. **Contract:** [access spec §7.6](docs/access/spec.md#76-refresh-token), [console spec §3.1](docs/console/spec.md#31-the-token-of-the-caller).


## 1.2.0

### The interface says what it waits for

The interface of `platformctl tui` went silent while a deployment went on: the header said that the interface was at work, the log held the last words of the tool that writes the infrastructure, and the frame did not move for the minutes the deployment took. A reader who applied a deployment again could not tell a long wait from a hang, and the wizard it runs was silent in the same way: the binding of the certificates of the public names, the job of the migration of the schema and the wait for Access to come up were said only when they were over.

The work of the interface is named and timed now: the line above the keys says what the interface waits for — the answers of a deployment, the deployment itself — and how long it has been waiting for it, and the frame is drawn again while the work goes on. The wizard tells what it does as it does it, on the standard error, and the words are in the log of the interface: the deployment is applied, the certificate of every public name is bound, the job of the migration is started, and the administration of Access is asked for its tenants. A wait of the client of Azure that goes on too long ends: the client is stopped, and what it did not do is written again the next time the deployment goes on.

### The audit of a change names the operator that made it

The audit of a deployment on Azure named the address of the ingress of the environment and nothing else: every change of every operator of the deployment carried the same two or three addresses of the proxies of the environment, and the reader of the audit could not tell one operator from another.

The address of the caller is resolved once, at the edge, and it is the address of the caller: the gateway reads it from the chain the ingress forwards, the console passes it on to Access, and the audit of a change names the operator that made it. The deployment says that the environment is the only way in — `GATEWAY_INGRESS_ONLY`, `ACCESS_INGRESS_ONLY` and `CONSOLE_INGRESS_ONLY` — and the three services trust the address the ingress reports in `x-real-ip`.

The trust of the header is the trust of the deployment, and it is narrow: a service that is published reads nothing, the host and the protocol of a request are not read from the headers when the ingress cannot be named, and the limiter of the administration keeps the address of the socket — a caller that names another address does not spend the budget of the address it names. **Contract:** [gateway spec §7.3](docs/gateway/spec.md#73-forwarding-headers-and-client-address), [access spec §10.1](docs/access/spec.md#101-common-rules), [console spec §4.1](docs/console/spec.md#41-the-address-of-the-caller).


## 1.1.0

### The deployment that is selected is applied again

The interface of `platformctl tui` could create a deployment and could not apply one that is already there: the form of a new deployment opened on the answers of the deployment the machine wrote last, and the reader who wanted another one had to name its environment by hand.

The key `a` on the page of the deployments applies the deployment of the selected profile again. The form opens with the answers of that deployment — the ones of its environment — and with the images of the latest release, the reader sends it, and the wizard applies it. The deployment of a profile is found by its name and by the address of Access it answers at, so a profile that was renamed is still the deployment it is. A deployment the machine holds no files of is not applied again: there are no answers of it to apply, and the interface says so.

### The console of the deployment holds the credential of its tenant

The console of a deployment on Azure held the token of the platform and nothing else: every change it made in the tenant of the deployment was signed with the credential of the platform, and the audit of the change named nobody. The console acts for the operator of a tenant with the credential of that tenant, and the deployment now gives it one.

The templates generate the credential of the tenant of the deployment and write it twice: Access knows it as a credential of the administration scoped to the tenant, and the console holds it as the credential of the tenant. The credential refuses every call about another tenant, the audit of a change of the tenant names the operator of the credential, and the token of the platform is still there for the operator of the platform. The slug of the tenant is the slug of the workspace of Data, and the templates refuse a slug that the console cannot read.

The check of the deployment holds the templates to it: a console that holds no credential of its tenant, a credential that Access does not know, and a credential that names no tenant are three findings of the check.

### The interface of the operator works on the deployment the reader is on

The interface of `platformctl tui` worked on the deployment that was selected when the page of the deployments was drawn, and not on the one the reader moved to: a reader who went down a row and opened the tenants read — and wrote — the tenants of the row above. The selected deployment is the one the other pages work on now, the header names it, and the reader who comes back is on the row they left.

The pages say what they are doing. A page that is opened holds no row of the page before it: it says that it reads, that it was not read and which key reads it again, or that there is nothing yet and which key creates the first one. An answer that comes after the reader left its page is not drawn over another one. The header says when the interface is at work, and the line above the keys holds the messages, the questions and the place of the reader in the list — a message that is longer than the line is read to its end, and the next key takes it away.

The lists are filtered with `/`, and they are moved in by a page, to their ends, and with `j` and `k`. The selected row is a bar across the table, a table that is too wide takes its room from its widest columns and leaves the states and the counts whole, and the panels that are drawn side by side keep both of their sides.

The forms are forms a reader can fill in:

- The field the reader is in is always on the screen, with its whole label and the values it takes under the fields. A form that was longer than the screen lost its last fields, and a label that was longer than its column pushed the value off the screen — every value of the wizard of a deployment.
- A space is a letter. It was the key that changed a choice in every field, and a name of two words could not be typed.
- The value has a cursor: the arrows, `home`, `end`, `delete` and `ctrl` and `u` together work in it.
- The secrets of a tenant are written and not drawn.
- A form the reader wrote in asks before it is left, and the form of a profile closes when the profile is written.
- The creation of a deployment asks before it begins, and an answer that is not the shape the deployment needs puts the reader in its field.
- The log of a deployment shows its last lines. It showed its first ones.

The form of a new deployment holds the answers the wizard finds by itself. It held the placeholders of the example of the templates: the digests of the images, which the wizard of the command line reads from the release, were the reader's to find and to type. The form reads what the wizard reads — the digests of the latest release, the digest of the image of the client of PostgreSQL, the range of the public address of the machine — and it offers what the wizard offers, the answers of the deployment of the environment that is already there. They are read while the reader fills in the form and written in the fields the reader did not write in, they follow the environment the reader names, and the log says where each of them comes from and which could not be read. A deployment whose digests were left to the release runs the release the form showed, and the wizard still proves the templates against it. **Contract:** [CLI spec §9.5](docs/cli/spec.md#95-the-creation-of-a-deployment).

The deployment the interface runs is asked nothing. An operator who holds more than one subscription of Azure was asked which one at the sign in of the wizard, and the wizard the interface runs has no terminal: the deployment failed with *the command asks a question and nobody can answer it*, and it did not say which question. The subscription is a field of the form now — the one the session of the machine works in, until the reader chooses another — and the question before the deployment names it. `deploy` takes the subscription the file of the answers names as `subscription_id` and does not ask; without one, and with nobody to ask, it is refused with the subscriptions the operator holds and the value that chooses one. A question nobody can answer names itself in every refusal. The digest of the image of the client of PostgreSQL that the form holds is written in the answers, and the deployment does not ask the registry again.

A deployment the interface applies is a deployment the interface works on. It was applied and the page of the deployments did not know it: the reader copied its addresses out of the log into `context set`. The profile of the deployment is written when it is applied — named after its prefix and its environment, with the public addresses of the gateway and of Access and the workspace — it becomes the current one when the machine has none, and `esc` goes back to the deployments, on it. The form of a new deployment opens on the answers of the deployment that was written last: with the values of two environments on the machine it opened on the example of the templates.

The interface reads the credential of the administration in the state of the deployment. The deployment creates the credential and the templates answer with it, and the operator who had just deployed was told to set `PLATFORMCTL_ADMIN_TOKEN` before the tenants could be read. With no credential in the shell, the interface reads the one of the deployment the first time a page needs it, keeps it in its memory and writes it nowhere; the credential of the shell still comes first. The answer of the templates is checked against the profile: the templates are initialized against one deployment at a time, and the credential of one deployment is not sent to another. **Contract:** [CLI spec §9.1](docs/cli/spec.md#91-what-it-needs).

A principal is registered and given its first grant in one pass. The form of a grant asked for the identifier of the principal, which was on another page, and for a tenant, a workspace and a route the interface had already read. On a tenant, `p` and `g` are its principals and its grants now, and on a principal `g` is its grants; the forms hold the tenant and the principal the reader came from and the workspace of the profile, and their fields offer the tenants, the principals by their address, and the permissions, the routes and the operators of the grants that are there — `→` takes the offer. A principal that is registered holds no grant, and the interface asks for its first one at once. The grants name their principals by their address, and the reader goes back up the way they came down. **Contract:** [CLI spec §9.3](docs/cli/spec.md#93-the-keys).

A question is answered by `y` or by `n`, and it names what it removes: a key that was neither refused the question, and it leaves it where it is now. The tenant that is selected is described and edited — the record of a tenant was looked for under its slug where Access answers with an identifier, and neither worked.

The frame is drawn over the one before it and the screen is not cleared in between: the interface does not blink at every key and at every reading of the clock. **Contract:** [CLI spec §9.3 and §9.4](docs/cli/spec.md#93-the-keys).


## 1.0.13

### The logins are counted and the principals they create are audited

The metric of the logins was never written: `access_logins_total` stayed at zero, and the four documents that tell the operator to watch it — the operations, the monitoring, the incident-response and the rotate-secrets guides — were watching a line that never moved. A login that was refused, a provider that was down and a tenant that was disabled left no count anywhere.

The logins are counted now: a login that succeeds, a login that is refused and a login that fails are counted per tenant, and the refusal carries the tenant of the login. The logs carry the login as well, with the tenant and the outcome.

A principal that a login creates is audited like every other change: the operator of the audit is the identity that signed in, and the address and the request are the ones of the call. The auto-provisioning of a tenant was the one change of the platform that was not audited, and the rows it writes are the ones an operator watches when a tenant provisions its identities.

### The first identity of a tenant may be given the administration of the tenant

A tenant that provisions the identities that sign in created a principal with **no grant at all**: the login succeeded, every request was refused, and an operator of the platform had to read the principal out of the administration and to give it a right. A tenant that wanted its first account to run on its own — the first employee to sign in, and not an operator of the platform — had to wait for one.

A tenant may now hand the administration of the tenant to the first identity that signs in. The flag `autoProvisionAdmin` is the work of the operator of the tenant and it is off by default: the first person who signs in at the provider of a tenant is not its administrator unless the tenant says so. With the flag on, the principal that is created first is given the grant that opens the administration of the tenant — the `console.admin` key, on the tenant itself as the workspace — and it may add the users and the rights of the tenant by itself. The identities that come after it are given nothing, and a tenant that already has an administrator keeps it.

The grant is written by Access, at the login, and it is audited like every other change. The key of the permission is a value of the deployment, `ACCESS_TENANT_ADMIN_PERMISSION`, and it is `console.admin` by default. The CLI registers a tenant with `--auto-provision-admin`, the console says **The first one administers the tenant**, and the deployment on Azure registers the tenant it creates with the value of `tenant_auto_provision_admin`.

A tenant that **shares its provider** with another tenant is given no administrator by its first identity: the provider of a shared directory is the provider of several tenants, and the first identity that signs in at it is the first identity of the directory and not of the tenant. The operator of the platform grants the administration of such a tenant by hand.


## 1.0.12

### The provider of the deployment belongs to the tenant the deployment creates

A deployment on Azure held the provider of the identity of its tenant as the provider of the platform: the wizard registered the tenant of the deployment with the application of Access at Entra ID at every apply, and it took the provider back from a tenant that had been given another one. A tenant whose people sign in at a provider of their own — Auth0, Okta, a directory of another cloud — was pushed back to Entra ID the next time the deployment went on, and the deployment was the only place where a provider could be named.

The provider of the deployment belongs to the tenant the deployment creates now, and to no other. A tenant that has a provider of its own keeps it: the registration of the tenant of the deployment names no provider, and Access keeps the one the tenant has. The application of Entra ID is still the provider of the tenant the deployment creates, and a deployment whose tenant names another provider turns it off with `entra_tenant_enabled = false`.

Access keeps the provider of a tenant as well: a change of a tenant that names no secret of its provider keeps the secret the tenant has, and a tenant that is created is created with the provider it is given — a registration that names none of it is refused with `invalid_request`. The secret of a provider belongs to that provider: a change that names another issuer or another client and no secret is refused as well. The console asks for the secret of the provider only when the operator wants to change it, the CLI registers a tenant with any provider it names, and the answer of a tenant carries the client of Access at its provider.

### The provisioning of the tenant of a deployment is a value of the deployment

The tenant of a deployment was registered with the auto-provisioning of the principals as the work of the platform: the wizard created the tenant with the flag off and kept the flag of the tenant that was already there. An operator whose tenant was created before the wizard provisioned it had to register the first principal by hand — and the way to turn the provisioning on was an upsert that carries the whole tenant, with the secret of the provider and the secret of the client in it.

The flag is a value of the deployment now: `tenant_auto_provision` is `true` by default, the wizard reads it in the answers of the templates, and the registration of the tenant carries it at every apply. An operator who wants its people registered by hand says `tenant_auto_provision = false` in the values of the deployment. A deployment whose templates do not answer keeps the flag of the tenant that is already there.


## 1.0.11

### The console of the deployment holds the credential of the administration

The console of a deployment on Azure held no credential of the administration of Access: it read the scope of the people who sign in through the credential of the access context, and it had no way to act for them. The pages of the administration of the console — the tenants, their users, their groups and their rights — are opened with the credential of the administration, and a console that holds none of them refuses them to every operator, grant or not.

The console holds the token of the platform now, and the deployment holds one tenant. The credential is the one of the vault of the deployment, and the console reads it the way it reads its other secrets: as a reference to the secret, never as a value.

### The tenant of the deployment provisions the identities that sign in

The tenant of a deployment was created with the auto-provisioning of the principals off: a person who signed in at Entra ID was refused by Access with `identity_unknown`, and the operator of the deployment had to read the `sub` of the identity in the directory and to register the principal by hand before anybody could sign in.

The tenant of the deployment provisions the identities that sign in now. The first person who signs in at the provider of the tenant gets a principal, and the principal is created at that login: the operator of the deployment is the first one to sign in, and the account it needs is there when it arrives. A principal that is created has **no grant at all** — the login succeeds and every request is refused until the operator gives that principal a right — and the flag of a tenant that is already there is the work of the operator of the platform, and it is kept.

The CLI says the flag in the words of the operator: `platformctl access tenants create --auto-provision` registers a tenant that provisions its identities, and `--no-auto-provision` says the opposite. The upsert changes the flags the body names and resets the ones it does not, so the call carries the whole tenant.

### The provider of a tenant is asked for the scopes it knows

Access sent the browser to the provider of the tenant with the scopes the client had asked for, and the scopes of a client are the scopes of the **platform**: `groups` is one of them. The scopes of a **provider** are the ones its registration carries, and a scope a provider does not name is a scope its authorization refuses: Entra ID refused the whole login with `AADSTS650053`, and the sign-in of the console and of the gateway never completed.

Access asks the provider for the scopes of the tenant now — the scopes of its registration, limited to the ones the client asked for — and keeps the two lists apart. The platform asks for the groups of a caller, and the groups of a caller are read in the grants of Access and not in the directory.

### The tenant of the deployment is registered with the slug of its workspace

The wizard of a deployment on Azure registers the tenant of the deployment at Access, with the application of Access at Entra ID as its provider. It read the slug of the tenant in the values of the wizard, and the wizard never collected that value: the slug of the workspace of the deployment is a value of the templates, and the wizard does not ask for it. The value was empty, the wizard refused the registration, and the tenant of the deployment was never created.

A deployment without a tenant has no login. Access resolves the tenant of a login from the identifier of the client, and a client that names no tenant is an `invalid_request`: the console sends its callers to Access with the client of the deployment, and every page behind the login of the console answers that the request is not valid.

The wizard reads the values of the deployment in the answers of the templates now. The slug of the workspace, the identifier of the tenant, the provider of the tenant and the public names are outputs of the deployment, and the outputs are the values the deployment runs with — a value that is written in the templates and in the code of the wizard is a value that drifts. The public names are the same story: the wizard binds the certificate of a name only when the deployment names it, and it read that value in the values it never collected, so it bound no certificate at all.

The slug of the workspace is a question of the wizard as well, and the operator names it: the tenant of the deployment is created with it, and the workspace of Data carries the same slug.

### The outputs of the deployment carry the credentials the wizard reads

The tool that writes the infrastructure held the credentials of the deployment back when it read the outputs: a name that carries a credential was replaced with `(sensitive value)`, so that a credential never reaches a line of a terminal. The wizard of the deployment needs those credentials: it registers the tenant of the deployment at Access with the token of the administration and with the secrets of the client, and it presented the value of the redaction to Access. Access refused it, the wizard waited for an administration that answered nothing, and the tenant of the deployment was never registered.

The tool reads the truth of the deployment now, and the credential is held back where the answers are drawn: the command that shows the outputs of the deployment holds them back, and a line of a terminal still carries none of them.

### The deployment on Azure holds the provider of the identity of its tenant

A deployment on Azure had no identity provider of its own. The tenant of the deployment was registered at Access with an issuer and with a client that the operator held somewhere else, and the templates of the deployment said nothing about it: a deployment that runs in a tenant of Entra ID and that asks its operator for the credentials of a provider outside of it is a deployment with a step that is not in the templates.

The templates create the application of Access at Entra ID now: a confidential client in the tenant of the deployment, with a secret of its own, with the callback of Access as its only redirect URI, and with no permission of any other application — it is a client and not a resource, and the identity of a caller is the only thing it reads of the directory. The outputs of the deployment carry the issuer of the directory, the identifier of the application, its secret and the callback of Access.

The tenant of the deployment is registered with that application as its provider. The wizard of the deployment reads the tenant among the tenants of Access — the tenant the values name — and registers it again at every apply, keeping the flags of the tenant: the auto-provisioning of the principals, the shared client and the default of the platform are the work of the operator of the platform. The registration is a call to the administration API of Access, and Access is a service of the deployment that has to be up: a deployment whose Access is not up yet is a deployment whose tenant is registered by hand, and the wizard says so.

The gateway asks for the groups of a caller as well, and the provider does not grant them. The scopes of a provider are the ones its discovery document names, and the document of Entra ID names `openid`, `profile` and `email`: a scope a provider does not name is a scope its authorization refuses, and the whole login is refused with it. Access asks the provider for the scopes of the tenant, and the groups of a caller are read in the grants of Access, and not in the directory.

The tenant of the deployment is created by the wizard and not by the operator. The wizard waits for Access — Access cannot answer before the job of the migration has created the roles of the deployment — and it creates the tenant of the deployment when the tenant is not there yet, with the slug of the workspace of the deployment. The identifier of the tenant it created is written in the file of the values, and the deployment goes on again: the access context of the deployment is scoped to that identifier, and a scope that names no tenant asks about nothing.

The secret of the client belongs to the tenant, and the tenant holds it: a rotation of the secret is a change of the registration of the tenant, and the registration is repeated with the new value. The value of `entra_secret_rotation` is the key of the secret, and a change of the key is a new secret. A deployment whose tenant has another provider turns the application off with `entra_tenant_enabled`.

### The deployment holds no registry of its own

The deployment of the platform on Azure held a container registry of its own: the packages of the release were pushed into it, and the applications of the deployment pulled them from it. The registry was a mirror of packages that are public, and it was paid for.

The images are pulled from the registry of GitHub now, and the deployment holds no registry of its own: a public package is pulled without a credential, and the applications of the deployment name no registry at all. The subscription of the deployment registers two providers less, the deployment holds no role of a registry, and the pull of an image needs no identity.

A block of a registry that names a server and no credential is refused by the provider — the credential of a registry is either an identity or a name of an account and a name of a secret — and a deployment whose images are public needs none of them. The block was left behind when the images moved, and the applications of the deployment were refused one after the other.

The image of the client of PostgreSQL is the one image of a deployment that the platform does not publish, and it names the registry of Docker: the wizard reads its digest from the registry of Docker Hub, and the name of the repository of an image is the name of the image without the name of the registry. The reference of the image names `docker.io/library/postgres`, and the repository of Docker Hub is `library/postgres`.


## 1.0.10

### The console of the deployment is the client of the tenant

The links of the console to Access did not work: the console sent the browser to Access with a client id of its own, and Access answered that the client id named no tenant of the platform. The gateway failed the same way, and no link into the platform signed anybody in.

Access holds one client for a tenant. It resolves the tenant of a login from the identifier of the client, and it holds one secret for that client: the callbacks of the gateway and of the console are the redirect URIs of the one client, and the console signs in as the tenant, as the gateway does. The templates wrote a second client for the console — an identifier of its own and a secret of its own — and a client that is not registered at Access names no tenant, so the sign-in of the console failed before anything else could happen.

The templates name one client now: the gateway and the console read the same identifier and the same secret of the vault of the deployment, and the outputs of the deployment carry the identifier of the client, its secret and the two callbacks that the tenant registers. The outputs `gateway_client_id` and `gateway_client_secret` are `client_id` and `client_secret` now, and the identifier of the client is `platform` unless the operator names another one. The check of the deployment holds the templates to that rule: a console that is a client of its own is reported, and so is a console that holds the token of the control plane — the token of the control plane is a credential of its own, and the service that the browsers reach holds no credential of the control plane.

The credential of the access context that the console reads was not registered at Access: the templates gave the console a credential and Access was never told about it, so the console read no scope for the people who sign in and it opened nothing. The templates register the credential now, with the tenant of the deployment as its scope, and the check of the deployment holds them to it.

### The console of the deployment knows where Data is

The status board of the console showed Data as not configured, and the deployment that produced that board was a deployment that had come up cleanly: the gateway, Access and the console were up, and Data was a service the console had never been told about.

The console reads the state of the three services and shows it on its status board, and it reads each of them at the address its environment names. The templates named the addresses of the gateway and of Access, and they named no address of Data, so the console probed nothing and reported the service as not configured — a state an operator reads as a service that is not there.

The templates name the address of Data now: the name of the application of Data, which resolves in the internal DNS of the environment and reaches the ingress of the service itself. The check of the deployment holds them to it, and a console that names no address of a service it probes is reported.

### The wizard compares the documents and not the words of the templates

The wizard refuses a deployment whose templates write a document the images of the release do not know, and it refused a checkout that wrote the same document: it compared the text of the templates, and the text holds more than the document. A comment that changed was a difference, and so was the address of a service that moved — the templates of a checkout that reached the services at another address were refused, and the operator had to publish a release of the templates to deploy what was already written.

The documents are compared by their fields and by the values that are not addresses now. A comment is a word for the reader of the templates, and the address of a service is a value of the deployment: the images of the release read the address they are given.

### The services of the deployment reach each other at the name of their application

The name of the environment — `<the-service>.<the-environment>.<the-region>.azurecontainerapps.io` — is the **public** name of a service of the environment of the container apps. A service that is not published has no answer there: the environment answers `404` for a request that arrives at the public name of an application whose ingress is internal, and the answer is a page of the environment and not an answer of the service.

The templates wrote that name as the address of the upstreams of the route table and as the address of Access that the console reaches. The gateway answered `404` for every request it forwarded to Access, the console never became ready, and the platform was a front door that opened on nothing.

A service of the environment is reached at the **name of its application**: the name resolves in the internal DNS of the environment, and it reaches the ingress of the service itself. The internal name of an application — `<the-service>.internal.<the-environment>.<the-region>.azurecontainerapps.io` — answers as well, and the name of the application alone is the shortest of the three.

### The cache of the deployment is a cache a client of one server can use

An Azure Managed Redis is a cluster on every tier and every size: the service is built on Redis Enterprise, and the policy of the cluster decides how a client reaches it. The default of the service is the policy of the Redis of the community edition, `OSSCluster`, and the client of the platform is a client of one server: the server answers a command on a key it does not hold with a redirection, `MOVED <the-slot> <the-node>`, and the client follows none.

The gateway then says that the shared state is not reachable, and it keeps the sessions of the callers and the windows of the limits in the memory of a replica. The tier of the cache was never the cause of it: the tier chooses the size, and the policy chooses the protocol.

The templates choose the policy of the proxy, `EnterpriseCluster`: the proxy routes every command to the shard that holds the key, and the cache looks like a server to the client. The policy is chosen when the database is created, and changing it recreates the database: the sessions of the callers are lost, and nothing else is.

### The gateway names the redirection of a cluster, and its readiness probe reads a key

The shared state was reported as unreachable, and the error of the log line said `MOVED`: the failure was not an outage, and the answer of the server was that the command belongs to another node. The gateway says that now, and it says what to do about it.

The probe of the session store was a ping, and a ping answers on every server, and a cluster answers it on the node the client is connected to even when that node holds none of the keys of the caller: the gateway said that the store was reachable while every keyed command failed. The probe reads a key now, and a gateway that cannot write its sessions is not ready.


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

