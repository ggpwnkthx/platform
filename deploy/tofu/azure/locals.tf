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
  # the vault carries a name that nobody else carries, and the
  # operator names it when the default name is taken.
  key_vault_name = var.key_vault_name != "" ? var.key_vault_name : "${local.prefix}-kv"

  # The tags of every resource of the deployment: the cost of a resource
  # is attributed to the deployment that runs it.
  tags = {
    application = "platform"
    component   = var.environment
    managed-by  = "opentofu"
    platform    = var.name_prefix
  }

  # The public names of the deployment.
  #
  # The names are the labels of the services in the zone of the
  # deployment: the zone is the domain of the names, and the label of a
  # service is the name of the service in the zone. The public name of a
  # service is written here and nowhere else.
  gateway_hostname = "${var.gateway_name}.${var.dns_zone_name}"
  access_hostname  = "${var.access_name}.${var.dns_zone_name}"
  console_hostname = "${var.console_name}.${var.dns_zone_name}"

  # The hosts of the deployment. The issuer of Access is the address
  # that both the browsers and the gateway use: the two have to be the
  # same, character for character, or the gateway refuses the tokens it
  # is given.
  access_issuer = "https://${local.access_hostname}"
  gateway_url   = "https://${local.gateway_hostname}"
  console_url   = "https://${local.console_hostname}"

  # The redirect of the gateway: the provider sends the browser back to
  # the address the caller reached the gateway under.
  gateway_redirect_uri = "${local.gateway_url}/auth/callback"

  # The redirect of the console: the console is a client of Access, and
  # it registers the callback with the tenant.
  console_redirect_uri = "${local.console_url}/auth/callback"

  # The issuer of the provider of the identity of the tenant of the
  # deployment.
  #
  # The provider is Entra ID, and the tenant of the deployment is the
  # directory of the identity of its callers. The issuer is the second
  # version of the endpoint of the directory, and not the first: the
  # discovery document of the first version names another issuer, and
  # Access refuses a provider whose document names an issuer that is
  # not the issuer of the tenant.
  entra_issuer = "https://login.microsoftonline.com/${var.tenant_id}/v2.0"

  # The callback of Access at Entra ID: the address Entra ID sends the
  # browser back to, with the code of the login. It is the redirect URI
  # of the application of Access, and the tenant of the deployment
  # registers it as its callback at the provider.
  entra_redirect_uri = "${local.access_issuer}/oauth/tenant/callback"

  # The zone of the names of the deployment.
  #
  # The records of the names are the records of the zone, and the
  # deployment writes them when it owns the zone.
  dns_zone_enabled = var.dns_records_managed

  # The group that holds the zone of the names of the deployment. A
  # zone that the deployment creates lives in the group of the
  # deployment, and a zone that is named by the operator lives in the
  # group the operator names: a zone of Azure outlives a deployment.
  dns_resource_group = var.dns_zone_resource_group_name != "" ? var.dns_zone_resource_group_name : azurerm_resource_group.platform.name

  # The names of the deployment, as the records of the zone name them.
  public_names = {
    api     = local.gateway_hostname
    access  = local.access_hostname
    console = local.console_hostname
  }

  # The name of a record of the zone: the labels of the name of the
  # deployment that the zone does not hold. The name of the gateway is
  # the name of the deployment, and its labels are the ones of the
  # zone.
  dns_record_names = {
    for name, host in local.public_names :
    name => trimsuffix(host, ".${var.dns_zone_name}")
  }

  # The name of the record that proves the ownership of a name: the
  # label of the name in the zone, and the first label of the name when
  # the zone is not named and the operator writes the record.
  dns_verification_names = {
    for name, host in local.public_names :
    name => "asuid.${local.dns_zone_enabled ? local.dns_record_names[name] : split(".", host)[0]}"
  }

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

  # The addresses of the services inside the environment.
  #
  # A service of the environment is reached at the **name of its
  # application**: the name resolves in the internal DNS of the
  # environment, and it reaches the ingress of the service itself.
  #
  # The name of the environment —
  # `<the-service>.<the-environment>.<the-region>.azurecontainerapps.io` —
  # is the **public** name of the service, and a service that is not
  # published has no answer there: the environment answers `404` for a
  # request that arrives at the public name of an application whose
  # ingress is internal, and the answer is a page of the environment and
  # not an answer of the service. The internal name of an application
  # carries `internal` between the name of the application and the name
  # of the environment —
  # `<the-service>.internal.<the-environment>.<the-region>.azurecontainerapps.io` —
  # and the name of the application alone is the shortest of the two.
  gateway_address = local.names.gateway
  access_address  = local.names.access
  console_address = local.names.console
  data_address    = local.names.data

  # The addresses of the state of the deployment.
  #
  # The sessions of the callers and the state that the replicas share
  # live in the same cache: a session that lives in the memory of a
  # replica is unknown to the other replicas, and a limit that lives
  # in the memory of a replica is the limit of that replica and not
  # the limit of the deployment.
  #
  # An Azure Managed Redis holds one database, the database `0`. The
  # service that replaces Azure Cache for Redis does not have the
  # databases of the tiers of the old service: the old Premium tier
  # held several of them, and the new service holds one. The two
  # stores of the deployment are apart by the keys they use, and not
  # by the database they live in.
  redis_session_database      = 0
  redis_shared_state_database = 0

  # The address of the cache, without the credentials. The credentials
  # are the ones of the access key of the cache.
  #
  # The port of the cache is the port of the database of the cache, and
  # the database of an Azure Managed Redis answers on the port 10000:
  # the port of the Redis of the community edition (6379) is not the
  # port of the cache, and an address that names a port the cache does
  # not answer on is an address that times out. The templates take the
  # port the service reports, and the port 10000 when the service
  # reports none.
  redis_host          = azurerm_managed_redis.platform.hostname
  redis_reported_port = azurerm_managed_redis.platform.default_database[0].port
  redis_port          = local.redis_reported_port != 0 ? local.redis_reported_port : 10000
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
#
# A credential of the deployment is a bearer token or a secret, and the
# services count the bytes of a secret the way they read it: a
# hexadecimal secret is counted as half of its characters, a base64
# secret as three quarters of them, and a passphrase as its whole
# length. A credential that is generated as thirty-two bytes in
# hexadecimal is sixty-four characters, and it is counted as thirty-two
# bytes by every one of the three readings. A credential that is
# generated as a passphrase is counted as a part of its length, and a
# passphrase of forty characters is a credential of thirty bytes: a
# deployment that holds one refuses to start.
resource "random_bytes" "gateway_session" {
  length = 32
}

