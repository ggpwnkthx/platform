# Security

How to report a vulnerability in the platform, and what happens next. One policy covers the gateway, the access service and the data service.

## Supported versions

| Workspace | Supported |
| --- | --- |
| `packages/gateway/` | The platform release line |
| `packages/access/` | The platform release line |
| `packages/data/` | The platform release line |

Each release carries all three services, so a fix in the platform release line reaches all of them at once.

## Reporting

Report privately, never in a public issue:

- open a **security advisory** on the repository, or
- email `security@ggpwnkthx.com`.

Include the service, version, reproduction steps and the impact you expect.

## What happens next

1. We confirm the finding, or close it with the reason it isn't one.
2. We prepare a fix on an unpublished branch.
3. We cut a release containing the fix and its changelog entry.
4. We publish the advisory, naming the affected versions and the fixed version.

A finding that is already public is handled at the pace of the disclosure: the fix ships as soon as it is proven.

## Security model

Trust boundaries, secret handling and least privilege: [platform security](docs/platform/security.md). Each service's model is in its own docs.
