# Gateway security

The gateway's security scope. The gateway decides who reaches every application behind it, so a bug in it
is a hole in front of all of them, and any problem report is treated as a vulnerability report.

The platform policy (supported versions, how to report, what happens next) is in the
[repository SECURITY.md](../../SECURITY.md).

## Supported versions

| Version | Supported |
| --- | --- |
| The platform release line | Yes |
| The line before the merge | No |

The gateway is at platform release `1.0.0`, and its contract is that release's
[specification](../../docs/gateway/spec.md). A release's behaviour never changes under an operator: a fix
that changes the contract is a new release.

## Reporting a problem

Write to the repository maintainers privately; a public issue is a public disclosure. Include:

- the gateway version and the runtime it runs on;
- what an attacker can do, and what they need to do it;
- reproduction steps and the configuration that reproduces it;
- gateway logs, **with credentials removed**.

The maintainers acknowledge within three working days and say what they expect to happen. A fix that needs
a release ships as soon as it is ready, and the report is published with it, naming the reporter unless
they ask not to be named.

## In scope

Anything that lets a caller reach an upstream, or an upstream reach something it should not:

- caller authentication and credential modes;
- workspace authorization and the access-service protocol;
- header policy, identity headers and the identity signature;
- gateway cookies and sessions;
- the cross-site guard;
- limits and the replicas' shared state;
- proxying of requests, uploads, responses and WebSockets;
- deployment configuration and its reload;
- deployment secrets.

## Out of scope

- The applications behind the gateway: the deployment that owns them is responsible.
- The identity provider, the access service and the shared state: they are dependencies, and a problem in
  one belongs to it. The access-service protocol is [spec §6.1](../../docs/gateway/spec.md); its
  conformance suite is `test/support/access-conformance.ts`.
- The ingress in front of the gateway: it terminates TLS and the deployment configures it.
- Volumetric denial of service: the gateway bounds its own resources and deployment limits bound traffic,
  but a deployment without the [spec §9](../../docs/gateway/spec.md) limits is not protected against a
  flood.
- The runtime: the release contract names the required version, and the gateway refuses to start on an
  older one.

## Release rules

- The gateway contract is the [specification](../../docs/gateway/spec.md). A behaviour change is a
  contract change, recorded there and in [CHANGELOG.md](../../CHANGELOG.md).
- The decisions behind the contract, with their evidence, are in
  [decisions.md](../../docs/gateway/decisions.md).
- Caller identities are signed with a private key only the gateway holds, so an upstream that verifies an
  identity cannot mint one.
- The gateway asks the access service and fails closed: no decision, no request.
- The gateway logs the policy it is running and names permissive settings.
