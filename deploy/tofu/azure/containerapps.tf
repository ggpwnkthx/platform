# The services of the deployment.
#
# The four services of the platform and the control plane of the
# gateway are five container apps. They are the same services, with the
# same ports and the same names of the environment, as the ones of the
# Compose stack and of the Kubernetes bases: a deployment runs the same
# platform wherever it runs it.
#
# The three services that the callers reach answer on the internet, and
# the two that they do not reach keep their ingress to themselves. The
# data of the deployment is reachable from the gateway and from nobody
# else.

# The secrets that a service reads from a file.
#
# A service that reads a secret from a file reads it from the file that
# the init container of the service writes. The init container gets the
# secret from the vault of the deployment and writes it to the volume
# of the revision; the service reads the file and never sees the
# environment that carried the secret.
locals {
  access_secret_files = [
    "access-signing-key",
    "access-state-secret",
    "access-encryption-key",
    "access-admin-token",
    "access-metrics-token",
    "access-context-tokens",
  ]

  data_secret_files = [
    "data-access-context-token",
    "data-cursor-key",
    "data-metrics-token",
    "identity-signing-public-key",
    "data-gateway-bindings",
  ]

  gateway_secret_files = [
    "gateway-routes",
  ]

  control_secret_files = [
    "gateway-control-tokens",
  ]

  # The name of the environment variable that carries a secret into the
  # init container that writes it.
  secret_env = { for name in local.secret_names : name => "SECRET_${upper(replace(name, "-", "_"))}" }

  # The command of an init container that writes a set of secrets as the
  # files that a service reads them from.
  write_secrets = tomap({
    for key, names in {
      access  = local.access_secret_files
      data    = local.data_secret_files
      gateway = local.gateway_secret_files
      control = local.control_secret_files
      } : key => join("\n", [
        for name in names :
        "printf '%s' \"$${SECRET_${upper(replace(name, "-", "_"))}}\" > /run/secrets/${name}"
    ])
  })
}

# The gateway: the only service the callers reach.
resource "azurerm_container_app" "gateway" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.gateway
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    exposed_port     = 8080
    # The gateway speaks the websocket of the upstream it forwards to,
    # and the transport is the one that carries it.
    transport = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.services.gateway.min_replicas
    max_replicas = var.services.gateway.max_replicas

    # The gateway drains before it stops: it keeps serving for the
    # length of its shutdown timeout, and the revision is given longer
    # than that before it is killed.
    termination_grace_period_seconds = 45

    container {
      name   = "gateway"
      image  = var.gateway_image
      cpu    = var.services.gateway.cpu
      memory = var.services.gateway.memory

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GATEWAY_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "GATEWAY_PORT"
        value = "8080"
      }
      env {
        name  = "GATEWAY_CONFIG"
        value = "/run/secrets/gateway-routes"
      }
      env {
        name  = "GATEWAY_CONFIG_SOURCE"
        value = "file"
      }
      env {
        name  = "GATEWAY_OIDC_ISSUER"
        value = local.access_issuer
      }
      env {
        name  = "GATEWAY_OIDC_CLIENT_ID"
        value = var.gateway_client_id
      }
      env {
        name  = "GATEWAY_OIDC_CLIENT_SECRET"
        value = random_password.gateway_client_secret.result
      }
      env {
        name  = "GATEWAY_OIDC_REDIRECT_URI"
        value = local.gateway_redirect_uri
      }
      env {
        name  = "GATEWAY_ACCESS_URL"
        value = local.access_issuer
      }
      env {
        name  = "GATEWAY_ACCESS_TOKEN"
        value = random_password.gateway_access_token.result
      }
      env {
        name  = "GATEWAY_SESSION_SECRET"
        value = random_password.gateway_session.result
      }
      env {
        # The key that signs the identity of a request is a PEM, and a
        # PEM carries newlines: it travels in its base64 form and the
        # gateway reads it back.
        name  = "GATEWAY_IDENTITY_SIGNING_KEY_BASE64"
        value = base64encode(tls_private_key.identity.private_key_pem)
      }
      env {
        name  = "GATEWAY_SESSION_URL"
        value = local.redis_session_url
      }
      env {
        name  = "GATEWAY_SHARED_STATE_URL"
        value = local.redis_shared_state_url
      }
      env {
        name  = "GATEWAY_METRICS_TOKEN"
        value = random_password.gateway_metrics.result
      }
      env {
        name  = "GATEWAY_RATE_LIMIT_TOTAL_MAX"
        value = "1000"
      }
      env {
        name  = "GATEWAY_EXTERNAL_PROTO"
        value = "https"
      }
      env {
        name  = "GATEWAY_COOKIE_SECURE"
        value = "true"
      }
      # The deployment is behind an ingress. The ranges of the peers the
      # gateway trusts are named in the route table; the hop is the one
      # of the ingress of the deployment.
      env {
        name  = "GATEWAY_TRUSTED_PROXIES"
        value = join(",", var.trusted_proxy_cidrs)
      }
      env {
        name  = "GATEWAY_TRUSTED_PROXY_HOPS"
        value = "1"
      }
      env {
        name  = "GATEWAY_LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "GATEWAY_SHUTDOWN_TIMEOUT_MS"
        value = "15000"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/healthz"

        initial_delay           = 15
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/readyz"

        initial_delay           = 5
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    # The route table is a file, and the file is written out of the
    # vault of the deployment before the service starts.
    init_container {
      name   = "secrets"
      image  = var.gateway_image
      cpu    = 0.25
      memory = "0.25Gi"

      command = ["sh", "-c", local.write_secrets["gateway"]]

      dynamic "env" {
        for_each = local.gateway_secret_files
        content {
          name        = local.secret_env[env.value]
          secret_name = env.value
        }
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    volume {
      name = "secrets"
    }
  }

  dynamic "secret" {
    for_each = local.gateway_secret_files
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
    }
  }
}

