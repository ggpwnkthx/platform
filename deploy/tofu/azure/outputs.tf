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

# The addresses of DNS. The public name of the deployment is a record of
# DNS that points at the default domain of the endpoint of the service.
output "dns_gateway" {
  description = "The record of DNS of the public name of the gateway."
  value       = azurerm_cdn_frontdoor_endpoint.gateway.host_name
}

output "dns_access" {
  description = "The record of DNS of the public name of Access."
  value       = azurerm_cdn_frontdoor_endpoint.access.host_name
}

output "dns_console" {
  description = "The record of DNS of the public name of the console."
  value       = azurerm_cdn_frontdoor_endpoint.console.host_name
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

# The registry of the images of the deployment.
output "registry_login_server" {
  description = "The address of the registry of the images of the deployment."
  value       = azurerm_container_registry.platform.login_server
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
  value       = random_password.access_admin.result
  sensitive   = true
}

# The credentials of the clients of Access. The tenant of the deployment
# registers them through the administration API of Access.
output "gateway_client_id" {
  description = "The identifier of the gateway as a client of Access."
  value       = var.gateway_client_id
}

output "gateway_client_secret" {
  description = "The secret of the gateway as a client of Access."
  value       = random_password.gateway_client_secret.result
  sensitive   = true
}

output "console_client_id" {
  description = "The identifier of the console as a client of Access."
  value       = var.console_client_id
}

output "console_client_secret" {
  description = "The secret of the console as a client of Access."
  value       = random_password.console_client_secret.result
  sensitive   = true
}

# The credential of the access context of Data. The operator commands
# that read the data of a workspace take it.
output "data_access_context_token" {
  description = "The credential of the access context of Data."
  value       = random_password.access_context.result
  sensitive   = true
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

# The addresses of the state of the deployment, without the credentials.
output "postgres_host" {
  description = "The address of the server of PostgreSQL."
  value       = azurerm_postgresql_flexible_server.platform.fqdn
}

output "redis_host" {
  description = "The address of the cache of the deployment."
  value       = azurerm_redis_cache.platform.hostname
}