resource "random_bytes" "gateway_access_token" {
  length = 32
}

resource "random_bytes" "gateway_metrics" {
  length = 32
}

resource "random_bytes" "client_secret" {
  length = 32
}

resource "random_bytes" "control_token" {
  length = 32
}

resource "random_bytes" "console_session" {
  length = 32
}

resource "random_bytes" "console_access_context" {
  length = 32
}

resource "random_bytes" "access_admin" {
  length = 32
}

# The credential of the administration of the tenant of the deployment.
#
# The console acts for the operator of the tenant with the credential of
# the tenant, and the audit of Access names the operator of the
# credential: a change of the tenant is signed by the tenant and not by
# the platform.
resource "random_bytes" "access_tenant_admin" {
  length = 32
}

resource "random_bytes" "access_metrics" {
  length = 32
}

resource "random_bytes" "access_context" {
  length = 32
}

resource "random_bytes" "data_metrics" {
  length = 32
}

# The secrets that are counted in the bytes they are read in: a secret
# of thirty-two bytes is sixty-four characters of hexadecimal.
resource "random_bytes" "access_state_secret" {
  length = 32
}

resource "random_bytes" "access_encryption_key" {
  length = 32
}

resource "random_bytes" "data_cursor_key" {
  length = 32
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
  # The address of the administrator of the server.
  #
  # The administrator is the account that creates the roles of the
  # deployment, and a grant of a role belongs to the database the role
  # works in: the role of Access creates the eight tables of its schema
  # in the database of the platform, and the grant that lets it is a
  # grant of the schema `public` of that database. The address of the
  # administrator names the database of the platform and not the
  # maintenance database, or the grant is a grant of another database
  # and the service cannot create its tables.
  postgres_admin_url = "postgres://${azurerm_postgresql_flexible_server.platform.administrator_login}:${random_password.postgres_admin.result}@${local.postgres_host}:${local.postgres_port}/${local.platform_database}?sslmode=require"
  postgres_owner_url = "postgres://data_owner:${random_password.data_owner.result}@${local.postgres_host}:${local.postgres_port}/${local.data_database}?sslmode=require"

  # The addresses of the cache. The credential is the access key of the
  # cache; the README describes the access control list that narrows it
  # to the keys of the platform.
  redis_session_url      = "rediss://:${azurerm_managed_redis.platform.default_database[0].primary_access_key}@${local.redis_host}:${local.redis_port}/${local.redis_session_database}"
  redis_shared_state_url = "rediss://:${azurerm_managed_redis.platform.default_database[0].primary_access_key}@${local.redis_host}:${local.redis_port}/${local.redis_shared_state_database}"
}