# The control plane of the gateway: the administrative surface of the
# deployment. It is never published: the operator reaches it with a port
# forward from inside the network of the deployment.
resource "azurerm_container_app" "control" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.control
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    external_enabled = false
    target_port      = 9090
    exposed_port     = 9090
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 2

    termination_grace_period_seconds = 45

    container {
      name   = "control"
      image  = var.gateway_image
      cpu    = var.services.gateway.cpu
      memory = var.services.gateway.memory

      command = ["bun", "run", "src/control-main.ts"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GATEWAY_CONTROL_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "GATEWAY_CONTROL_PORT"
        value = "9090"
      }
      env {
        name  = "GATEWAY_CONTROL_TOKENS_FILE"
        value = "/run/secrets/gateway-control-tokens"
      }
      env {
        name  = "GATEWAY_CONTROL_STATE_URL"
        value = local.redis_shared_state_url
      }
      env {
        name  = "GATEWAY_CONTROL_KEY_PREFIX"
        value = "gateway"
      }
      env {
        name  = "GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX"
        value = "gateway"
      }
      env {
        name  = "GATEWAY_LOG_LEVEL"
        value = "info"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 9090
        path      = "/healthz"

        initial_delay           = 15
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 9090
        path      = "/readyz"

        initial_delay           = 5
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    init_container {
      name   = "secrets"
      image  = var.gateway_image
      cpu    = 0.25
      memory = "0.25Gi"

      command = ["sh", "-c", local.write_secrets["control"]]

      dynamic "env" {
        for_each = local.control_secret_files
        content {
          name        = local.secret_env[env.value]
          secret_name = env.value
        }
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    volume {
      name = "secrets"
    }
  }

  dynamic "secret" {
    for_each = local.control_secret_files
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
    }
  }
}

# Access: the broker of the identity and the service that decides.
resource "azurerm_container_app" "access" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.access
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    external_enabled = true
    target_port      = 8081
    exposed_port     = 8081
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.services.access.min_replicas
    max_replicas = var.services.access.max_replicas

    termination_grace_period_seconds = 45

    container {
      name   = "access"
      image  = var.access_image
      cpu    = var.services.access.cpu
      memory = var.services.access.memory

      env {
        name  = "ACCESS_ENVIRONMENT"
        value = "production"
      }
      env {
        name  = "ACCESS_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "ACCESS_PORT"
        value = "8081"
      }
      env {
        # The issuer is the address that the browsers and the gateway
        # use: the two have to be the same, character for character.
        name  = "ACCESS_ISSUER"
        value = local.access_issuer
      }
      env {
        name  = "ACCESS_DATABASE_URL"
        value = local.access_database_url
      }
      env {
        name  = "ACCESS_REDIS_URL"
        value = local.redis_session_url
      }
      env {
        name  = "ACCESS_SIGNING_KID"
        value = local.access_signing_kid
      }
      env {
        name  = "ACCESS_LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "ACCESS_SIGNING_KEY_FILE"
        value = "/run/secrets/access-signing-key"
      }
      env {
        name  = "ACCESS_STATE_SECRET_FILE"
        value = "/run/secrets/access-state-secret"
      }
      env {
        name  = "ACCESS_SECRET_ENCRYPTION_KEY_FILE"
        value = "/run/secrets/access-encryption-key"
      }
      env {
        name  = "ACCESS_ADMIN_TOKEN_FILE"
        value = "/run/secrets/access-admin-token"
      }
      env {
        name  = "ACCESS_METRICS_TOKEN_FILE"
        value = "/run/secrets/access-metrics-token"
      }
      env {
        name  = "ACCESS_CONTEXT_TOKENS_FILE"
        value = "/run/secrets/access-context-tokens"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8081
        path      = "/healthz"

        initial_delay           = 15
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8081
        path      = "/readyz"

        initial_delay           = 5
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    init_container {
      name   = "secrets"
      image  = var.access_image
      cpu    = 0.25
      memory = "0.25Gi"

      command = ["sh", "-c", local.write_secrets["access"]]

      dynamic "env" {
        for_each = local.access_secret_files
        content {
          name        = local.secret_env[env.value]
          secret_name = env.value
        }
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    volume {
      name = "secrets"
    }
  }

  dynamic "secret" {
    for_each = local.access_secret_files
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
    }
  }
}

# Data: the headless, permission aware data api. It is not published:
# the gateway is the only one that reaches it.
resource "azurerm_container_app" "data" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.data
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    external_enabled = false
    target_port      = 8082
    exposed_port     = 8082
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.services.data.min_replicas
    max_replicas = var.services.data.max_replicas

    termination_grace_period_seconds = 45

    container {
      name   = "data"
      image  = var.data_image
      cpu    = var.services.data.cpu
      memory = var.services.data.memory

      env {
        name  = "DATA_ENVIRONMENT"
        value = "production"
      }
      env {
        name  = "DATA_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "DATA_PORT"
        value = "8082"
      }
      env {
        name  = "DATA_PROCESS_ROLE"
        value = "api"
      }
      env {
        name  = "DATA_DATABASE_URL"
        value = local.data_runtime_url
      }
      env {
        name  = "DATA_REGISTRY_DATABASE_URL"
        value = local.data_registry_url
      }
      env {
        name  = "DATA_ACCESS_URL"
        value = local.access_issuer
      }
      env {
        name  = "DATA_GATEWAY_BINDINGS_FILE"
        value = "/run/secrets/data-gateway-bindings"
      }
      env {
        name  = "DATA_SCHEMA_BUNDLE_FILE"
        value = "/app/packages/data/manifests/schema.json"
      }
      env {
        name  = "DATA_POLICY_BUNDLE_FILE"
        value = "/app/packages/data/manifests/policies.json"
      }
      env {
        name  = "DATA_ACCESS_CONTEXT_TOKEN_FILE"
        value = "/run/secrets/data-access-context-token"
      }
      env {
        name  = "DATA_CURSOR_KEY_FILE"
        value = "/run/secrets/data-cursor-key"
      }
      env {
        name  = "DATA_METRICS_TOKEN_FILE"
        value = "/run/secrets/data-metrics-token"
      }
      env {
        name  = "DATA_LOG_LEVEL"
        value = "info"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8082
        path      = "/healthz"

        initial_delay           = 20
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8082
        path      = "/readyz"

        initial_delay           = 10
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    init_container {
      name   = "secrets"
      image  = var.data_image
      cpu    = 0.25
      memory = "0.25Gi"

      command = ["sh", "-c", local.write_secrets["data"]]

      dynamic "env" {
        for_each = local.data_secret_files
        content {
          name        = local.secret_env[env.value]
          secret_name = env.value
        }
      }

      volume_mounts {
        name = "secrets"
        path = "/run/secrets"
      }
    }

    volume {
      name = "secrets"
    }
  }

  dynamic "secret" {
    for_each = local.data_secret_files
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
    }
  }
}

# The console: the web interface of the platform. It is a client of the
# three services, and it decides nothing itself.
resource "azurerm_container_app" "console" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.console
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    external_enabled = true
    target_port      = 8083
    exposed_port     = 8083
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.services.console.min_replicas
    max_replicas = var.services.console.max_replicas

    termination_grace_period_seconds = 45

    container {
      name   = "console"
      image  = var.console_image
      cpu    = var.services.console.cpu
      memory = var.services.console.memory

      env {
        name  = "CONSOLE_ENVIRONMENT"
        value = "production"
      }
      env {
        name  = "CONSOLE_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "CONSOLE_PORT"
        value = "8083"
      }
      env {
        name  = "CONSOLE_PUBLIC_URL"
        value = local.console_url
      }
      env {
        name  = "CONSOLE_ACCESS_URL"
        value = local.access_issuer
      }
      env {
        name  = "CONSOLE_GATEWAY_URL"
        value = local.gateway_url
      }
      env {
        name  = "CONSOLE_CLIENT_ID"
        value = var.console_client_id
      }
      env {
        name  = "CONSOLE_CLIENT_SECRET"
        value = random_password.console_client_secret.result
      }
      env {
        name  = "CONSOLE_SESSION_SECRET"
        value = random_password.console_session.result
      }
      env {
        name  = "CONSOLE_ACCESS_CONTEXT_TOKEN"
        value = random_password.console_access_context.result
      }
      env {
        name  = "CONSOLE_ROUTE_ID"
        value = "console"
      }
      env {
        name  = "CONSOLE_LOG_LEVEL"
        value = "info"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8083
        path      = "/healthz"

        initial_delay           = 15
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8083
        path      = "/readyz"

        initial_delay           = 5
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }
    }
  }
}

