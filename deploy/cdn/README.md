# Publishing the interface

The interface is a directory of files. There is no server to run: `bun run build:ui` (or
`bun run cli deploy local ui`) writes `packages/ui/dist`, and that directory is what a CDN serves.

```
packages/ui/dist/index.html          one file per page, prerendered
packages/ui/dist/app.js              the client bundle
packages/ui/dist/styles.css          the styles
packages/ui/dist/fonts/              the self-hosted fonts
packages/ui/dist/config.json         where the pages find the issuer, the relay and the database
packages/ui/dist/_headers            the headers the site is served with
```

## The two files that differ per deployment

`config.json` tells the pages where to sign in and where to open their database sessions.
It is read at run time, so one bundle serves every deployment: the deployment swaps this
one file.

```json
{
  "issuer": "https://idp.platform.example.com",
  "clientId": "platform-console",
  "claim": "email",
  "relay": "wss://api.platform.example.com",
  "database": "platform",
  "statementTimeoutMs": 15000
}
```

`_headers` carries the security headers, including the Content-Security-Policy that names
the relay and the issuer. Cloudflare Pages and Netlify read this file as it is; other CDNs
need the same headers set by their own means (CloudFront's response headers policy, Fastly's
`set_headers`, Fastly's or Cloudflare's edge rules).

The values in both files come from one source, `packages/ui/src/headers.ts`, so the site a CDN
serves, the development server and the tests cannot drift apart. `bun run build:ui` writes
them from the environment:

| Variable                 | What it names                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| `PLATFORM_PUBLIC_URL`    | the address the site is served from                                |
| `PLATFORM_ISSUER`        | the issuer the pages sign in against                               |
| `PLATFORM_RELAY_URL`     | the address of the relay, such as `wss://api.platform.example.com` |
| `PLATFORM_CLIENT_ID`     | the public client the pages sign in with                           |
| `PLATFORM_CLAIM`         | the token claim that names the PostgreSQL role                     |
| `PLATFORM_DATABASE_NAME` | the database Platform is installed in                              |

## Publishing

Any static host will do. Two rules:

1. `config.json` must not be cached for long, or a deployment will keep talking to the
   previous relay; the other files may be cached for as long as you like.
2. The headers in `_headers` must be sent with the pages. Without the policy, the browser
   refuses the sign-in and the session.

For example, with the AWS CLI:

```
bun run build:ui
aws s3 sync packages/ui/dist s3://$BUCKET --delete --cache-control 'public,max-age=300'
```

## The relay is the only part of ours that answers on the network

The pages open a WebSocket to the relay, which forwards the bytes to PostgreSQL's port.
The relay holds no credentials and reads nothing it carries: the reader's token travels
inside the PostgreSQL startup packet, and PostgreSQL alone checks it.

Put the relay behind TLS — an ingress controller, a cloud load balancer, a tunnel, or the
relay itself with `RELAY_TLS_CERT` and `RELAY_TLS_KEY`. Give it the address the pages use
(`PLATFORM_RELAY_URL`) and let it allow that site's origin alone (`RELAY_ORIGINS`).
