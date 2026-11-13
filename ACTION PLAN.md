# Action plan

The work that the three assessors agree on. Every item below was checked against the source before it was written down; where an assessor was contradicted, the contradiction is recorded rather than smoothed over.

The order is by **root cause**, not by severity of the symptom. One decision — which credential the console presents — accounts for most of the console findings, so it comes before the items that only exist because of it.

This revision folds in the two plans of C and G. What was added, and why, is recorded in §11.

---

## 0. The scope: what all three agree on

| # | Item | C | G | M | Severity |
| --- | --- | --- | --- | --- | --- |
| A1 | The outbox policies of Data name no role, so the privileges of the API role reach outside the tenant scope | High, live proof | High | Medium | **High** |
| A2 | No test catches A1 | yes | yes | yes | High |
| A3 | No HTTP path reaches the outbox, so the proven impact is the weakened backstop and not a live leak | yes | yes | yes | — |
| A4 | The console decides which credential it presents, and Access authorises the credential rather than the person behind it | Medium | Critical/High | Medium | **High** |
| A5 | The permission keys are hand-copied in three packages with no drift guard | noted | Critical (via config) | Low-Med | Medium |
| A6 | Access runs as the owner of its tables, so its policies are not a guard against a compromised service | Medium | High | raised late | Medium |
| A7 | The audit table of Access carries no row level security | Low | noted | raised late | Low |
| A8 | The signed identity binds neither the body, nor a moment, nor a nonce | confirmed | High | raised late | Medium |
| A9 | The creation of a workspace does not enforce the tenant of the binding | confirmed | Medium | raised late | Medium |
| A10 | The list of the platform permissions can omit `console.platform`, so the two services disagree | confirmed | Critical | raised late | High |
| A11 | The readiness of Data accepts the role of the owner, and the listener starts regardless | confirmed | High | raised late | Medium |
| A12 | The live-schema drift check of Data exists but never runs in the process | — | High | raised late | Medium |
| A13 | The refusal of a role that bypasses the isolation applies only in production | confirmed | — | not raised | Low |

**Not unanimous — a targeted test is needed before any of it is scheduled:** the truncation of a listing at a thousand rows, and the acceptance of an expired context by the shared client. G reproduced both; C could not; M read the code and found the path. C's own suggestion is the right one: prove them with a test first.

---

## 1. Corrections to the record

These are claims of M that C and G overturned, and one claim of M that is right only in part. They come first because two of them change the reasoning of the work below.

1. **The explanation of the unscoped policies was wrong.** M wrote that a worker would silently fall back onto the role of the API. It cannot: `packages/data/src/runtime/config.ts` refuses to start a worker whose delivery URL is unset. The defect is real and independent of that reasoning — the grants and the policies are simply wider than the roles need. The fix below stands; the justification is replaced.
2. **Access refuses a role that bypasses the isolation only in production.** `packages/access/src/runtime/composition.ts` puts the check behind `if (settings.production)`. M's original text implied it was unconditional.
3. **Not every table of Access forces its row level security.** The audit table does not. M's original text said every table did.
4. **The drift check of Data never runs in the process.** `detectDrift()` in `packages/data/src/platform/postgres/migrations.ts` compares the deployed schema with the manifest, and it is the function that would notice a table whose isolation was switched off. It is called from `packages/data/test/integration/postgres.test.ts` and from nowhere else. The readiness calls `verifyMigrations()`, which reads the ledger of the migrations and its checksums, and that cannot see a change made to the live schema.
5. **A green CI job is not evidence that it passed for this snapshot.** M wrote that the result of the suites of Data was not in question because the continuous integration runs them. That is weaker than it sounds; the suites must be run against the revision under review.

---

## 2. Wave 0 — inventory and containment

**This wave is first because the permanent fixes are unsafe to apply without it.** The change of §4.1 alters which credential the console presents, and the change of §5.4 alters which permissions a deployment may protect. Neither can be written correctly without knowing what the shipped deployments actually configure. C reached this from the other direction — the archive it read held neither `deploy/` nor `.github/`, so it could not see the stacks — and G made it a priority of its own.

### 2.1 The inventory

Record, for every deployment:

