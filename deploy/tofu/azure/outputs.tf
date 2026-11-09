# What the deployment answers.
#
# The outputs are the facts that the operator needs after the apply and
# that no other document of the repository holds: the addresses the DNS
# of the deployment points at, and the credentials that the operator
# commands of the platform take.

output "resource_group_name" {
  description = "The resource group of the deployment."
  value       = azurerm_resource_group.platform.name
}

# The addresses of DNS. The public names of the deployment are records of
# DNS that point at the gateway: the gateway is the only service the
# callers reach, and it serves the three names of the deployment.
#
# The environment of the container apps proves the ownership of a name
# with a record of DNS: a TXT record named "asuid" and the subdomain of
# the name, holding the code of the verification.
#
# The records of this output are the records of a zone the operator
# writes: a deployment that writes its records in a zone of Azure writes
# them itself, and the operator only delegates the zone.
output "dns_records" {
  description = "The records of DNS of the public names of the deployment."
  value = {
    api = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = local.dns_verification_names["api"]
    }
    access = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = local.dns_verification_names["access"]
    }
    console = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = local.dns_verification_names["console"]
    }
  }
}

# The name servers of the zone of the names of the deployment.
#
# The operator delegates the zone to Azure with these records at the
# registrar, and the delegation is the only record the operator writes:
# the names of the deployment are the records of the zone, and the
# deployment writes them.
output "dns_name_servers" {
  description = "The name servers of the zone of the public names of the deployment."
  value = local.dns_zone_enabled ? tolist(one(concat(
    azurerm_dns_zone.platform[*].name_servers,
    data.azurerm_dns_zone.platform[*].name_servers,
  ))) : []
}

# The zone of the names of the deployment.
#
# The zone is named by the operator, and it holds every name of the
# deployment: the names are the subdomains of the zone.
output "dns_zone_name" {
  description = "The zone of DNS that holds the public names of the deployment."
  value       = var.dns_zone_name
}

# The code of the verification of the names of the deployment. It is the
# value of the TXT records that prove the ownership of the names.
output "dns_verification_id" {
  description = "The code of the verification of the public names of the deployment."
  value       = azurerm_container_app.gateway.custom_domain_verification_id
  sensitive   = true
}

# The public names of the deployment.
output "gateway_url" {
  description = "The public address of the gateway."
  value       = local.gateway_url
}

output "access_issuer" {
  description = "The issuer of the tokens of Access."
  value       = local.access_issuer
}

output "console_url" {
  description = "The public address of the console."
  value       = local.console_url
}

# The vault of the deployment.
output "key_vault_name" {
  description = "The name of the vault of the deployment."
  value       = azurerm_key_vault.platform.name
}

output "key_vault_uri" {
  description = "The address of the vault of the deployment."
  value       = azurerm_key_vault.platform.vault_uri
}

# The key that signs the identity of a request. The public half is what
# the upstreams verify a signature with; the private half is in the
# vault of the deployment and is never an output.
output "identity_signing_public_key" {
  description = "The public half of the key that signs the identity of a request."
  value       = tls_private_key.identity.public_key_pem
}

# The credentials of the administration of Access. The operator commands
# of the deployment take them.
output "access_admin_token" {
  description = "The token of the administration of Access."
  value       = random_bytes.access_admin.hex
  sensitive   = true
}

# The credentials of the client of the tenant at Access. The tenant
# registers them through the administration API of Access, and the
# callbacks of the gateway and of the console are the redirect URIs of
# the one client.
output "client_id" {
  description = "The identifier of the tenant's client at Access."
  value       = var.client_id
}

output "client_secret" {
  description = "The secret of the tenant's client at Access."
  value       = random_bytes.client_secret.hex
  sensitive   = true
}

output "client_redirect_uris" {
  description = "The callbacks the tenant registers at Access: the callback of the gateway and the callback of the console."
  value       = [local.gateway_redirect_uri, local.console_redirect_uri]
}

