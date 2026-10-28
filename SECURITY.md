# Security

The platform is three services, and the security policy of the platform
is the policy of the three of them.

## The supported versions

| Workspace | The supported line |
| --- | --- |
| `packages/gateway/` | The release line of the platform |
| `packages/access/` | The release line of the platform |
| `packages/data/` | The release line of the platform |

A release of the platform carries the three services. A finding is
fixed in the release line of the platform, and it reaches the three
services at the same time.

## The reporting of a finding

Report it privately, and not in a public issue:

- open a **security advisory** of the repository, or
- write to `security@ggpwnkthx.com`.

Include the service, the version, the way to reproduce it and the impact
you believe it has.

## What happens next

1. The finding is confirmed, or it is closed with the reason why it is
   not one.
2. A fix is prepared on a branch that is not published.
3. A release is cut, and the release carries the fix and the changelog
   of it.
4. The advisory is published, and it names the versions that are
   affected and the version that fixes it.

A finding that is already public is a disclosure that happened: it is
handled at the speed of the disclosure, and the release that fixes it is
cut as soon as the fix is proven.

## The model of the security of the platform

The trust boundaries, the way a secret crosses them and the way the
least privilege is held are in
[the security of the platform](docs/platform/security.md). The model of each
service is in the documentation of its contract.
