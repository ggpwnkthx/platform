# The registry of the images of the deployment.
#
# The images of the platform are published to a registry, and the
# deployment pulls them by digest. The registry of the deployment holds
# the copy of the images of the release: the deployment runs the bytes
# of the release, and the release proves the digest it published.
#
# The administrative user of the registry is off: the services of the
# platform pull the images with the identity of the deployment, and a
# credential that is shared by a password is a credential that a person
# holds.
resource "azurerm_container_registry" "platform" {
  name                   = replace("${local.prefix}registry", "-", "")
  resource_group_name    = azurerm_resource_group.platform.name
  location               = azurerm_resource_group.platform.location
  sku                    = "Premium"
  admin_enabled          = false
  anonymous_pull_enabled = false
  tags                   = local.tags
}

# The identity that pulls the images. The registry grants it the pull.
resource "azurerm_role_assignment" "registry_pull" {
  scope                = azurerm_container_registry.platform.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.platform.principal_id
}