| What | Where it is read | Why it matters |
| --- | --- | --- |
| The credential of the platform, and the credential of each tenant | `packages/console/src/runtime/config.ts` | It decides whether §4.1 breaks tenant administration |
| The keys of `ACCESS_PLATFORM_PERMISSIONS` | `packages/access/src/runtime/env.ts` | It decides whether any deployment is already exposed to A10 |
| The four database identities of Data | `packages/data/src/runtime/config.ts`, `scripts/cli/provision.ts` | It decides whether §5.1 and §5.2 can be applied without a deployment change |
| The grants and the nested roles that confer a platform key | Access | A grant made under an older setting may confer a key that the new setting protects |

### 2.2 The inventory, recorded

The inventory was read from the stacks of the deployment, the templates of the infrastructure and the code of the services. It is the fact that the decisions of §4 rest on.

| What | What the deployment holds | What it means |
| --- | --- | --- |
| The credential of the platform of the console | `CONSOLE_ADMIN_TOKEN` — required by every stack | The credential of the platform is always there |
| The credentials of the tenants of the console | `CONSOLE_TENANT_ADMIN_TOKENS` — a json of slugs and tokens, **empty by default** in the compose stacks, and a secret of the vault in the templates of Azure | The fallback to the credential of the platform is the live path of the compose stacks |
| The list of the platform permissions | `ACCESS_PLATFORM_PERMISSIONS` — **set by no deployment** | Every deployment runs on the built-in list, and the disagreement of §4.3 is latent rather than live |
| The identities of the database of Data | `data_runtime` and `data_registry` in the stacks; the owner in the job of the migration | The role of the API is the role of the API, and the owner is the owner |
| The URL of the delivery | **set by no deployment** | A worker refuses to start without it, and the API never uses the pool of the delivery |

The templates of Azure say it in their own words, next to the variable of the credentials of the tenants:

> A console that holds no credential of the tenant signs every change of the tenant with the token of the platform, and the audit of the change names nobody.

**The consequence.** The removal of the fallback of §4.1 needs the credentials of the tenants to be provisioned first, or the administration of the tenants of a console stops working. The refusal is better than the escalation, but the provisioning comes first. The change of the list of the platform permissions of §4.3 is safe for every deployment as they stand, because none of them names a key of its own.

### 2.3 The review of what already exists

Before a configuration changes, the grants that were made under the old configuration are read by an operator of the platform. A revocation that is automatic is a revocation that was never reviewed — G is right about this, and the same holds for the change of the list of the platform permissions.

### 2.4 The containment while the fixes are built

- A console that administers a tenant holds a credential of that tenant. Where it does not, the administration of that tenant is disabled rather than falling back.
- The connection of the API of Data is checked against the role of the runtime: neither an owner, nor a superuser, nor a role with `BYPASSRLS`, nor a role that inherits one of those.
- The access of Data itself is restricted to the deployments that need it, for the length of the work.

---

## 3. Wave 1 — the database backstop

The defect of the policies is the cheapest to fix and the most certain. It is also the one that the other waves depend on for its regression test.

### 3.1 A migration that scopes the policies to their roles

A new migration is required and an edit of `0004_isolation.sql` is not possible: the ledger holds the checksum of every applied migration and the process refuses a migration that changed after it was applied (`packages/data/src/platform/postgres/migrations.ts`). The next number is `0012`.

```sql
-- 0012_outbox_policies.sql
-- The policies of the delivery name the role of the delivery.

drop policy outbox_events_delivery on platform.outbox_events;
create policy outbox_events_delivery on platform.outbox_events
  for select
  to data_delivery
  using (true);

drop policy outbox_deliveries_delivery on platform.outbox_deliveries;
create policy outbox_deliveries_delivery on platform.outbox_deliveries
  for all
  to data_delivery
  using (true)
  with check (true);

drop policy workspaces_registry_read on platform.workspaces;
create policy workspaces_registry_read on platform.workspaces
  for select
  to data_registry
  using (true);
```

**Before the revoke below is applied, confirm that nothing reads the events with the role of the API.** `PostgresOutbox.append()` writes them and `PostgresDeliveryStore` reads them through the pool of the delivery; a search of `packages/data/src` for a read of `platform.outbox_events` outside the delivery pool should come back empty. If it does:

```sql
revoke select on platform.outbox_events from data_runtime;
```

