#!/bin/sh
# Writes the site's configuration from the environment, before nginx starts.
#
#   PUBLIC_URL         Required. The address people open, such as https://platform.example.com.
#                      WebSockets from any other origin are refused.
#   OIDC_ISSUER        Required. The one issuer PostgreSQL trusts: your Dex.
#   OIDC_CLIENT_ID     The public client the pages sign in with. Default: platform-console.
#   OIDC_CLAIM         The token claim that names the PostgreSQL role. Default: email.
#   DATABASE_NAME      The database Platform is installed in. Default: platform.
#   RELAY_UPSTREAM     host:port of the WebSocket relay in front of PostgreSQL. Default: relay:8081.
#   STATEMENT_TIMEOUT_MS  Sent with each login. Default: 15000.
#   SESSIONS_PER_ADDRESS  Open database sessions one client address may hold. Default: 20.
#   LISTEN_PORT        The port this server listens on. Default: 8080.
set -eu

public=${PUBLIC_URL:?PUBLIC_URL must name the address people open}
issuer=${OIDC_ISSUER:?OIDC_ISSUER must name the OpenID Connect issuer}
client=${OIDC_CLIENT_ID:-platform-console}
claim=${OIDC_CLAIM:-email}
database=${DATABASE_NAME:-platform}
upstream=${RELAY_UPSTREAM:-relay:8081}
timeout=${STATEMENT_TIMEOUT_MS:-15000}
sessions=${SESSIONS_PER_ADDRESS:-20}
port=${LISTEN_PORT:-8080}

public=${public%/}
issuer=${issuer%/}
for value in "$public" "$issuer"; do
  case $value in http://*|https://*) ;; *) echo "Not an http(s) URL: $value" >&2; exit 1 ;; esac
done
# These values are written into the server's configuration: refuse anything that could end a
# string or a directive there.
for value in "$public" "$issuer" "$client" "$claim" "$database" "$upstream"; do
  unsafe=$(printf '%s' "$value" | tr -d -c ' \t"\\;{}$'"'")
  if [ -n "$unsafe" ]; then echo "Unsupported character in: $value" >&2; exit 1; fi
done
case $timeout$sessions$port in *[!0-9]*) echo "STATEMENT_TIMEOUT_MS, SESSIONS_PER_ADDRESS and LISTEN_PORT are numbers" >&2; exit 1 ;; esac

# The origin of a URL: scheme, host and port, without a path.
origin() { printf '%s' "$1" | sed -E 's#^(https?://[^/]+).*#\1#'; }
public_origin=$(origin "$public")
issuer_origin=$(origin "$issuer")
case $public_origin in https://*) transport=wss ;; *) transport=ws ;; esac
socket_origin="$transport://${public_origin#*://}"

mkdir -p /tmp/platform
cat > /tmp/platform/config.json <<JSON
{
  "issuer": "$issuer",
  "clientId": "$client",
  "claim": "$claim",
  "relay": "/pg",
  "database": "$database",
  "statementTimeoutMs": $timeout
}
JSON

hsts=''
case $public_origin in https://*) hsts='add_header Strict-Transport-Security "max-age=31536000" always;' ;; esac

cat > /tmp/platform/site.conf <<CONF
server {
  listen $port;
  root /usr/share/nginx/html;

  # The pages talk to this origin, to its WebSocket, and to the issuer for the sign-in.
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' $socket_origin $issuer_origin; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  $hsts

  location = /health {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
  }

  location = /config.json {
    alias /tmp/platform/config.json;
    default_type application/json;
    add_header Cache-Control no-store always;
    add_header Content-Security-Policy "default-src 'none'" always;
  }

  # PostgreSQL's protocol, carried over a WebSocket to the relay. The token travels inside it
  # and is checked by PostgreSQL alone; this server only refuses other sites' pages.
  location = /pg {
    if (\$http_origin != "$public_origin") { return 403; }
    limit_conn sessions $sessions;
    proxy_pass http://$upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    proxy_buffering off;
  }

  location / {
    # Every page is a file; an address that names no page is answered with none.
    try_files \$uri \$uri/index.html =404;
    add_header Cache-Control no-cache always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' $socket_origin $issuer_origin; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    $hsts
  }
}
CONF