# The route table of the deployment.
#
# The table names the host the callers reach the gateway under, and it
# forwards to the address of Data. The upstream is the internal address
# of the service: Data is not published, and the gateway is the only
# one that reaches it.
#
# The internal address of a service is the name of its application: the
# name resolves in the internal DNS of the environment, and it reaches
# the ingress of the service itself. The public name of the application
# is not an address of a service that is not published: the environment
# answers `404` for it.
locals {
  gateway_route_table = {
    version = 2
    # The names of the gateway: the endpoints the gateway serves itself
    # answer on those names, and on no other name.
    hosts = [local.gateway_hostname]
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
      # The API of the platform: the workspace routes, and the only route
      # that carries the identity of a caller.
      {
        id = var.route_id
        match = {
          host = local.gateway_hostname
          path = var.workspace_path_prefix
        }
        upstream = "http://${local.data_address}"
        auth = {
          mode = "any"
          workspace = {
            param       = "workspaceId"
            requireUuid = true
          }
        }
        websocket        = true
        accessCacheTtlMs = 0
      },
      # Access, the issuer of the tokens of the platform. It is reached
      # under the name of the deployment, and the upstream receives the
      # name of the environment and not the name of the caller.
      #
      # The name of the caller is the name of a custom domain of the
      # deployment, and the ingress of the environment answers that name
      # over TLS only: it answers a plain HTTP request with a redirect
      # to the TLS name, and the request that follows it leaves the
      # network of the deployment. The name of the environment is the
      # name of the ingress, and the ingress answers it over the plain
      # HTTP.
      #
      # The issuer of the tokens is not the name of the caller: it is
      # the issuer that Access is configured with, and Access writes it
      # in the discovery document it answers with.
      {
        id = "access-root"
        match = {
          host = local.access_hostname
          path = "/"
        }
        upstream     = "http://${local.access_address}"
        auth         = { mode = "none" }
        upstreamHost = "address"
        # The issuer of the tokens needs the credential of its clients:
        # the console and the gateway authenticate to it.
        forwardAuthorization = true
      },
      {
        id = "access"
        match = {
          host = local.access_hostname
          path = "/{rest}"
        }
        upstream             = "http://${local.access_address}"
        auth                 = { mode = "none" }
        upstreamHost         = "address"
        forwardAuthorization = true
      },
      # The console. It is a client of the three services, and it is
      # reached under the name of the deployment. The upstream receives
      # the name of the environment, for the reason of the routes of
      # Access.
      {
        id = "console-root"
        match = {
          host = local.console_hostname
          path = "/"
        }
        upstream     = "http://${local.console_address}"
        auth         = { mode = "none" }
        upstreamHost = "address"
      },
      {
        id = "console"
        match = {
          host = local.console_hostname
          path = "/{rest}"
        }
        upstream     = "http://${local.console_address}"
        auth         = { mode = "none" }
        upstreamHost = "address"
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
        host                = local.gateway_hostname
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
#
# The scope of a token is one of the three the control plane knows:
# `read`, `operate` and `config`. A scope of `admin` is not one of
# them, and a control plane that is given a map it does not understand
# stops before it listens: the deployment was up, and the control plane
# of it was not.
#
# The scopes are not a chain: a token that may operate may not write
# the route table. This deployment serves its route table from a file of
# the vault and not from the store of the control plane, and the work of
# the operator is to read the state of the deployment and to purge what
# has to be purged: the scope of the token is `operate`, and it holds
# the reads with it.
locals {
  control_tokens = {
    (random_bytes.control_token.hex) = {
      operator = "the-operator-of-the-deployment"
      scope    = "operate"
    }
  }
}

# The map of the credentials of the access context.
#
# The credential of Data is the credential of the platform: it asks
# about one tenant, the one of the deployment.
locals {
  access_context_tokens = {
    (random_bytes.access_context.hex)         = [var.access_tenant_id]
    (random_bytes.console_access_context.hex) = [var.access_tenant_id]
  }
}

# The credentials of the administration of Access.
#
# Access holds the token of the platform, and it holds the credential of
# the tenant of the deployment: the console acts for the operator of the
# tenant with the credential of the tenant, and the audit of Access
# names the operator of the credential that was presented. A credential
# of a tenant is scoped to it, and it refuses every call about another
# tenant.
#
# The operator of the credential is the console of the deployment: the
# people who sign in are named by the rights they are given, and the
# grant that carries the name of the person who gave it is the audit of
# the change.
locals {
  admin_tokens = {
    (random_bytes.access_tenant_admin.hex) = {
      tenant   = var.data_workspace_slug
      operator = "the-console-of-the-deployment"
    }
  }

  # The same credential, as the console reads it: the map of the slug of
  # a tenant and of the credential of the administration of it.
  tenant_admin_tokens = {
    (var.data_workspace_slug) = random_bytes.access_tenant_admin.hex
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
    "access-admin-tokens",
    "access-app-password",
    "access-context-tokens",
    "access-database-url",
    "access-encryption-key",
    "access-metrics-token",
    "access-signing-key",
    "access-state-secret",
    "client-secret",
    "console-access-context-token",
    "console-session-secret",
    "console-tenant-admin-tokens",
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
    "gateway-session-secret"       = random_bytes.gateway_session.hex
    "gateway-access-token"         = random_bytes.gateway_access_token.hex
    "gateway-metrics-token"        = random_bytes.gateway_metrics.hex
    "gateway-identity-signing-key" = base64encode(tls_private_key.identity.private_key_pem)
    "gateway-routes"               = jsonencode(local.gateway_route_table)
    "gateway-control-tokens"       = jsonencode(local.control_tokens)

    # The secrets of Access.
    "access-signing-key"    = tls_private_key.access_signing.private_key_pem
    "access-state-secret"   = random_bytes.access_state_secret.hex
    "access-encryption-key" = random_bytes.access_encryption_key.hex
    "access-admin-token"    = random_bytes.access_admin.hex
    "access-metrics-token"  = random_bytes.access_metrics.hex
    "access-context-tokens" = jsonencode(local.access_context_tokens)
    # The credentials of the administration of Access: the token of the
    # platform is the one of `access-admin-token`, and the credential of
    # the tenant is the one of the map.
    "access-admin-tokens" = jsonencode(local.admin_tokens)

    # The secrets of Data.
    "data-access-context-token"   = random_bytes.access_context.hex
    "data-cursor-key"             = random_bytes.data_cursor_key.hex
    "data-metrics-token"          = random_bytes.data_metrics.hex
    "data-gateway-bindings"       = jsonencode(local.data_gateway_bindings)
    "identity-signing-public-key" = tls_private_key.identity.public_key_pem

    # The secret of the client of the tenant. The gateway and the
    # console are the one client, and they read the one secret.
    "client-secret" = random_bytes.client_secret.hex

    # The secrets of the console.
    "console-session-secret"       = random_bytes.console_session.hex
    "console-access-context-token" = random_bytes.console_access_context.hex
    # The credentials of the administration of the tenant of the
    # deployment: the console acts for the operator of the tenant with
    # the credential of the tenant, and the audit of Access names it.
    "console-tenant-admin-tokens" = jsonencode(local.tenant_admin_tokens)

    # The addresses that carry a password.
    "postgres-admin-url"     = local.postgres_admin_url
    "postgres-owner-url"     = local.postgres_owner_url
    "access-database-url"    = local.access_database_url
    "data-database-url"      = local.data_runtime_url
    "data-registry-url"      = local.data_registry_url
    "redis-access-key"       = azurerm_managed_redis.platform.default_database[0].primary_access_key
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