The role of the API keeps its insert on the events and on the deliveries; the insert of a delivery row is then governed by `outbox_deliveries_scope`, which holds the tenant and the workspace of the transaction. That is the behaviour the deployment wants.

### 3.2 The test that was missing

`packages/data/test/integration/postgres.test.ts` already proves that the registry refuses the rows of another workspace. The same shape is needed for the outbox, and it is the test that should have existed. On a real server, with two tenants and two workspaces:

- with the role of the API, in a transaction scoped to tenant A, a select of `platform.outbox_events` returns nothing of tenant B;
- the same select with **no scope at all** returns nothing (this is the sharper form: the unscoped policy defeated the scoped one even when the transaction set nothing);
- with the role of the API, an insert of a delivery row that names tenant B is refused;
- **a connection that returns to the pool and is used again carries no scope of the earlier request** — the scope is local to the transaction, and the test proves it;
- with the role of the delivery, the claims, the retries and the acknowledgements still work;
- with the role of the registry, only its own projection is readable.

The test reads `pg_policies`, the memberships of the roles, the privileges of the tables and the grants of the columns for the effective roles, and it holds the composition of the policies, not only their names. A policy that names no role is invisible to a test that reads through the owner.

### 3.3 A guard that holds the shape of the policies

Access has `test/architecture/scope.test.ts`, which reads the storage and holds that every statement carries a scope. Data has nothing of the kind. The guard is a static reading of `packages/data/migrations/*.sql` that holds:

- that the isolation is enabled **and forced** on every table of the deployment;
- that every policy names a role and a command, or is one of the named scope policies;
- **that no permissive policy widens a scoped one** — the defect was a permissive policy with `using (true)` on a table that another permissive policy already scoped, and the two were combined with a logical or;
- the privileges of the tables and the grants of the columns of the runtime role, and that the runtime role is not a member of the role of the owner.

The reviewed policies of the platform, which are deliberately wide, are named explicitly in the guard. A blanket ban on a wide policy would refuse the policies of the owner and of the maintenance, which exist on purpose.

This is a small file and it would have caught the defect on the day it was written. It belongs beside the architecture gate of Data.

### 3.4 The role of the API at the start

`packages/data/src/runtime/readiness.ts` refuses a superuser and a role with `BYPASSRLS`, and nothing else. The role of the owner of the schema passes both tests, matches the owner policies of `USING (true)`, and holds every privilege of an owner. The check should also refuse:

- a role that owns the tables of the deployment, and
- a role that is a member of the role of the owner.

The pools of the registry and of the delivery are checked against the role they are expected to hold, and not only the pool of the API.

And the listener starts before the readiness has been asked (`packages/data/src/main.ts`). A process that knows its role is unsafe should refuse to serve rather than report itself unready.

### 3.5 The drift check in the process

`detectDrift()` is the function that notices a table whose isolation was switched off, and it is called by a test and by nothing else. Calling it from the readiness, at the same place as `verifyMigrations()`, closes the gap that the outbox defect sat in: with the drift check running, a schema that no longer forces its policies stops the service instead of serving it.

The cost is a query at every readiness; the readiness is already a periodic probe, and the check may be bounded to the tables of the deployment.

A checksum of a migration proves that a file was not changed. It does not prove that the isolation of a table is still enabled and forced, nor that the expression of a policy is still the reviewed one. Both claims are worth their own check.

### 3.6 Access: the owner and the runtime

`packages/access/scripts/cli/provision.ts` states that the role that owns the tables is the only one that may alter the schema, and that the service uses it. The forced policies still bind the owner for ordinary statements, but the owner may drop them.

Two ways out, in order of cost:

1. **Split the roles the way Data splits them.** A role that owns the schema, a role that runs the service, and a role that applies the migrations. The service refuses to start with the owner role. This is the shape of the five roles of Data and it is the shape C recommends.
2. **If the split is refused, say so in the documentation.** `docs/platform/security.md` lists the least privilege of each service; the row of Access must say that its isolation holds against a forgotten filter and not against a compromised service, exactly as C and G describe.

Either way, the check that refuses a role that bypasses the isolation should not be reserved for production. C and G both found this; a deployment in a test environment is where the mistake is made.

### 3.7 The audit table of Access

