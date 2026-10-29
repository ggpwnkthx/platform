# Decisions

Design decisions behind Access contract, with evidence. [spec.md](spec.md) is normative; [platform decisions](../platform/decisions.md) defines this table and when a decision changes the contract.

| # | Question | Decision | Stated in | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Where does multi-tenancy live? | In Access, never in the gateway. A gateway keeps one provider and one deployment of Access, so one gateway deployment serves one tenant. | §1.4 | resolved | `src/domains/identity/tenant.ts`, `test/contract/shared-client.test.ts` |
| 2 | Is Access an OpenID Connect provider or client? | Both: a client of each tenant's provider and a provider for the gateway. The gateway does not need to know. | — | resolved | `src/domains/provider/service.ts`, `src/domains/provider/discovery.ts` |
| 3 | What keys an identity mapping? | `(tenant, subject)`. Never the e-mail: it is mutable and not an identity. | §6.2 | resolved | `src/domains/identity/mapping.ts`, `test/contract/login.test.ts` |
| 4 | Is a principal created at first login? | Only when the tenant has `auto_provision = true`, and then with no grant: login succeeds, access does not. | §6.4 | resolved | `src/domains/identity/mapping.ts`, `test/contract/login.test.ts` |
| 5 | What decides access? | The grants table alone. Request roles are a token snapshot; reading them would honor a revoked grant until the next login. | §8.4 | resolved | `src/domains/authorization/decision.ts`, `test/contract/decisions.test.ts` |
| 6 | Does Access cache decisions? | No. The table is the truth, the query is one statement over indexed tables, and revocation latency is the gateway's cache TTL. | §8.6 | resolved | `src/domains/authorization/decision.ts`, `test/integration/decision-rule.test.ts` |
| 7 | How many administrative endpoints? | Twelve (seven that change, five that list) plus one that reads the audit. Nothing else changes tenants, principals or grants, so the audit is complete. | §10 | resolved | `src/domains/administration/service.ts`, `test/contract/administration.test.ts` |
| 8 | Why store the authorization code instead of making it self-contained? | A self-contained code can be redeemed twice within its lifetime. Storing it makes it single use, which the gateway relies on. | §5.5 | resolved | `src/domains/provider/code.ts`, `test/contract/login.test.ts` |
| 9 | Why no refresh tokens? | The gateway does not use them. A refresh token is a credential to store, rotate and revoke; that feature is deferred. | §7.2 | resolved | `src/domains/provider/tokens.ts`, `src/domains/identity/token.ts` |
| 10 | Why is the denial reason free text? | The gateway hides it and only counts it. The reason vocabulary lets the gateway's count separate a missing role from every other denial. | §8.7 | resolved | `src/domains/authorization/decision.ts`, `test/contract/refusals.test.ts` |
