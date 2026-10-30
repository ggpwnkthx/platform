# The names, the secrets and the documents of the deployment.
#
# Everything that is written twice is written once here: the name of a
# resource, the address of a service, the credentials of a role and the
# documents that the services read. A name that is written twice is a
# name that drifts, and a deployment that assembles its own names is a
# deployment that assembles them differently every time.

locals {
  # The name of the resource group of the deployment.
  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "${var.name_prefix}-${var.environment}"

  # The prefix of every name of the deployment.
  prefix = "${var.name_prefix}-${var.environment}"

  # The names of the resources that are unique in the whole of Azure:
  # the vault and the registry carry a name that nobody else carries,
  # and the operator names them when the default name is taken.
  key_vault_name = var.key_vault_name != "" ? var.key_vault_name : "${local.prefix}-kv"
  registry_name  = var.registry_name != "" ? var.registry_name : replace("${local.prefix}registry", "-", "")

  # The tags of every resource of the deployment: the cost of a resource
  # is attributed to the deployment that runs it.
  tags = {
    application = "platform"
    component   = var.environment
    managed-by  = "opentofu"
    platform    = var.name_prefix
  }

  # The hosts of the deployment. The issuer of Access is the address
  # that both the browsers and the gateway use: the two have to be the
  # same, character for character, or the gateway refuses the tokens it
  # is given.
  access_issuer = "https://${var.access_hostname}"
  gateway_url   = "https://${var.gateway_hostname}"
  console_url   = "https://${var.console_hostname}"

  # The redirect of the gateway: the provider sends the browser back to
  # the address the caller reached the gateway under.
  gateway_redirect_uri = "${local.gateway_url}/auth/callback"

  # The redirect of the console: the console is a client of Access, and
  # it registers the callback with the tenant.
  console_redirect_uri = "${local.console_url}/auth/callback"

  # The identifier of the key that signs the identity of a request.
  access_signing_kid = "${var.name_prefix}-access-1"

  # The databases of the deployment. Access keeps its eight tables in
  # the database of the platform, and Data keeps its business data in
  # its own.
  platform_database = "platform"
  data_database     = "data"

  # The addresses of the services, as the environment of the container
  # apps names them. The edge reaches the services under these names,
  # and the gateway reaches Data under the name of Data.
  names = {
    gateway = "${local.prefix}-gateway"
    access  = "${local.prefix}-access"
    data    = "${local.prefix}-data"
    console = "${local.prefix}-console"
    control = "${local.prefix}-control"
  }

  gateway_fqdn = "${local.names.gateway}.${azurerm_container_app_environment.platform.default_domain}"
  access_fqdn  = "${local.names.access}.${azurerm_container_app_environment.platform.default_domain}"
  console_fqdn = "${local.names.console}.${azurerm_container_app_environment.platform.default_domain}"
  data_fqdn    = "${local.names.data}.${azurerm_container_app_environment.platform.default_domain}"

  # The addresses of the state of the deployment.
  #
  # The sessions of the callers and the state that the replicas share
  # live in two databases of the same cache: a session that lives in the
  # memory of a replica is unknown to the other replicas, and a limit
  # that lives in the memory of a replica is the limit of that replica
  # and not the limit of the deployment.
  redis_session_database      = 0
  redis_shared_state_database = 1

  # The address of the cache, without the credentials. The credentials
  # are the ones of the access key of the cache.
  redis_host = azurerm_redis_cache.platform.hostname
  redis_port = azurerm_redis_cache.platform.port
}

# The secrets of the deployment.
#
# Every secret is generated here, and every one of them is written into
# the vault of the deployment. A secret that a deployment has to be
# given before it starts is a secret that a deployment forgets, and a
# secret that is forgotten is a deployment that does not start.
#
# The key that signs the identity of a request is the same pair of keys
# that `bun run --cwd packages/gateway identity:key` writes: an elliptic
# curve key on the curve P-256, in the format of PKCS#8 and of SPKI.
resource "tls_private_key" "identity" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

# The key that signs the tokens of Access. Access signs with an RSA
# key, and a key that a process generates at its start invalidates every
# token that is alive.
resource "tls_private_key" "access_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

# The credentials of the deployment.
resource "random_password" "gateway_session" {
  length  = 48
  special = false
}

resource "random_password" "gateway_access_token" {
  length  = 40
  special = false
}

resource "random_password" "gateway_metrics" {
  length  = 40
  special = false
}

resource "random_password" "gateway_client_secret" {
  length  = 24
  special = false
}

resource "random_password" "console_client_secret" {
  length  = 24
  special = false
}