`admin_audit` carries a tenant and no policies. The domain floors the filter of the query with the scope of the credential (`tenantOf()` in `packages/access/src/domains/administration/scope.ts`), so no route reaches across a tenant today. The table is nevertheless the one table of Access that a forgotten filter would expose. Either it gets a policy of the scope like the others, or the documentation says why it is different. C rates it Low, and Low is right.

### 3.8 The policy of the catalogue of the permissions

The policy of `permissions` lets the scope of a tenant read the rows whose tenant is null, which is intended: those rows are the catalogue of the platform. The same policy has no `WITH CHECK` of its own, so it also permits **writing** those rows at the SQL layer.

The service does not do it: `resolvePermission()` in `packages/access/src/domains/administration/grants.ts` creates the row of the catalogue in the scope of the platform, and creates the row of a tenant in the scope of that tenant. So this is a gap of defence in depth and not a live path. The policy should still be split by command: a read that allows the rows of the catalogue, and a write that allows the rows of the tenant alone.

---

## 4. Wave 2 — the authority of the credential

This is the root cause of A4, A5 and A10, and of the two paths that still need a test. C's summary is the one to work from: *"one fix covers most of them — stop using the platform credential for tenant operators and have Access authorise the actual operator."*

### 4.1 No fallback to the credential of the platform

The fallback is in **four** places, not one:

| Where | What it does |
| --- | --- |
| `packages/console/src/domains/operators/scope.ts` → `credentialFor()` | The credential of the administration of a tenant |
| `packages/console/src/runtime/services.ts:141` | The credential of the administration, when the console lists the tenants |
| `packages/console/src/app/middleware/workspaces.ts:34` | The credential with which the console reads the rights of a workspace |
| `packages/console/src/app/routes/workspaces/new.tsx:57` | The credential with which the console grants the creator its rights |

The last two are the path of the **workspaces**, not only the path of the administration: a console that holds only the credential of the platform signs the reading of a workspace's rights and the grant of the rights of a new workspace with it. A fix that changed only `credentialFor()` would leave three open.

**Decision to make:** either every tenant that the console administers must have a credential of its own, or the console must refuse the tenant it holds no credential for. The second is the safe default: a tenant that the console cannot act for is a tenant the console does not administer. It also turns the misconfiguration into a visible refusal instead of a silent escalation.

The path of the platform operator is kept: an operator who holds `console.platform` still signs with the credential of the platform. Only the fallback for an operator of a tenant goes.

The configuration must then be checked at the start of the console: a console that holds a credential of the platform and no credential of any tenant is a console that administers the platform only.

### 4.2 Access authorises the person, not only the credential

`packages/access/src/domains/administration/credentials.ts` carries the operator of a credential as a name for the audit. The authority of a call is the scope of the credential alone.

The delegated form of the call would carry the identity of the operator alongside the credential, and Access would apply the scope of the operator as a floor under the scope of the credential: a tenant credential signed by an operator of the platform would still be a tenant credential, and a platform credential would act only for the tenants the operator may administer.

**The identity must be verifiable, and it must not be what the console already sends.** The console sends the address of the caller in the header `x-real-ip` (`packages/client/src/access.ts`), and that is context for the audit and not proof of authority: a caller may send it. A delegated identity needs a credential of its own, a signed assertion, or a token that the operator presents.

This is the largest change of the plan and it touches the contract of the administration. It is also the only fix that makes the console a client rather than an authority.

### 4.3 The list of the platform permissions may not omit `console.platform`

`packages/access/src/runtime/env.ts` → `platformPermissionsOf()` returns the configured keys when the value is not empty, and the default only when it is empty. A deployment that names a key of its own therefore stops Access from protecting `console.platform`, while the console holds it fixed as a capability of the platform in `packages/console/src/domains/operators/scope.ts`.

G proved the consequence with the in-memory stores of Access: an administrator of a tenant granted `console.platform` when the list omitted it, and the console then read the holder of it as an operator of the platform.

**Decision to make:** the configured keys **extend** the built-in ones rather than replace them, or the configuration refuses to start when it leaves a built-in key out. The second is smaller; the first also lets the console read the complete list from Access instead of holding its own copy, which is §6.1.

### 4.4 Every mutation that names an object is bound to the tenant

