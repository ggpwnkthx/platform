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
#
# Every application keeps more than one revision: a revision that is
# broken is replaced by another one while the first one still answers,
# and a deployment that is rolled does not stop answering while it is
# rolled. The revision that is written is the one that answers, and the
# revision before it is left behind until the deployment says it is
# not needed.

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

  # The name of the file that a secret is written to.
  #
  # A file is named after the secret that fills it, and the name of a
  # secret of a vault is a name of dashes: a file of the platform may
  # be named with dots, and the file of the public key of the identity
  # is one of them. The name of the file is the name that every other
  # deployment gives it — the Compose stack mounts the secret under it,
  # and the bindings of Data name it.
  secret_file_names = {
    "identity-signing-public-key" = "identity-signing.public.pem"
  }

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
        "printf '%s' \"$${SECRET_${upper(replace(name, "-", "_"))}}\" > /run/secrets/${lookup(local.secret_file_names, name, name)}"
    ])
  })

  # The secrets that a service reads from its environment.
  #
  # A secret that a service reads from a file is written to the file by
  # the init container of the service. A secret that a service reads
  # from its environment is bound to the variable by the application
  # itself: the value of the secret lives in the vault of the
  # deployment, and the application resolves the reference when the
  # revision starts. The configuration of the application holds the
  # name of the secret and never its value.
  #
  # The names of the variables are the names the services read, and the
  # values are the names of the secrets of the vault.
  #
  # The key that signs the identity of a request is a PEM, and a PEM
  # carries newlines: the secret of the vault holds it in its base64
  # form, and the gateway reads it back. The token of the decisions is
  # the token of the gateway: the gateway presents it on
  # `POST /v1/decisions`, and Access accepts it as the shared
  # credential of the deployment, so the two read the same secret.
  gateway_env_secrets = {
    GATEWAY_OIDC_CLIENT_SECRET          = "client-secret"
    GATEWAY_ACCESS_TOKEN                = "gateway-access-token"
    GATEWAY_SESSION_SECRET              = "gateway-session-secret"
    GATEWAY_IDENTITY_SIGNING_KEY_BASE64 = "gateway-identity-signing-key"
    GATEWAY_SESSION_URL                 = "redis-session-url"
    GATEWAY_SHARED_STATE_URL            = "redis-shared-state-url"
    GATEWAY_METRICS_TOKEN               = "gateway-metrics-token"
  }

  control_env_secrets = {
    GATEWAY_CONTROL_STATE_URL = "redis-shared-state-url"
  }

  access_env_secrets = {
    ACCESS_DATABASE_URL   = "access-database-url"
    ACCESS_REDIS_URL      = "redis-session-url"
    ACCESS_DECISION_TOKEN = "gateway-access-token"
  }

  data_env_secrets = {
    DATA_DATABASE_URL          = "data-database-url"
    DATA_REGISTRY_DATABASE_URL = "data-registry-url"
  }

  console_env_secrets = {
    CONSOLE_CLIENT_SECRET        = "client-secret"
    CONSOLE_SESSION_SECRET       = "console-session-secret"
    CONSOLE_ACCESS_CONTEXT_TOKEN = "console-access-context-token"
  }

  # Every secret that a service reads: the ones it reads from a file
  # and the ones it reads from its environment. The application binds
  # every one of them to the vault of the deployment.
  gateway_secrets = toset(concat(local.gateway_secret_files, values(local.gateway_env_secrets)))
  control_secrets = toset(concat(local.control_secret_files, values(local.control_env_secrets)))
  access_secrets  = toset(concat(local.access_secret_files, values(local.access_env_secrets)))
  data_secrets    = toset(concat(local.data_secret_files, values(local.data_env_secrets)))
  console_secrets = values(local.console_env_secrets)
}

