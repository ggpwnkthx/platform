# The platform

This directory holds the documentation that is **common** to the three
services: the shape of the repository, the machine of a developer, the
deployment, the release, the security model and the baseline of the
compatibility.

The documentation of a **contract** is in the directory of its service,
and it is the normative one. A behaviour that the documentation of the
platform and the specification of a service describe differently is a
defect of the documentation of the platform.

## The documents

| Document | What it holds |
| --- | --- |
| [overview.md](overview.md) | What the platform does and how the pieces fit, in one page. |
| [architecture.md](architecture.md) | The layout of the repository, the workspaces and the boundaries between them. |
| [atlas.html](atlas.html) | The atlas of the platform: the whole platform on one page, the stations and the contracts between them, and a request walked over the map. |
| [development.md](development.md) | The machine of a developer: the commands, the tests and the fixtures. |
| [operations.md](operations.md) | How to deploy, configure, run and review the platform. |
| [release.md](release.md) | How a release is cut, what it carries and how it is verified. |
| [security.md](security.md) | The security model of the platform and how to report a finding. |
| [compatibility.md](compatibility.md) | The baseline of the platform and the suites that prove it. |
| [decisions.md](decisions.md) | The decisions of the platform, with their evidence. |

## The contracts

| Service | The specification | The api | The operations |
| --- | --- | --- | --- |
| The gateway | [spec.md](../gateway/spec.md) | [overview.md](../gateway/overview.md) | [operations.md](../gateway/operations.md) |
| The access service | [spec.md](../access/spec.md) | [api.md](../access/api.md) | [operations.md](../access/operations.md) |
| The data service | [specification.md](../data/specification.md) | [api.md](../data/api.md) | [operations.md](../data/operations.md) |