resource "random_password" "console_session" {
  length  = 48
  special = false
}

resource "random_password" "console_access_context" {
  length  = 40
  special = false
}

resource "random_password" "access_admin" {
  length  = 24
  special = false
}

resource "random_password" "access_metrics" {
  length  = 32
  special = false
}

resource "random_password" "access_context" {
  length  = 40
  special = false
}

resource "random_password" "data_metrics" {
  length  = 32
  special = false
}

# The secrets that are counted in the bytes they are read in: a secret
# of thirty-two bytes is forty-four characters of base64.
resource "random_password" "access_state_secret" {
  length  = 44
  special = false
}

resource "random_password" "access_encryption_key" {
  length  = 44
  special = false
}

resource "random_password" "data_cursor_key" {
  length  = 44
  special = false
}

# The passwords of the roles of the deployment. They carry no character
# that has to be escaped in an address: the services read the address of
# their database, and the address carries the password.
resource "random_password" "postgres_admin" {
  length  = 32
  special = false
}

resource "random_password" "postgres_access_app" {
  length  = 32
  special = false
}

resource "random_password" "data_owner" {
  length  = 32
  special = false
}

resource "random_password" "data_runtime" {
  length  = 32
  special = false
}

resource "random_password" "data_registry" {
  length  = 32
  special = false
}

resource "random_password" "data_delivery" {
  length  = 32
  special = false
}

resource "random_password" "data_maintenance" {
  length  = 32
  special = false
}

locals {
  # The addresses of the databases of the deployment.
  #
  # The transport is protected: a production deployment refuses to
  # start with an address that does not ask for it.
  postgres_host = azurerm_postgresql_flexible_server.platform.fqdn
  postgres_port = 5432

  access_database_url = "postgres://access_app:${random_password.postgres_access_app.result}@${local.postgres_host}:${local.postgres_port}/${local.platform_database}?sslmode=require"
  data_runtime_url    = "postgres://data_runtime:${random_password.data_runtime.result}@${local.postgres_host}:${local.postgres_port}/${local.data_database}?sslmode=require"
  data_registry_url   = "postgres://data_registry:${random_password.data_registry.result}@${local.postgres_host}:${local.postgres_port}/${local.data_database}?sslmode=require"
  postgres_admin_url  = "postgres://${azurerm_postgresql_flexible_server.platform.administrator_login}:${random_password.postgres_admin.result}@${local.postgres_host}:${local.postgres_port}/postgres?sslmode=require"
  postgres_owner_url  = "postgres://data_owner:${random_password.data_owner.result}@${local.postgres_host}:${local.postgres_port}/${local.data_database}?sslmode=require"

  # The addresses of the cache. The credential is the access key of the
  # cache; the README describes the access control list that narrows it
  # to the keys of the platform.
  redis_session_url      = "redis://:${azurerm_redis_cache.platform.primary_access_key}@${local.redis_host}:${local.redis_port}/${local.redis_session_database}"
  redis_shared_state_url = "redis://:${azurerm_redis_cache.platform.primary_access_key}@${local.redis_host}:${local.redis_port}/${local.redis_shared_state_database}"
}

# The route table of the deployment.
#
# The table names the host the callers reach the gateway under, and it
# forwards to the address of Data. The upstream is the internal address
# of the service: Data is not published, and the gateway is the only
# one that reaches it.
locals {
  gateway_route_table = {
    version = 1
    defaults = {
      auth = { mode = "none" }
      timeouts = {
        responseMs  = 5000
        firstByteMs = 30000
        bodyMs      = 300000
      }
      maxBodyBytes = 10485760
    }
    trustedProxies = var.trusted_proxy_cidrs
    routes = [
      {
        id = var.route_id
        match = {
          host = var.gateway_hostname
          path = var.workspace_path_prefix
        }
        upstream = "http://${local.data_fqdn}:8082"
        auth = {
          mode = "any"
          workspace = {
            param       = "workspaceId"
            requireUuid = true
          }
        }
        websocket        = true
        accessCacheTtlMs = 0
      }
    ]
  }
}

# The bindings of Data.
#
# The bindings are the contract between the gateway and Data: they name
# the route, the host and the key that verifies the identity of a
# request. The public key of the identity is the half of the pair that
# the gateway does not hold.
locals {
  data_gateway_bindings = {
    version = 2
    bindings = [
      {
        id                  = var.route_id
        host                = var.gateway_hostname
        upstreamPathPattern = "${var.workspace_path_prefix}v1/*"
        routeId             = var.route_id
        identity = {
          version   = "v5"
          algorithm = "ES256"
          # The file is written by the init container of the service,
          # out of the vault of the deployment.
          publicKeyFile = "/run/secrets/identity-signing.public.pem"
        }
      }
    ]
  }
}

