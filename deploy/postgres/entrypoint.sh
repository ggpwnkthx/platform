#!/bin/sh
# Writes the client authentication rules, then hands over to the image's own entrypoint.
#
#   PLATFORM_OIDC_ISSUER   Required. The one issuer whose tokens are accepted: your Dex.
#   PLATFORM_OIDC_CLAIM    Token claim that must equal the PostgreSQL role name. Default: email.
#   PLATFORM_OIDC_JWKS_URL Optional. Where this server fetches the issuer's discovery document
#                          when the issuer's own URL is not reachable from here.
#   PLATFORM_HBA_HOST      host (default) or hostssl. Use hostssl wherever TLS is configured.
#   PLATFORM_TOKEN_ONLY_FROM
#                          Optional. Comma-separated CIDR blocks, such as the network of the
#                          WebSocket relay the interface reaches PostgreSQL through. A connection
#                          from them logs in with a token or not at all: not even the
#                          administrator's password is accepted from there.
set -eu

issuer=${PLATFORM_OIDC_ISSUER:?PLATFORM_OIDC_ISSUER must name the OpenID Connect issuer}
claim=${PLATFORM_OIDC_CLAIM:-email}
host=${PLATFORM_HBA_HOST:-host}
admin=${POSTGRES_USER:-postgres}

case $issuer in http://*|https://*) ;; *) echo "PLATFORM_OIDC_ISSUER must be an http(s) URL" >&2; exit 1 ;; esac
for value in "$issuer" "$claim" "$admin" "${PLATFORM_OIDC_JWKS_URL:-}"; do
  case $value in *[[:space:]\"\'\\,]*) echo "Unsupported character in: $value" >&2; exit 1 ;; esac
done
case $host in host|hostssl) ;; *) echo "PLATFORM_HBA_HOST must be host or hostssl" >&2; exit 1 ;; esac
token_only=''
for block in $(printf '%s' "${PLATFORM_TOKEN_ONLY_FROM:-}" | tr ',' ' '); do
  case $block in
    *[!0-9a-fA-F.:/]*|'') echo "PLATFORM_TOKEN_ONLY_FROM must list CIDR blocks: $block" >&2; exit 1 ;;
  esac
  token_only="$token_only$host   all  all           $block  oauth issuer=\"$issuer\" scope=\"\"
"
done

# The socket inside the container is the image's own administrative path, as upstream ships it.
# Over the network exactly one login has a password: the installer's administrator. Everyone
# else presents a token from the issuer, and the validator names the role it belongs to.
# Dex puts no scope claim in its tokens, so there is none to require.
# The relay's networks come first: the first matching rule decides, so from there only a token
# is a way in.
cat > /etc/platform/pg_hba.conf <<HBA
local   all  all                trust
$token_only$host   all  "$admin"      all  scram-sha-256
$host   all  all           all  oauth issuer="$issuer" scope=""
HBA

if [ "${1:-}" = postgres ]; then
  set -- "$@" \
    -c hba_file=/etc/platform/pg_hba.conf \
    -c oauth_validator_libraries=pg_oidc_validator \
    -c "pg_oidc_validator.authn_field=$claim"
  if [ -n "${PLATFORM_OIDC_JWKS_URL:-}" ]; then
    set -- "$@" -c "pg_oidc_validator.discovery_url_override=$PLATFORM_OIDC_JWKS_URL"
  fi
fi
exec docker-entrypoint.sh "$@"