`packages/console/src/app/routes/operators/tenants/[tenant]/rights/index.tsx` passes the identifier of the grant from the form straight to Access, and the client sends no tenant with it (`packages/client/src/access.ts` → `revokeGrant(id)` → `DELETE /grants/{id}`). The tenant of the call is the tenant of the credential, and a credential of the platform names no tenant — so the identifier alone chooses the target.

The binding belongs at Access: the mutation takes the tenant of the route and the identifier of the object, and the database refuses a pair that does not agree. A console that holds a credential of the platform then cannot reach an object of another tenant through a page of a tenant.

Every route that names an object needs this, not only the one above: the removal of a local credential, the removal of a provider, the removal of a group, the removal of a principal, and the verification of a route.

### 4.5 A decision is never taken from an incomplete graph

`packages/client/src/access.ts` → `all()` stops at a thousand rows and reports that the listing is not whole. The handlers of the roles read the rows and never read the flag; the code already knows the hazard, because `groupIsReadWhole()` in `packages/console/src/domains/operators/effective.ts` handles it for the groups.

The rule to adopt: **a decision that depends on a listing is refused when the listing is not whole.** The console already has the vocabulary for it — `groupIsReadWhole()` returns false, and the page then says that the group gives nothing the console could read. It applies to the writes of a role, of a grant, and of a member of a group.

**Before this is scheduled, prove the path.** G reproduced it with a thousand and one roles and C could not reproduce it. The test that settles it is small: a tenant with a role that includes another role that holds `console.platform`, listed beyond the bound, and a write that names the included role.

---

## 5. Wave 3 — the contracts

### 5.1 The signed identity

`packages/data/src/domains/gateway-context/verify.ts` builds the canonical payload out of the method, the path, the query, the authority, the subject, the workspace, the address and the roles. There is no digest of the body, no moment and no nonce, so a signed write that was captured can have its body replaced and the signature still verifies. Data asks Access again for every mutation, so the damage is bounded by what the principal may do — but the assertion does not prove what it claims to prove.

The shape of the fix is a version of the assertion that carries:

- the moment it was made, and a short life;
- a nonce, and the way the replay is refused;
- the digest of the body for the methods that carry one;
- the headers that carry the security of the request, such as the key of the idempotency and the validators.

**The design choices that belong with it, and that G names:**

- **The body and the streaming.** A digest of a body needs the body. A request that streams cannot be digested without being buffered, and a bounded buffer is a change of the memory of the proxy. The choice is between buffering the bounded bodies and a verifiable design that streams.
- **The clock.** The skew that is tolerated, the life that is short enough to be useful, and what happens when the two disagree.
- **The replay store.** A store of nonces that is shared and atomic refuses a replay across the replicas. It is state that Data does not have today, and the behaviour when it is unavailable must be a refusal and not a pass.
- **The downgrade.** A signature that fails must never fall back to an older form of the assertion.
- **The rollout.** The bindings already name the version they accept. The gateway signs both versions, the bindings of Data move, the old version is retired with a date, and the compatibility suite covers the passage.

`docs/platform/security.md` says that a compromised gateway that holds the signing key can mint an identity. G notes that the sentence is stronger than the mechanism allows: an asymmetric signature protects an upstream that holds only the public key, not a gateway that holds the private one. The sentence should say which threat it addresses.

### 5.2 The creation of a workspace

`packages/data/src/app/routes.ts` compares `identity.expectedTenantId` with the tenant of the workspace for every ordinary route (line 61). The creation of a workspace compares nothing: `establishTenant()` holds only that the identity names no workspace, and the tenant of the body is taken as it comes. A binding that pins a route to one tenant therefore does not hold for that route.

The comparison belongs next to the check that already exists, and it belongs before the authorisation is resolved. A binding that names no tenant keeps the behaviour it has today.

### 5.3 One validator for the context of the access

`packages/client/src/access.ts` → `context()` reads the answer and maps it with `allow: body?.allow === true`; it checks neither the subject, nor the tenant, nor the workspace, nor the route, nor the version, nor the moment the answer stops being valid. The console builds its whole scope of the operator on that answer.

Data already has the strict validator, in `packages/data/src/domains/authorization/access-context.ts`. The two services share nothing by design, and the validator is a good candidate for the exception: it is the contract of Access, and the client of the platform is the natural place for it.

Until then, the client of the platform must at least refuse an answer that carries no moment of validity, refuse a moment that is already past, and refuse an answer whose moment is further away than the maximum that Access announced. An administrative write asks for a fresh answer.

