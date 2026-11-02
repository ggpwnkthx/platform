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
output "dns_records" {
  description = "The records of DNS of the public names of the deployment."
  value = {
    api = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = "asuid.${split(".", var.gateway_hostname)[0]}"
    }
    access = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = "asuid.${split(".", var.access_hostname)[0]}"
    }
    console = {
      cname        = azurerm_container_app.gateway.ingress[0].fqdn
      verification = "asuid.${split(".", var.console_hostname)[0]}"
    }
  }
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
  value       = azurerm_managed_redis.platform.hostname
}