# The gateway: the only service the callers reach.
resource "azurerm_container_app" "gateway" {
  container_app_environment_id = azurerm_container_app_environment.platform.id
  name                         = local.names.gateway
  resource_group_name          = azurerm_resource_group.platform.name
  revision_mode                = "Multiple"

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
    # The gateway speaks the websocket of the upstream it forwards to,
    # and the transport is the one that carries it.
    #
    # The environment terminates the TLS of the callers with the
    # certificate of the custom domain, and it publishes the plain HTTP
    # and the TLS on the standard ports.
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
      # The digest of the route table the gateway reads.
      #
      # The table is written in the vault of the deployment, and the
      # gateway reads it out of the vault when its revision starts: a
      # table that changed and a gateway that did not start again is a
      # gateway that serves the table of the last apply. The digest is
      # what makes the revision start.
      env {
        name  = "GATEWAY_CONFIG_DIGEST"
        value = sha256(jsonencode(local.gateway_route_table))
      }
      env {
        name  = "GATEWAY_OIDC_ISSUER"
        value = local.access_issuer
      }
      env {
        name  = "GATEWAY_OIDC_CLIENT_ID"
        value = var.client_id
      }
      env {
        name  = "GATEWAY_OIDC_REDIRECT_URI"
        value = local.gateway_redirect_uri
      }
      env {
        name  = "GATEWAY_ACCESS_URL"
        value = local.access_issuer
      }
      # The secrets of the gateway are read out of the vault of the
      # deployment: the application binds the name of the secret to the
      # name of the variable, and the value of the secret never travels
      # in the configuration of the application.
      dynamic "env" {
        for_each = local.gateway_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
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
    for_each = local.gateway_secrets
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
  revision_mode                = "Multiple"

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
    # The control plane is never published, and it is reached from
    # inside the network of the deployment: its ingress speaks the
    # plain HTTP, and the name of the environment is its address.
    transport = "http"

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

      # The secrets of the control plane are read out of the vault of the
      # deployment: the application binds the name of the secret to the
      # name of the variable, and the value of the secret never travels
      # in the configuration of the application.
      dynamic "env" {
        for_each = local.control_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
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
    for_each = local.control_secrets
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
  revision_mode                = "Multiple"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    # Access is behind the gateway: it is reached under the name of the
    # deployment, and the gateway forwards the request to it.
    external_enabled = false
    target_port      = 8081
    # Access is never published, and it is reached from inside the
    # network of the deployment: its ingress speaks the plain HTTP, and
    # the name of the environment is its address.
    transport = "http"

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
        name  = "ACCESS_SIGNING_KID"
        value = local.access_signing_kid
      }
      env {
        name  = "ACCESS_LOG_LEVEL"
        value = "info"
      }
      # The secrets of Access are read out of the vault of the
      # deployment: the application binds the name of the secret to the
      # name of the variable, and the value of the secret never travels
      # in the configuration of the application.
      dynamic "env" {
        for_each = local.access_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
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
    for_each = local.access_secrets
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
  revision_mode                = "Multiple"

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
    # Data is never published, and it is reached from inside the
    # network of the deployment: its ingress speaks the plain HTTP, and
    # the name of the environment is its address.
    transport = "http"

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

      # The secrets of Data are read out of the vault of the deployment:
      # the application binds the name of the secret to the name of the
      # variable, and the value of the secret never travels in the
      # configuration of the application.
      dynamic "env" {
        for_each = local.data_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
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
    for_each = local.data_secrets
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
  revision_mode                = "Multiple"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.platform.id]
  }

  registry {
    server   = azurerm_container_registry.platform.login_server
    identity = azurerm_user_assigned_identity.platform.id
  }

  ingress {
    # The console is behind the gateway: it is reached under the name of
    # the deployment, and the gateway forwards the request to it.
    external_enabled = false
    target_port      = 8083
    # The console is never published, and it is reached from inside the
    # network of the deployment: its ingress speaks the plain HTTP, and
    # the name of the environment is its address.
    transport = "http"

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
      # The console is a client of Access and of the gateway.
      #
      # The console reaches Access at the address the environment gives
      # it: the name of the application of Access, which resolves in the
      # internal DNS of the environment and reaches the ingress of the
      # service itself. The public name of the application —
      # `<the-service>.<the-environment>.<the-region>.azurecontainerapps.io` —
      # is the name of a service that is not published, and the
      # environment answers `404` for it.
      #
      # The browsers are not the console: they reach Access and the
      # gateway at their public names, and the addresses they use are
      # the ones the discovery document of Access carries.
      env {
        name  = "CONSOLE_ACCESS_URL"
        value = "http://${local.access_address}"
      }
      # The gateway is the front door of the deployment, and its ingress
      # terminates the TLS of the three public names: the console
      # reaches it at the public name of the gateway, and the browsers
      # reach it at the same name.
      env {
        name  = "CONSOLE_GATEWAY_URL"
        value = local.gateway_url
      }
      # Data is not published, and the console reads the data of a
      # workspace through the gateway. The console reads the state of
      # Data for the status board, and it reads it at the address the
      # environment gives it: the name of the application of Data,
      # which resolves in the internal DNS of the environment and
      # reaches the ingress of the service itself.
      #
      # A console that names no address of Data shows Data as not
      # configured on its status board, and an operator reads it as a
      # service that is not there.
      env {
        name  = "CONSOLE_DATA_URL"
        value = "http://${local.data_address}"
      }
      env {
        name  = "CONSOLE_CLIENT_ID"
        value = var.client_id
      }
      env {
        name  = "CONSOLE_ROUTE_ID"
        value = "console"
      }
      env {
        name  = "CONSOLE_LOG_LEVEL"
        value = "info"
      }

      # The secrets of the console are read out of the vault of the
      # deployment: the application binds the name of the secret to the
      # name of the variable, and the value of the secret never travels
      # in the configuration of the application.
      dynamic "env" {
        for_each = local.console_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
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

  dynamic "secret" {
    for_each = local.console_secrets
    content {
      name                = secret.value
      key_vault_secret_id = azurerm_key_vault_secret.platform[secret.value].versionless_id
      identity            = azurerm_user_assigned_identity.platform.id
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

      # The roles of the deployment, and the rights they need.
      #
      # The role of Access owns the tables of Access, and it cannot do
      # the work of the administrator of the server. The role of Data
      # owns the schemas of Data, and the migrations create them.
      #
      # The job of the migration runs again at every apply of the
      # deployment, and the roles are there after the first run: a job
      # that creates a role and stops when the role is there leaves the
      # services with a password they do not have, and they answer that
      # the password of the role is refused. The roles are created when
      # they are missing, and their passwords are written every time.
      #
      # The grants belong to the database the roles work in: the
      # administrator of the server answers at the database of the
      # platform, and the schema `public` of that database is the one
      # the tables of Access are created in.
      command = [
        "sh", "-c",
        <<-SCRIPT
        set -eu

        admin="$${DATA_ADMIN_DATABASE_URL}"
        access_password="$${ACCESS_APP_PASSWORD}"
        owner_password="$${DATA_OWNER_PASSWORD}"

        # The role of Access: the service creates the eight tables of
        # its schema when it starts, and it creates them as this role.
        if ! psql "$admin" -tAc "select 1 from pg_roles where rolname = 'access_app'" | grep -q 1; then
          psql "$admin" -v ON_ERROR_STOP=1 -c "create role access_app with login password '$access_password'"
        fi
        psql "$admin" -v ON_ERROR_STOP=1 -c "alter role access_app with login password '$access_password'"
        psql "$admin" -v ON_ERROR_STOP=1 -c "grant usage, create on schema public to access_app"

        # The owner of the schema of Data: the migrations create the
        # schemas of the service, and a role that creates a schema
        # needs the right to create one in the database of the service.
        if ! psql "$admin" -tAc "select 1 from pg_roles where rolname = 'data_owner'" | grep -q 1; then
          psql "$admin" -v ON_ERROR_STOP=1 -c "create role data_owner with login password '$owner_password'"
        fi
        psql "$admin" -v ON_ERROR_STOP=1 -c "alter role data_owner with login password '$owner_password'"
        psql "$admin" -v ON_ERROR_STOP=1 -c "grant create on database \"${local.data_database}\" to data_owner"
        SCRIPT
      ]

      env {
        name        = "DATA_ADMIN_DATABASE_URL"
        secret_name = "postgres-admin-url"
      }
      env {
        name        = "ACCESS_APP_PASSWORD"
        secret_name = "access-app-password"
      }
      env {
        name        = "DATA_OWNER_PASSWORD"
        secret_name = "data-owner-password"
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
