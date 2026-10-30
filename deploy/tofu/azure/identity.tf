# The identity of the deployment.
#
# The services of the platform reach the vault of the deployment with
# the identity of the deployment, and the identity is a user assigned
# one: the identity exists before the services that use it, so the
# permission that reads the secrets is in place before the first
# revision of a service starts.
resource "azurerm_user_assigned_identity" "platform" {
  name                = "${local.prefix}-identity"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  tags                = local.tags
}

# The permission that reads the secrets of the vault. It is the
# permission of a reader of secrets and nothing else: the services read
# the credentials of the deployment, and they change nothing.
resource "azurerm_role_assignment" "vault_secrets_user" {
  scope                = azurerm_key_vault.platform.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.platform.principal_id
}

# The permission that pushes the images of the deployment to the
# registry of the deployment.
resource "azurerm_role_assignment" "registry_push" {
  scope                = azurerm_container_registry.platform.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.platform.principal_id
}