### 5.4 The names of the roles and of the versions

Two drifts that no check holds:

- The role of Access is named `access_owner` by the script that provisions it, and `access_app` by the stacks and by the documentation. The split of §3.6 is the moment to settle on one name.
- The version of the platform is `1.5.0` in every package, `1.0.0` in the README and `1.0.1` in the specification of the console. The command `bun run versions` reads the packages, the images and the probes; it does not read the prose. It should.

---

## 6. Wave 4 — the drift guards and the documentation

### 6.1 One vocabulary of the permission keys

The keys are written out by hand in three packages: `packages/access/src/domains/administration/platform-permissions.ts`, `packages/access/src/domains/administration/tenant-admin.ts`, `packages/data/src/app/routes.ts` and `packages/console/src/domains/operators/scope.ts`. Nothing compares them.

The guard may be a test that reads the three files and compares the sets of keys, as `scripts/client-paths:check` compares the paths of the two clients. It needs no new package and it fails the build when a key is renamed in one place and not in the others.

### 6.2 A parity test for the rules of the administration

The keys are only half of the vocabulary. `administrationRules()` in the console is a hand copy of the operator policy of Access, and the copy has no test against the original.

The parity test runs the same cases against both — an operator of a tenant, an operator of the platform, a key of the platform given by a tenant operator — and fails on a difference. It matters less once §4.2 lands, and it matters a lot until it does.

The test must not make one package import the other: the services stay deployable apart. The cases live in a shared fixture of expectations, and each side is checked against it.

### 6.3 The documentation of the console

The header of `packages/console/src/domains/ability/ability.ts`, the README of the console and the specification of the console say that the ability is a mirror and never an authority. That is true of the data, and it is not true of the administration, where the ability decides which credential is presented.

**The correction lands with this plan, not with §4.2.** The claim is in the source today and it is wrong today; the fix that makes it true is later. The documentation says what is, and names the guard that holds.

---

## 7. The regression suite

The suite that would have caught every item above, one test each:

| Test | Where | What it holds |
| --- | --- | --- |
| The outbox refuses the rows of another tenant, with and without a scope | `packages/data/test/integration/postgres.test.ts` | 3.1, 3.2 |
| A connection that returns to the pool carries no scope | `packages/data/test/integration/` | 3.2 |
| Every policy names a role and a command, and no permissive one widens a scoped one | `packages/data/test/architecture/` | 3.3 |
| The role of the owner is refused at the start | `packages/data/test/unit/` | 3.4 |
| The drift of the live schema stops the readiness | `packages/data/test/` | 3.5 |
| The scope of a tenant may not write the rows of the catalogue | `packages/access/test/` | 3.8 |
| The console refuses a tenant it holds no credential for | `packages/console/test/` | 4.1 |
| A listing that is not whole refuses a decision | `packages/console/test/` | 4.5 |
| The configuration that leaves out `console.platform` is refused | `packages/access/test/` | 4.3 |
| A mutation that names an object of another tenant is refused | `packages/access/test/` | 4.4 |
| The signed identity refuses a body that changed, a past moment and a reused nonce | `packages/data/test/` | 5.1 |
| The creation of a workspace refuses a tenant that the binding does not name | `packages/data/test/contract/` | 5.2 |
| The client of the platform refuses an expired or malformed context | `packages/client/test/` | 5.3 |
| The permission keys of the three packages are the same set | `scripts/` | 6.1 |
| The rules of the administration of the console and of Access agree | `test/` | 6.2 |

Two rules hold for the whole table:

- The behaviour of the policies is the behaviour of a server. Every test of the first column belongs in the job of the integration, which builds a real cluster and applies the migrations of the deployment, and not in the unit suites.
- **The tests of the console's administration run with the console holding only the credential of the platform.** That is the configuration in which the exposure lives, and a suite that runs only in the safe configuration proves nothing about it.

---

## 8. Exit criteria

