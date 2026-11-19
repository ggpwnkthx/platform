#!/bin/sh
# Writes the client authentication rules, then hands over to the image's own entrypoint.
#
#   PLATFORM_OIDC_ISSUER   Required. The one issuer whose tokens are accepted: your Dex.
#   PLATFORM_OIDC_CLAIM    Token claim that must equal the PostgreSQL role name. Default: email.
#   PLATFORM_OIDC_JWKS_URL Optional. Where this server fetches the issuer's discovery document
#                          when the issuer's own URL is not reachable from here.
#   PLATFORM_ADMIN         Optional. The person who installs and administers this server, as the
#                          claim names them: admin@example.com. A new cluster is given that role,
#                          a superuser with no password, who signs in with a token like anyone
#                          else. Without it the only administrator is this container's own socket.
#   PLATFORM_HBA_HOST      host (default) or hostssl. Use hostssl wherever TLS is configured.
#   PLATFORM_TOKEN_ONLY_FROM
#                          Optional. Comma-separated CIDR blocks, such as the network of the
#                          WebSocket relay the interface reaches PostgreSQL through. From them
#                          PLATFORM_ADMIN does not log in at all: a token that names the
#                          administrator is not a way in through the interface.
#
# No login has a password. POSTGRES_PASSWORD is refused, not ignored.
set -eu

issuer=${PLATFORM_OIDC_ISSUER:?PLATFORM_OIDC_ISSUER must name the OpenID Connect issuer}
claim=${PLATFORM_OIDC_CLAIM:-email}
host=${PLATFORM_HBA_HOST:-host}
superuser=${POSTGRES_USER:-postgres}
admin=${PLATFORM_ADMIN:-}

if [ -n "${POSTGRES_PASSWORD:-}${POSTGRES_PASSWORD_FILE:-}" ]; then
  echo "POSTGRES_PASSWORD is not used here: no login has a password. Name the administrator in PLATFORM_ADMIN; they sign in with a token." >&2
  exit 1
fi
case $issuer in http://*|https://*) ;; *) echo "PLATFORM_OIDC_ISSUER must be an http(s) URL" >&2; exit 1 ;; esac
for value in "$issuer" "$claim" "$superuser" "$admin" "${PLATFORM_OIDC_JWKS_URL:-}"; do
  case $value in *[[:space:]\"\'\\,]*) echo "Unsupported character in: $value" >&2; exit 1 ;; esac
done
case $host in host|hostssl) ;; *) echo "PLATFORM_HBA_HOST must be host or hostssl" >&2; exit 1 ;; esac
token_only=''
for block in $(printf '%s' "${PLATFORM_TOKEN_ONLY_FROM:-}" | tr ',' ' '); do
  case $block in
    *[!0-9a-fA-F.:/]*|'') echo "PLATFORM_TOKEN_ONLY_FROM must list CIDR blocks: $block" >&2; exit 1 ;;
  esac
  if [ -n "$admin" ]; then
    token_only="$token_only$host   all  \"$admin\"      $block  reject
"
  fi
done

# The socket inside the container is the image's own administrative path, as upstream ships it:
# it makes the cluster, answers the health check, and is the way in when the issuer is not.
# Over the network a token from the issuer is the only way in, and the validator names the role
# it belongs to. The server's own superuser is not a role a token may name: it has no login
# over the network at all. From the relay's networks neither has the administrator: the first
# matching rule decides, so those rules come before the one that lets everyone in.
# Dex puts no scope claim in its tokens, so there is none to require.
cat > /etc/platform/pg_hba.conf <<HBA
local   all  all                trust
$host   all  "$superuser"      all  reject
$token_only$host   all  all           all  oauth issuer="$issuer" scope=""
HBA

# The image's own entrypoint makes no cluster without a password for its superuser. It is given
# one that nobody keeps, and the rules it writes into the data directory refuse the network;
# the cluster's first script (init.sh) then takes that password away again.
POSTGRES_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
POSTGRES_HOST_AUTH_METHOD=reject
export POSTGRES_PASSWORD POSTGRES_HOST_AUTH_METHOD

if [ "${1:-}" = postgres ]; then
  # What the revisions do not record is written to the server's log: who connected and as whom,
  # and every statement that changes a role, a grant, a policy or a table. These come before the
  # caller's own settings, so a deployment that logs otherwise says so and is obeyed.
  shift
  set -- postgres -c log_connections=on -c log_statement=ddl "$@"
  set -- "$@" \
    -c hba_file=/etc/platform/pg_hba.conf \
    -c oauth_validator_libraries=pg_oidc_validator \
    -c "pg_oidc_validator.authn_field=$claim"
  if [ -n "${PLATFORM_OIDC_JWKS_URL:-}" ]; then
    set -- "$@" -c "pg_oidc_validator.discovery_url_override=$PLATFORM_OIDC_JWKS_URL"
  fi
fi
exec docker-entrypoint.sh "$@"
