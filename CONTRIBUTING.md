# Contributing to the platform

The platform is three services whose **contracts are documents**. The
behaviour of each service is written down in the specification of its
workspace, and a change of behaviour is a change of that document
first, in the same commit as the code. A pull request that changes the
behaviour and does not change the specification is a pull request that
changes the contract of a service that carries a customer.

## The order of a change

1. **The specification.** The specification of the workspace is
   normative: the behaviour of the service is what it says. A change of
   behaviour is a change of the specification first.
2. **The code.** The rules live in the domains (`src/domains/`), the
   handlers are thin (`src/app/`), the adapters are the storage
   (`src/platform/`) and the composition root wires them
   (`src/runtime/`). The boundaries are checked by
   `bun run architecture`.
3. **The other documents.** The documentation of the platform and of the
   three contracts is one tree at the root of the repository (`docs/`):
   the parts that are common to the three are in `docs/platform/`, and
   the contract of a service is in the directory of its name.
4. **The tests.** A rule that has no test is a rule that is not
   implemented.

The tests are the mirror of the layers:

| Kind | Where | What it proves |
| --- | --- | --- |
| Unit | `src/domains/*/*.test.ts` | The rules of the domains. |
| Contract | `test/contract/` | The behaviour of the HTTP surface. |
| Integration | `test/integration/` | The behaviour against a real PostgreSQL and a real Redis. |
| Architecture | `test/architecture/` | The boundaries, the numbers of the documents, the routes and the documents. |
| Compatibility | `test/compatibility/` | The **real gateway of the platform, unchanged, against the access service**. |
| Platform | `test/` at the root | The workflows, the tools, the versions, the tagger and the baseline of the compatibility. |

## The commands

```bash
bun install
bun run dev          # the platform: the three services and the server of the development
bun run test          # the tests of the three workspaces
bun run compatibility # the three services together
bun run typecheck     # the types of the three workspaces
bun run lint          # biome lint
bun run format        # biome format --write .
bun run architecture  # the import boundaries of the three workspaces
bun run dead          # the dead code of the repository
bun run versions      # the version of the platform is the same everywhere
bun run repositories:check # the platform names one repository and its three images
```

A command of a single workspace is run with `--cwd`:

```bash
bun run --cwd packages/gateway test
bun run --cwd packages/access test
bun run --cwd packages/data test
```

`bun run dead --fix` removes the exports that nothing imports, and keeps
the code that uses them. Run it, then run `bun run typecheck`: a removal
leaves an import behind when the import was only there for the export.

The integration tests run on the embedded PostgreSQL of the process by
default. The compose file brings the real PostgreSQL and the real Redis
up for the tests that need them:

```bash
docker compose -f deploy/compose/platform.compose.yaml up -d postgres redis
bun run --cwd packages/gateway test:integration
bun run --cwd packages/access test:integration
bun run --cwd packages/data test:integration
```

The compatibility suite runs the three workspaces of this repository. It
needs no network: the references are the workspaces. The manual is in
[docs/platform/compatibility.md](docs/platform/compatibility.md).

## How to write here

The house style of the documents and of the comments is plain and
declarative:

- **Say what is true, and say it once.** A rule that is written in two
  places is a rule that is written in one place and contradicted in the
  other.
- **Name the subject.** "The comparison of the secrets is in constant
  time" is a rule; "the secrets are compared safely" is not.
- **A sentence is a sentence.** The documents of this repository are
  read by people and by tools: a long sentence that carries three rules
  is three sentences.
- **A number is a number.** "Nine endpoints" is nine in the code and
  nine in the documents, and a test holds them together.
- **English, and no other language.** The documents, the comments and
  the messages of the logs are in English.

## The commits

A commit is one change, and its message says what it changes:

```
feat: the administration has a credential per tenant
fix: the secrets of a deployment are not short
docs: the routes and the documents agree
```

The style of the repository is the one of the messages: the subject says
what the change does, in the present tense, without a prefix of a type
beyond `feat`, `fix`, `docs`, `test`, `chore` and `refactor`.