# The migration of the deployment.
#
# The migration is an operator command, and not a resource of the
# deployment: it is applied once per deployment, with the credentials
# of the administrator of the server and of the owner of the schema.
# The job is started by hand, and it is the only job of the deployment.
resource "azurerm_container_app_job" "migrate" {
  name                         = "${local.prefix}-migrate"
  resource_group_name          = azurerm_resource_group.platform.name
  location                     = azurerm_resource_group.platform.location
  container_app_environment_id = azurerm_container_app_environment.platform.id

  # A migration that waits for nothing hangs: the job gives up and the
  # operator starts it again.
  replica_timeout_in_seconds = 1800

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  # The job waits for the hand of the operator.
  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    init_container {
      name   = "roles"
      image  = var.postgres_client_image
      cpu    = 0.25
      memory = "0.25Gi"

      # The role of Access owns the tables of Access, and it cannot do
      # the work of the administrator of the server. The role is created
      # once, before the first start of Access.
      command = [
        "sh", "-c",
        "psql \"$${DATA_ADMIN_DATABASE_URL}\" -v ON_ERROR_STOP=1 -c \"create role access_app login password '$${ACCESS_APP_PASSWORD}'\" -c 'grant usage, create on schema public to access_app'",
      ]

      env {
        name        = "DATA_ADMIN_DATABASE_URL"
        secret_name = "postgres-admin-url"
      }
      env {
        name        = "ACCESS_APP_PASSWORD"
        secret_name = "access-app-password"
      }
    }

    container {
      name   = "migrate"
      image  = var.data_image
      cpu    = 0.5
      memory = "1Gi"

      command = ["sh", "-c", "bun run scripts/cli/provision.ts && bun run scripts/cli/migrate.ts"]

      env {
        name  = "DATA_ENVIRONMENT"
        value = "production"
      }
      env {
        name  = "DATA_DATABASE_NAME"
        value = local.data_database
      }
      env {
        name        = "DATA_ADMIN_DATABASE_URL"
        secret_name = "postgres-admin-url"
      }
      env {
        name        = "DATA_OWNER_DATABASE_URL"
        secret_name = "postgres-owner-url"
      }
      env {
        name        = "DATA_OWNER_PASSWORD"
        secret_name = "data-owner-password"
      }
      env {
        name        = "DATA_RUNTIME_PASSWORD"
        secret_name = "data-runtime-password"
      }
      env {
        name        = "DATA_REGISTRY_PASSWORD"
        secret_name = "data-registry-password"
      }
      env {
        name        = "DATA_DELIVERY_PASSWORD"
        secret_name = "data-delivery-password"
      }
      env {
        name        = "DATA_MAINTENANCE_PASSWORD"
        secret_name = "data-maintenance-password"
      }
    }
  }

  dynamic "secret" {
    for_each = toset([
      "postgres-admin-url",
      "postgres-owner-url",
      "access-app-password",
      "data-owner-password",
      "data-runtime-password",
      "data-registry-password",
      "data-delivery-password",
      "data-maintenance-password",
    ])
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
    }
  }
}
