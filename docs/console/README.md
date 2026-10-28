# The console

The console is the interface of the platform: the one web application in
which people read and change the data of their workspaces, operators
administer the access to it, and anybody reads the state of the
services. It is a **client** of the gateway, of the access service and of
the data service: it speaks their contracts, it reaches none of their
databases, and it decides nothing.

The workspace is [`packages/console/`](../../packages/console/). It is an
application of [HonoX](https://github.com/honojs/honox), rendered on the
server and built with Vite; the parts of a page that live in the browser
are the islands of HonoX.

The console is one application with four places: the **overview**, the
**workspaces**, the **operators** and the **status**. Every place is a
page rendered on the server; the islands of HonoX make some of them
live in the browser.

| If you are | Read |
| --- | --- |
| somebody who wants to know what the console shows | [the places of the console](spec.md#62-the-places) |
| a reviewer of the console | [the specification](spec.md), then [the security](security.md) |
| an operator who deploys it | [the operations](operations.md) |
| a developer of the console | [the README of the workspace](../../packages/console/README.md) |

## The documents

| Document | What it holds |
| --- | --- |
| [spec.md](spec.md) | **The normative contract.** The behaviour of the console: the requests, the sessions, the scope of an operator and the places it shows. A change of behaviour is a change of this document first. |
| [security.md](security.md) | What the console holds, what it never holds and where the trust stops. |
| [operations.md](operations.md) | The environment, the deployment, the probes and the rotation of the secrets. |
| [../../CHANGELOG.md](../../CHANGELOG.md) | The releases of the platform, and the changes of the contract of each one. |

A reference to `§N` in the code, in the tests or in these documents is a
reference to a section of [spec.md](spec.md).

The console has no contract that another program depends on: every answer
it shows is the answer of a service, and the contract of that answer is
the specification of that service.
