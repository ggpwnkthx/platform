# Security

How to report a vulnerability in the platform, and what happens after you do. One policy covers the gateway, Access and Data.

## Supported versions

| Workspace | Supported |
| --- | --- |
| `packages/gateway/` | The platform release line |
| `packages/access/` | The platform release line |
| `packages/data/` | The platform release line |

Every release carries all three services, so a fix on the platform release line reaches each of them at the same time.

## Reporting

Report privately. Never open a public issue for a vulnerability. Use either channel:

- open a **security advisory** on the repository;
- email `security@ggpwnkthx.com`.

Include the service, the version, steps to reproduce, and the impact you expect.

## What happens next

1. We confirm the finding, or close it and give the reason it is not one.
2. We prepare a fix on an unpublished branch.
3. We cut a release that contains the fix and its changelog entry.
4. We publish the advisory, naming the affected versions and the fixed version.

If a finding is already public, we work at the pace of the disclosure and ship the fix as soon as it is proven.

## Security model

The [platform security](docs/platform/security.md) page covers trust boundaries, secret handling and least privilege, and links to each service's own rules.
