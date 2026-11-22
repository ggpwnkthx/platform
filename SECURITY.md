# Security policy

Report vulnerabilities privately to your deployment/repository maintainers. Include the
version and reproduction; a failing test against packages/core/test/platform.test.ts is useful. Do not
include live passwords, tokens or captured `/pg` WebSocket traffic in a public issue.

Platform 2.3.0 uses PostgreSQL-native identity and permissions, with sign-in through Dex. The
interface is a static site that speaks PostgreSQL's protocol through a relay; there is no
application server. See [security boundaries](docs/security.md), [interface](docs/interface.md)
and [operations](docs/operations.md).
