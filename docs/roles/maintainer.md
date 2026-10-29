# Repository maintainer

You change the platform's own code: the three services, the console, the CLI and the tooling around them. They live in one repository with one lockfile, one CI and one release line. This page is your map of the rules you work under and the pages that record how the code is built, tested and released.

## Start here

1. [CONTRIBUTING.md](../../CONTRIBUTING.md): the order of a change, the checks a pull request must pass, commit rules and where documentation goes.
2. [Development](../platform/development.md): run modes, commands and tests.
3. [Platform internals](../platform/internals.md): repository layout, enforced boundaries, compatibility and release.
4. The internals page of the workspace you are changing, below.

## The rule behind every change

Behavior is defined by the owning service's spec, so a behavior change edits the spec first and lands in the same commit as the code and its tests. A decision that changes a contract is written into the service's decision log, with the evidence that proves it. The details are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Per workspace

| Workspace | Behavior | Code layout and tests | Decisions |
| --- | --- | --- | --- |
| `packages/gateway/` | [Gateway spec](../gateway/spec.md) | [Gateway internals](../gateway/internals.md) | [Gateway decisions](../gateway/decisions.md) |
| `packages/access/` | [Access spec](../access/spec.md) | [Access internals](../access/internals.md) | [Access decisions](../access/decisions.md) |
| `packages/data/` | [Data spec](../data/spec.md) | [Data internals](../data/internals.md) | [Data decisions](../data/decisions.md) |
| `packages/console/` | [Console spec](../console/spec.md) | [Console workspace README](../../packages/console/README.md) | [Console workspace README: decisions](../../packages/console/README.md#decisions) |
| `packages/cli/` | [CLI spec](../cli/spec.md) | [CLI workspace README](../../packages/cli/README.md), [Platform internals: CLI workspace](../platform/internals.md#cli-workspace) | — |
| Repository and tooling | — | [Platform internals](../platform/internals.md) | [Platform decisions](../platform/decisions.md) |

## Common tasks

| Task | Where |
| --- | --- |
| Respect the import boundaries | [Platform internals: boundaries](../platform/internals.md#boundaries), [Gateway internals: import rules](../gateway/internals.md#import-rules), [Data internals: domains and import rules](../data/internals.md#domains-and-import-rules) |
| Add a collection to the example deployment | [Data modeling: add a collection](../data/modeling.md#add-a-collection) |
| Run the integration suites against real PostgreSQL and Redis | [Development: integration tests](../platform/development.md#integration-tests) |
| Run the compatibility suite | [Platform internals: compatibility](../platform/internals.md#compatibility), [Access internals: compatibility suite](../access/internals.md#compatibility-suite), [Data internals: compatibility](../data/internals.md#compatibility) |
| Measure capacity | [Gateway internals: capacity](../gateway/internals.md#capacity), [Access internals: capacity](../access/internals.md#capacity), [Data internals: capacity](../data/internals.md#capacity) |
| Cut a release | [Platform internals: release](../platform/internals.md#release), [Data internals: release readiness](../data/internals.md#release-readiness), [Access internals: release readiness](../access/internals.md#release-readiness) |
| Write or move documentation | [CONTRIBUTING.md](../../CONTRIBUTING.md) |

## What the build checks in the docs

Several checks read the documentation, so a docs change can fail CI:

| Check | What it enforces |
| --- | --- |
| `bun run docs:check` | Every relative link and anchor resolves, and no prose sentence of eight words or more appears twice |
| Console documentation tests | Every page uses the markdown subset the console renders |
| `bun run api:check` | The endpoints named in the gateway spec and the Access and Data API pages match the code |
| Gateway architecture tests | Gateway configuration names every `GATEWAY_*` variable the code reads, and no other |
| Access architecture tests | Every `§N` cited in Access code and docs exists in the Access spec, every route is documented, and the count of administrative endpoints is stated correctly |
| Version gates | The `Status:` line of each spec and the version line of the Access overview match the release |
| `bun run evidence:check` | Every path cited as evidence in a decision log exists and its tests run in CI |
