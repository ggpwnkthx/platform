# Contributing

Each service's spec defines its behavior. A behavior change updates the spec in the same commit as the code; otherwise it changes a customer-facing contract unannounced.

## Order of a change

1. **Spec.** Update the workspace's spec first; it is normative.
2. **Code.** Rules go in domains (`src/domains/`), thin handlers in `src/app/`, storage adapters in `src/platform/`, wiring in the composition root (`src/runtime/`). `bun run architecture` checks the boundaries.
3. **Docs.** Update the rest of [`docs/`](docs/README.md): `docs/platform/` for shared material, the service's own directory for its contract.
4. **Tests.** A rule without a test is not implemented ([Working rules](docs/platform/internals.md#working-rules)).

| Test kind | Location | Proves |
| --- | --- | --- |
| Unit | `src/domains/*/*.test.ts` | Domain rules |
| Contract | `test/contract/` | HTTP surface behavior |
| Integration | `test/integration/` | Behavior against real PostgreSQL and Redis |
| Architecture | `test/architecture/` | Boundaries, documented counts, routes and docs |
| Compatibility | `test/compatibility/` | The **real, unchanged platform gateway against Access** |
| Platform | root `test/` | Workflows, tools, versions, tagger, compatibility baseline |

## Before you open a pull request

- Spec, docs and changelog updated for any behavior change
- `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- `bun run architecture`, `bun run dead`, `bun run versions`, `bun run repositories:check`, `bun run deploy:check`, `bun run coverage:check` pass
- `bun run test` and `bun run compatibility` pass

All commands, integration test setup and run modes: [Development](docs/platform/development.md). The compatibility suite needs no network: [Compatibility](docs/platform/internals.md#compatibility).

## Writing style

Docs, comments and log messages:

- **Say it once.** A rule written in two places will be contradicted in one of them. Link instead.
- **Name the subject.** "Secrets are compared in constant time" is a rule; "secrets are compared safely" is not.
- **One rule per sentence.** Docs are read by people and by tools.
- **Numbers match.** "Nine endpoints" is nine in code and in docs, and a test checks it.
- **English only.**

## Commits

One change per commit. The subject says what the change does, in the present tense, with one of the type prefixes `feat`, `fix`, `docs`, `test`, `chore` or `refactor`:

```
feat: the administration has a credential per tenant
fix: the secrets of a deployment are not short
docs: the routes and the documents agree
```