# The map of the tokens of the control plane.
#
# The map is a secret: the token of the example of the repository is
# published, and a deployment that starts with it has an administrative
# surface that everybody holds.
locals {
  control_tokens = {
    (random_password.gateway_client_secret.result) = {
      operator = "the-operator-of-the-deployment"
      scope    = "admin"
    }
  }
}

# The map of the credentials of the access context.
#
# The credential of Data is the credential of the platform: it asks
# about one tenant, the one of the deployment.
locals {
  access_context_tokens = {
    (random_password.access_context.result) = [var.access_tenant_id]
  }
}

# The secrets of the deployment.
#
# The names of the secrets are the names of the files that the services
# read them from: a name of the vault and a name of a file are one
# name, and the name of a secret is the name of the file that the
# init container of the service writes.
locals {
  secret_names = toset([
    "access-admin-token",
    "access-app-password",
    "access-context-tokens",
    "access-database-url",
    "access-encryption-key",
    "access-metrics-token",
    "access-signing-key",
    "access-state-secret",
    "console-access-context-token",
    "console-client-secret",
    "console-session-secret",
    "data-access-context-token",
    "data-cursor-key",
    "data-database-url",
    "data-delivery-password",
    "data-gateway-bindings",
    "data-maintenance-password",
    "data-metrics-token",
    "data-owner-password",
    "data-registry-password",
    "data-registry-url",
    "data-runtime-password",
    "gateway-access-token",
    "gateway-client-secret",
    "gateway-control-tokens",
    "gateway-identity-signing-key",
    "gateway-metrics-token",
    "gateway-routes",
    "gateway-session-secret",
    "identity-signing-public-key",
    "postgres-admin-url",
    "postgres-owner-url",
    "redis-access-key",
    "redis-session-url",
    "redis-shared-state-url",
  ])

  secret_values = {
    # The secrets of the gateway.
    "gateway-session-secret"       = random_password.gateway_session.result
    "gateway-access-token"         = random_password.gateway_access_token.result
    "gateway-metrics-token"        = random_password.gateway_metrics.result
    "gateway-client-secret"        = random_password.gateway_client_secret.result
    "gateway-identity-signing-key" = base64encode(tls_private_key.identity.private_key_pem)
    "gateway-routes"               = jsonencode(local.gateway_route_table)
    "gateway-control-tokens"       = jsonencode(local.control_tokens)

    # The secrets of Access.
    "access-signing-key"    = tls_private_key.access_signing.private_key_pem
    "access-state-secret"   = random_password.access_state_secret.result
    "access-encryption-key" = random_password.access_encryption_key.result
    "access-admin-token"    = random_password.access_admin.result
    "access-metrics-token"  = random_password.access_metrics.result
    "access-context-tokens" = jsonencode(local.access_context_tokens)

    # The secrets of Data.
    "data-access-context-token"   = random_password.access_context.result
    "data-cursor-key"             = random_password.data_cursor_key.result
    "data-metrics-token"          = random_password.data_metrics.result
    "data-gateway-bindings"       = jsonencode(local.data_gateway_bindings)
    "identity-signing-public-key" = tls_private_key.identity.public_key_pem

    # The secrets of the console.
    "console-client-secret"        = random_password.console_client_secret.result
    "console-session-secret"       = random_password.console_session.result
    "console-access-context-token" = random_password.console_access_context.result

    # The addresses that carry a password.
    "postgres-admin-url"     = local.postgres_admin_url
    "postgres-owner-url"     = local.postgres_owner_url
    "access-database-url"    = local.access_database_url
    "data-database-url"      = local.data_runtime_url
    "data-registry-url"      = local.data_registry_url
    "redis-access-key"       = azurerm_redis_cache.platform.primary_access_key
    "redis-session-url"      = local.redis_session_url
    "redis-shared-state-url" = local.redis_shared_state_url

    # The passwords of the roles of the deployment. They are the
    # credentials of the operator commands that create the roles.
    "access-app-password"       = random_password.postgres_access_app.result
    "data-owner-password"       = random_password.data_owner.result
    "data-runtime-password"     = random_password.data_runtime.result
    "data-registry-password"    = random_password.data_registry.result
    "data-delivery-password"    = random_password.data_delivery.result
    "data-maintenance-password" = random_password.data_maintenance.result
  }
}
