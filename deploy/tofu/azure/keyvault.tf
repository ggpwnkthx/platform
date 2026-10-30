# The vault of the deployment.
#
# The vault holds the credentials of the deployment: the secrets of the
# services, the addresses of the databases that carry a password and the
# documents that the services read. Nothing of the vault is committed,
# and the state of the templates holds the value of every secret: the
# state is therefore a secret store, and it is protected as one.
#
# The name of the vault is unique in the whole of Azure, and the name of
# the deployment is not: the operator names the vault when the default
# name is taken.
resource "azurerm_key_vault" "platform" {
  name                = local.key_vault_name
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  tenant_id           = var.tenant_id
  sku_name            = "standard"

  # The vault is emptied into a bin that is kept for ninety days: a
  # secret that a deployment deletes by mistake is still there.
  purge_protection_enabled   = true
  soft_delete_retention_days = 90

  # The access of the vault is a role of Entra ID and not a policy of
  # access: the policies hold the secret of the administrator of the
  # vault, and a policy is a credential.
  rbac_authorization_enabled = true

  # The services of the deployment reach the vault over the internet and
  # over a private endpoint; the README describes the private endpoint
  # that closes the second way in.
  public_network_access_enabled = true

  tags = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

# The permission of the operator on the vault.
#
# The vault is written through its data plane, and the data plane
# answers to the roles of Entra ID: the operator writes the secrets of
# the deployment, and the role that lets it is a role of Entra ID.
#
# The role of the operator is not the role of the services: the services
# read the secrets, and the operator writes them.
resource "azurerm_role_assignment" "vault_secrets_officer" {
  count = var.operator_principal_id == "" ? 0 : 1

  scope                = azurerm_key_vault.platform.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.operator_principal_id
}

# The permission of the operator reaches the token of the operator a
# little after the role is created, and the secrets are written with
# that token: the secrets wait for the permission.
resource "time_sleep" "vault_permission" {
  count = var.operator_principal_id == "" ? 0 : 1

  depends_on = [
    azurerm_role_assignment.vault_secrets_officer,
    azurerm_role_assignment.vault_secrets_user,
  ]
  create_duration = "60s"
}

# The secrets of the deployment.
#
# Every secret of the platform is written here, and the services read
# them from the vault. The names of the secrets are the names of the
# files that the services read them from, so a name of the vault and a
# name of a file are one name.
resource "azurerm_key_vault_secret" "platform" {
  for_each = local.secret_names

  name         = each.key
  key_vault_id = azurerm_key_vault.platform.id
  value        = local.secret_values[each.key]
  content_type = "text/plain"

  depends_on = [time_sleep.vault_permission]
}