| Wave | The work is done when |
| --- | --- |
| 0 | The inventory is recorded, and no operator of a tenant depends on the fallback of the credential of the platform |
| 1 | The tests of the outbox **fail on the current schema and pass after `0012`**; the worker still claims and acknowledges deliveries as `data_delivery`; the registry reader still reads only its projection; the guard of §3.3 refuses an unrestricted policy given to the wrong role |
| 2 | A tenant operator is refused every administrative write when the console holds no credential of the tenant; a tenant credential cannot grant `console.platform` under a custom list; a write of a role is refused when the listing is not whole; an object of another tenant is refused, with and without the credential of the platform configured |
| 3 | A request whose body changed is refused; a request past its life is refused; a nonce that was used again is refused; the creation of a workspace for a tenant the binding does not name is refused |
| 4 | The keys of the three packages are one set; the rules of the administration agree; the documentation says what the code does |

---

## 9. The gates of the test and of the release

1. The types, the architecture gates, the unit and the contract suites run, and the integration suites of Data and of the gateway run against a real server. The database isolation and the roles are tested on the versions of PostgreSQL the deployment supports, including the target of the project.
2. The flows that matter are exercised end to end with two tenants, an operator of a tenant and an operator of the platform, more than a thousand roles, more than one replica, and contexts that are well formed and malformed.
3. The migrations are forward only, and the data of a rehearsal survives them. The credentials of the tenants are provisioned before the fallback is removed. The change of the signature is a coordinated and versioned passage, with a way back that does not reopen a boundary that was closed.
4. **What ran is recorded: the suites, the environment and the result.** A job of the continuous integration that was not observed is not a result. This is the correction C and G both made to M, and it is a rule of the release and not of a document.

---

## 10. Sequencing

| Order | Work | Why it comes here |
| --- | --- | --- |
| 1 | 2, the inventory | Nothing below is safe to write without it |
| 2 | 3.1, 3.2, 3.3 | The defect is certain, the fix is small, and the test is the proof that the other waves rest on |
| 3 | 3.5, 3.4 | The checks that would have caught the defect, and the ones that stop a service from serving with an unsafe role |
| 4 | 4.1, 4.3, 6.1 | The configuration and the vocabulary; they are small and they remove two of the paths |
| 5 | 4.4 | The binding of the objects to the tenant, at Access, with a test per route |
| 6 | 4.5 | The thousand rows; only after the path is proved |
| 7 | 5.2, 5.3 | The contracts; each is a change of a contract and a compatibility question |
| 8 | 5.1 | The version of the assertion; the largest change, and the one with a migration of the deployments |
| 9 | 4.2 | The delegated authority; the largest of all, and the one that makes the console a client |
| 10 | 3.6, 3.7, 3.8, 5.4, 6.2, 6.3 | The split of the roles of Access, the audit table, the catalogue, the names, the parity and the documentation |

---

## 11. What was taken from the plans of C and G

| From | What | Where it landed here |
| --- | --- | --- |
| G | The inventory of the deployments before any change of the credentials | §2 — promoted to the first wave |
| G | The review of the grants that exist under the older configuration, before a revocation | §2.2 |
| G | The containment while the fixes are built | §2.3 |
| C | The fallback is in four places, not one, and two of them are the path of the workspaces | §4.1 — the table of the four call sites |
| C | The path of the platform operator is kept | §4.1 |
| C | The parity test of the rules of the administration, not only of the keys | §6.2 |
| C | The correction of the documentation of the console lands now, not with the fix | §6.3 |
| C | The name of the role of Access and the version in the prose | §5.4 |
| G | A caller-supplied address is not proof of an authority | §4.2 |
| G | The body and the streaming, the clock, the replay store, the downgrade, the rollout | §5.1 |
| G | The catalogue of PostgreSQL: the policies, the memberships, the grants, the owner | §3.2, §3.3 |
| G | The wide policies that are reviewed are named, not banned | §3.3 |
| G | The policy of the catalogue of the permissions, split by command | §3.8 |
| G | The connection that returns to the pool carries no scope | §3.2 |
| G | The pools of the registry and of the delivery are checked against their own roles | §3.4 |
| C, G | The exit criteria of every wave, and the gates of the release | §8, §9 |
| G | The tests of the console run in the configuration in which the exposure lives | §7 |
| C, G | The role of the policy of the permissions was checked before it was added | §3.8 — `resolvePermission()` writes the row of the catalogue in the scope of the platform, so it is a gap of defence in depth and not a live path |

