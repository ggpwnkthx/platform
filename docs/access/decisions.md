# The decisions of the access service

[spec.md](spec.md) is normative for the behavior. This file records the
decisions behind it: what was decided, why, and where the evidence is. A
decision that changes the contract is recorded in the spec and in the
changelog, never only in the code.

The decisions that shape the contract are the rows that name a section of
[spec.md](spec.md); the column **Stated in** names it. The decisions of
the release that shape nothing in the contract are the rows that do not.

| # | Question | Decision | Stated in | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Where does the multi-tenancy live? | In the access service, never in the gateway. The gateway keeps one provider and one access service, so one gateway deployment serves one tenant of the access service. | §1.4 | resolved | `src/domains/identity/tenant.ts`, `test/contract/shared-client.test.ts` |
| 2 | Is the access service a provider or a client of OpenID Connect? | Both: a client of the provider of the tenant and a provider for the gateway. The gateway does not have to know. | — | resolved | `src/domains/provider/service.ts`, `src/domains/provider/discovery.ts` |
| 3 | What is the key of the mapping of an identity? | `(tenant, subject)`. Never the e-mail: an e-mail is mutable and is not an identity. | §6.2 | resolved | `src/domains/identity/mapping.ts`, `test/contract/login.test.ts` |
| 4 | Is a principal created at the first login? | Only when the tenant has `auto_provision = true`, and it has no grant: the login succeeds and the access does not. | §6.4 | resolved | `src/domains/identity/mapping.ts`, `test/contract/login.test.ts` |
| 5 | What decides an access? | The table of grants, and nothing else. The roles of the request are context, because they are a snapshot of the token and a policy that read them would allow a revoked grant until the next login. | §8.4 | resolved | `src/domains/authorization/decision.ts`, `test/contract/decisions.test.ts` |
| 6 | Is a decision cached by the access service? | No. The table is the truth, the query is a single statement over indexed tables, and the latency of a revocation is the TTL of the cache of the gateway. | §8.6 | resolved | `src/domains/authorization/decision.ts`, `test/integration/decision-rule.test.ts` |
| 7 | How many administrative endpoints? | Nine: five that change something, four that read a list, and one that reads the audit of the changes. They are the whole surface, and the reason a tenant, a principal and a grant can only be changed through them is that the audit is complete. | §10 | resolved | `src/domains/administration/service.ts`, `test/contract/administration.test.ts` |
| 8 | Why is the authorization code stored instead of being self-contained? | A self-contained code can be redeemed twice inside its life. The store makes it single use, which is the property the gateway relies on. | §5.5 | resolved | `src/domains/provider/code.ts`, `test/contract/login.test.ts` |
| 9 | Why are there no refresh tokens? | The gateway does not use one. A refresh token is a credential to store, rotate and revoke; it is a feature, it is deferred. | §7.2 | resolved | `src/domains/provider/tokens.ts`, `src/domains/identity/token.ts` |
| 10 | Why is the reason of a denial free text? | The gateway hides it and only counts it. The vocabulary of the reasons is chosen so the count of the gateway separates a missing role from any other denial. | §8.7 | resolved | `src/domains/authorization/decision.ts`, `test/contract/refusals.test.ts` |
