# Contributing

How to make a change to the platform: the order of the work, the kinds of tests, the pull request checklist, where documentation goes, how to write it, and how to commit. It is for anyone opening a pull request.

Each service's spec defines its behavior. Update the spec in the same commit as the code whenever behavior changes; otherwise a customer-facing contract changes without notice.

## Order of a change

1. **Spec.** Update the workspace's spec first, because it is normative.
2. **Code.** Put rules in domains (`src/domains/`), thin handlers in `src/app/`, storage adapters in `src/platform/`, and wiring in the composition root (`src/runtime/`). `bun run architecture` checks the boundaries.
3. **Docs.** Update the rest of [`docs/`](docs/README.md), following [Where documentation goes](#where-documentation-goes).
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

[Development](docs/platform/development.md) covers every command, the integration test setup and the run modes. The compatibility suite needs no network; see [Compatibility](docs/platform/internals.md#compatibility).

## Where documentation goes

All documentation lives under `docs/`, organized by service and, through role pages and guides, by reader.

| Location | Holds |
| --- | --- |
| `docs/<service>/` | Everything about one service (`gateway`, `access`, `data`, `console`, `cli`), using the page set below |
| `docs/platform/` | Cross-cutting pages: overview, concepts glossary, quickstart, development, operations, security, internals, decisions, and the atlas |
| `docs/roles/` | One guide per role (database administrator, operator, security operations, developer, maintainer, console user) that links into the service pages. The console builds each role's navigation from its page: second-level headings become sections, and each list item or table row that links into `docs/` becomes an entry, labelled by its first cell when that cell is plain text. Add a role by adding a page and a row in `roles/README.md`, which sets the order. |
| `docs/guides/` | Task guides for jobs that span several services, linking into each service's pages |

Each service directory uses these pages, keeping only the ones that apply:

| Page | Job |
| --- | --- |
| `README.md` | Overview: what the service does and does not do, where it sits, key concepts, a "find your way" table, the version |
| `spec.md` | The normative contract: behavior, invariants, endpoints, error codes and limits, in numbered sections |
| `api.md` | HTTP endpoint reference with request and response examples |
| `configuration.md` | Every environment variable and config file the service reads |
| `operations.md` | Running it in production: deploy, probes, metrics, logs, runbooks, secret rotation, backup, rollout |
| `troubleshooting.md` | Symptom first: what you see, the likely cause, what to check, the fix |
| `internals.md` | For maintainers: code layout and import rules, tests, capacity, security review, release readiness, known limits |
| `decisions.md` | The decision log, with evidence |
| Service guides | Task pages specific to one service, such as `gateway/upstream-identity.md` or `data/client.md` |

Put each kind of content in exactly one place:

- **Behavior** goes in `spec.md`. Other pages summarize it in a sentence and link to the section.
- **Variable tables** go in `configuration.md`. The spec states only the behavioral rule, such as what production refuses.
- **Procedures** go in `operations.md` or a guide.
- **Rationale** goes in `decisions.md`.
- **Code layout, import rules, tests and release steps** go in `internals.md`, not in the spec.
- **Shared terms** go in [Concepts](docs/platform/concepts.md), linked to the spec that owns each one.

## Writing style

These rules apply to docs, code comments and log messages:

- **Lead with a summary.** Start every page with its title and one short paragraph that says what the page covers and who it is for. The console shows that paragraph in its index.
- **Write plainly.** Use present tense, active voice and short paragraphs. Address the reader as "you".
- **Use imperative steps.** Write procedures as numbered steps that start with a verb: "Set `ACCESS_ISSUER`", "Run the migration".
- **Name services plainly.** Write "the gateway", "Access", "Data", "the console" and "the CLI (`platformctl`)", never "the Access" or "the Data".
- **Say it once.** A rule written in two places will be contradicted in one of them. Link instead of copying; the docs check rejects any sentence of eight or more words that appears twice.
- **Name the subject.** "Secrets are compared in constant time" is a rule; "secrets are compared safely" is not.
- **One rule per sentence.** People and tools both read the docs.
- **Numbers match.** "Nine endpoints" means nine in the code and in the docs, and a test checks it.
- **Use the docs' Markdown.** The console renders a subset: no images, no inline HTML, no nested lists, and every code span, emphasis and link closed on the same line.
- **English only.**

## Commits

Make one change per commit. The subject says what the change does, in the present tense, with one of the type prefixes `feat`, `fix`, `docs`, `test`, `chore` or `refactor`:

```text
feat: the administration has a credential per tenant
fix: the secrets of a deployment are not short
docs: the routes and the documents agree
```