**What was not taken.** G proposes a database identity per tenant, and a mechanism that no service identity can imitate. That is the right answer to a compromise of the runtime role, and it is a change of the shape of the deployment. It is recorded in §12 as an open question, not scheduled here.

---

## 12. What is still open

- **The thousand rows and the expired context.** Both need a test before they are scheduled (§0).
- **The severity of the outbox defect.** C and G both note that the payload of an event carries metadata and not the values of the fields, and that no route reaches it. The proven harm is the weakened backstop. The plan treats it as High because the backstop is the thing the whole isolation rests on — C says its own High may be one step too strong.
- **The threat model of the database.** The scope of a transaction is a backstop against an omitted filter. It is not an isolation from arbitrary statements run as the same identity, because that identity may set the scope it likes. `docs/platform/security.md` must say which of the two it claims, and a deployment whose threat model includes a compromised service needs stronger identities than one role per service.
- **The scores.** The three assessors gave 8.5, 8 and 7 for the cohesion, and 9, 7 and 3 for the security. G counts the disagreement over the authority a problem of cohesion; M counts it as a problem of the security. The reconciled figures are 8.0 and 7.0, and the plan is what moves them.

---

## 13. What has been done

The work below was applied to the tree, in the order of §10. Every item was proved with a test that fails without it.

| Item | What was done | The proof |
| --- | --- | --- |
| §3.1 | The migration `0012_outbox_policies.sql` gives the three policies their role and takes the select on the events from the role of the API | The tests of the outbox fail without it and pass with it |
| §3.2 | Six tests in `packages/data/test/integration/postgres.test.ts`: the API reads no event, with a scope or without one, writes the deliveries of its own tenant only, and the worker still reads the events of every tenant | The four that prove the defect were red before the migration |
| §3.3 | The gate `packages/data/scripts/gates/policies.ts` holds the effective policy of every table: a policy names its role or reads the scope, the roles are the five of the separation, and every table of the deployment forces its isolation. The gate runs in the `architecture` command | It names the three policies of `0004` when the migration is taken away |
| §3.4 | `roleOf()` reads whether the role owns a table of the deployment and whether it is a member of the role that owns them, and the readiness refuses both | `packages/data/test/integration/readiness.test.ts` |
| §3.5 | The readiness asks `detectDrift()`, which was called by a test and by nothing else | The readiness is not ready when the isolation of a table is turned off, and it is ready again when it is restored |
| §4.3 | The list of the platform permissions extends the built-in keys and may not leave them out; Access refuses to start on a value that does | `packages/access/src/runtime/env.test.ts`, and the configuration and the specification of Access were corrected |
| §5.2 | The creation of a workspace compares the tenant of the body with the tenant of the binding | The test is red without the comparison and green with it |
| §5.3 | The client of the platform validates the whole contract of the context: the version, the decision, the four identifiers of the question, the keys, the moment of the evaluation and the moment the answer stops being valid. The console asks Access again for a write | Six new tests in `packages/client/test/access.test.ts`, and the fixtures of the console were corrected to the shape of the contract |
| §6.1 | The script `scripts/check-permission-keys.ts` holds the three copies of the vocabulary together, and it runs in the continuous integration | It names the key that is renamed in one place and not in the others |
| §6.3 | The header of the ability and the specification of the console say that the ability is a mirror of the data and a guard of the administration | The claim was false for the administration |
| §2 | The inventory was read from the stacks, the templates and the code, and it is recorded in §2.2 | — |

**What is not done, and why.**

- **§4.1, the removal of the fallback of the credential.** The inventory says the compose stacks hold no credential of any tenant: the removal would stop the administration of the tenants until they are provisioned. The refusal of §4.1 is the first half of the fix, and it waits for the second half.
- **§4.2, the delegated authority.** The largest change of the plan, and a change of the contract of the administration.
- **§4.4, the binding of the objects to the tenant.** It belongs at Access, and it changes the contract of every mutation that names an object.
- **§4.5, the thousand rows.** The path is not proved yet: it needs the test that C asked for.
- **§5.1, the version of the assertion.** A coordinated passage between the gateway and Data, with the choices of G still open.
- **§3.6, §3.7, §3.8, §5.4, §6.2.** The split of the roles of Access is a change of the deployment. The audit table and the catalogue are two policies of Access. The names and the versions are the README and the specification of the console. The parity of the rules of the administration waits for §4.2.