# The values of the deployment that the wizard reads after the apply.
#
# The wizard of the deployment binds what the templates cannot write:
# the tenant of the deployment is registered at Access with the
# application of Entra ID as its provider, and the certificates of the
# public names are bound with the client of Azure. The wizard reads the
# values of the deployment in the answers of the templates, and not in
# the code of the wizard: a value that is written in the templates and
# in the code of the wizard is a value that drifts, and the wizard
# reads the values the deployment runs with.
output "access_tenant_id" {
  description = "The identifier of the tenant of Access: the scope of the access context of the deployment."
  value       = var.access_tenant_id
}

output "data_workspace_slug" {
  description = "The slug of the workspace of Data: the slug of the tenant of the deployment."
  value       = var.data_workspace_slug
}

output "tenant_auto_provision" {
  description = "Whether the tenant of the deployment provisions the identities that sign in."
  value       = var.tenant_auto_provision
}

output "tenant_auto_provision_admin" {
  description = "Whether the first identity that signs in administers the tenant of the deployment."
  value       = var.tenant_auto_provision_admin
}

output "entra_tenant_enabled" {
  description = "Whether the deployment created the application of Access at Entra ID."
  value       = var.entra_tenant_enabled
}

output "public_names_enabled" {
  description = "Whether the public names of the deployment are bound to the gateway."
  value       = var.public_names_enabled
}

# The credential of the access context of Data. The operator commands
# that read the data of a workspace take it.
output "data_access_context_token" {
  description = "The credential of the access context of Data."
  value       = random_bytes.access_context.hex
  sensitive   = true
}

# The provider of the identity of the tenant of the deployment.
#
# The application of Access at Entra ID is the client of Access at the
# provider of the tenant, and the registration of the tenant carries
# the issuer, the identifier of the client, its secret and the callback
# of Access at the provider.
output "entra_issuer" {
  description = "The issuer of the provider of the identity of the tenant of the deployment."
  value       = local.entra_issuer
}

output "entra_client_id" {
  description = "The identifier of the client of Access at Entra ID."
  value       = one(azuread_application.access[*].client_id)
}

output "entra_client_secret" {
  description = "The secret of the client of Access at Entra ID."
  value       = one(azuread_application_password.access[*].value)
  sensitive   = true
}

output "entra_redirect_uri" {
  description = "The callback of Access at Entra ID."
  value       = local.entra_redirect_uri
}

# The names of the services of the deployment.
output "container_apps" {
  description = "The names of the container apps of the deployment."
  value = {
    gateway = azurerm_container_app.gateway.name
    access  = azurerm_container_app.access.name
    data    = azurerm_container_app.data.name
    console = azurerm_container_app.console.name
    control = azurerm_container_app.control.name
  }
}

# The job of the migration of the schema.
#
# The job waits for the hand of the operator: it creates the roles of
# the deployment, and the services that read the database of the
# deployment do not start without them. The wizard of the deployment
# starts the job when the deployment is applied.
output "migration_job" {
  description = "The name of the job of the migration of the schema."
  value       = azurerm_container_app_job.migrate.name
}

# The environment of the container apps of the deployment.
#
# The environment holds the certificate of the public names: it issues
# the certificate of a name and renews it, and the ingress of the
# environment terminates the TLS of the callers with it.
output "container_app_environment" {
  description = "The name of the environment of the container apps of the deployment."
  value       = azurerm_container_app_environment.platform.name
}

# The public names of the deployment.
#
# The names are the addresses the callers reach, and every name of the
# deployment is a name of the gateway: the gateway serves the three
# names, and the certificate of a name is the certificate of the
# environment of the container apps.
output "public_names" {
  description = "The public names of the deployment."
  value       = local.public_names
}

# The addresses of the state of the deployment, without the credentials.
output "postgres_host" {
  description = "The address of the server of PostgreSQL."
  value       = azurerm_postgresql_flexible_server.platform.fqdn
}

output "redis_host" {
  description = "The address of the cache of the deployment."
  value       = azurerm_managed_redis.platform.hostname
}
