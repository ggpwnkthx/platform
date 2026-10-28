# Runtime

The Bun capabilities the gateway relies on, and the tests that prove them. The gateway is written against
the runtime directly, not a library that hides it, so each boundary behind [spec §4, §10 and §11](spec.md)
is proved by a `test/network/` test against a real socket.

**This release runs on Bun 1.4.3.** Older releases' results are kept because they explain why the version
is pinned ([decision 1](decisions.md)). Before reading its environment, the gateway checks the runtime
version and **stops** if it is too old: these boundaries are not observable on the 1.2 line, so a gateway
started there would behave in ways the spec does not describe. The check is `src/runtime/version.ts`,
tested by `src/runtime/version.test.ts`.

## Proved capabilities

| Capability | Proof | Runtime behaviour |
| --- | --- | --- |
| Streaming upload | `test/network/transport.test.ts`: the upstream polls received chunks while the client is still producing the body | Bytes reach the upstream during the upload. A buffered upload would be invisible until the body ended. |
| End of upload | Same test, the fixture's `/upload` endpoint | The end of the request stream is the end of the upload, and is the event the transport reports. Peer acceptance is a different observation and is not claimed. |
| Response phases | The raw server sends the head at once and the body a second later | The transport promise resolves on the **final headers** (1 ms); the first body byte arrives later (1002 ms). So the spec's two budgets (`responseMs`, `firstByteMs`) are observable separately. |
| Interim response | The raw server sends `103 Early Hints`, then the final response | The runtime reports only the final response. The gateway forwards the final response, never an interim one. |
| Protocol switch | The raw server answers `101 Switching Protocols` | The runtime refuses it: the transport fails and the exchange answers `502`. Protocol switches belong to the WebSocket upgrade. |
| Early response | The fixture answers `/early` without reading the body | The upstream's response arrives during the upload, and the runtime drops the rest of the upload (the body producer is cancelled). The upstream's response wins, as the spec requires. |
| Caller cancellation | The exchange signal is aborted | The upstream request is cancelled and the transport promise rejects. |
| Redirect | The fixture answers `302` with a location | Not followed: the upstream's response reaches the caller as is. |
| Compressed response | The fixture answers with `content-encoding: gzip` | The runtime decompresses **by default**, so the transport sets `decompress: false` and the upstream's bytes and `content-encoding` reach the caller unchanged. |
| Upstream WebSocket refusal | The fixture answers `403` instead of a handshake | The refusal is reported with its status, headers and body. It is not a network failure, and the caller should see it. |
| Upstream subprotocol | The fixture selects the first offered subprotocol | The selected subprotocol is reported and mirrored to the caller. |
| WebSocket handshake over TLS | The runtime's WebSocket client against a TLS server | The client cannot speak TLS: the handshake fails with an error that names no cause, against both Bun and OpenSSL servers. The gateway refuses the handshake with reason `tls` instead, visible in the log. **WebSocket upstreams are served over plain http.** |
| Caller upgrade | A raw client reads the `101` response | The handshake response carries the gateway headers (request id, refreshed cookie). Neither browsers nor the runtime's WebSocket client expose them, so the test reads the socket. |
| Upstream TLS | `test/network/tls.test.ts`: the upstream requests a client certificate | The gateway presents the deployment certificate and verifies the upstream's certificate against the deployment CA. If the upstream rejects the certificate, the connection fails and the gateway answers `502`. |

## Measured versions

| Version | Result |
| --- | --- |
| **1.4.3** | Every boundary above is observable. The release version. |
| 1.2.23 | The early response arrives, but the body producer is not cancelled; the `ws` library client's `unexpected-response` event is not implemented, so an upstream refusal is not observable; and the caller upgrade with gateway headers is refused. |
| 1.2.0 | The early response never arrives: the exchange waits for the upload to end. |

The spec requires `Bun ≥ 1.4.3`. Because the spec's boundaries are not observable on 1.2, the runtime
version is part of the contract and pinned ([decision 36](decisions.md)).
