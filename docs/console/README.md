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

| If you are | Read |
| --- | --- |
| somebody who wants to know what the console shows | [the overview](overview.md) |
| a reviewer of the console | [the security](security.md) |
| an operator who deploys it | [the operations](operations.md) |
| a developer of the console | [the README of the workspace](../../packages/console/README.md) |

The console has no specification of its own: it has no contract that
another program depends on. Every answer it shows is the answer of a
service, and the contract of that answer is the specification of that
service.
