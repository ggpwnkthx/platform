# The database of the deployment.
#
# The database holds the eight tables of Access, the business data of
# Data and, when the deployment asks for it, the state of the gateway.
# It is not published: the server is injected into the network of the
# deployment, and it answers on the private addresses of it.
#
# The roles are separated: Access owns its own tables, and Data has
# five roles that cannot do the work of one another. The templates
# create the server and the databases; the roles are created by the
# operator command of Data, with the credentials of the administrator,
# the way a deployment creates them.
resource "azurerm_postgresql_flexible_server" "platform" {
  name                = "${local.prefix}-postgres"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  version             = var.postgresql_version
  sku_name            = var.postgresql_sku_name
  storage_mb          = var.postgresql_storage_mb

  # The administrator of the server. It is the account that creates the
  # roles of the deployment, and it is the account that applies the
  # migrations of the schema.
  administrator_login    = "platform_admin"
  administrator_password = random_password.postgres_admin.result

  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false

  backup_retention_days        = var.postgresql_backup_retention_days
  geo_redundant_backup_enabled = false

  # The high availability is zone redundant: the server answers from two
  # zones. A region whose delegated subnet is not zone redundant refuses
  # it, and the deployment runs a single zone server instead.
  high_availability {
    mode = var.postgresql_high_availability ? "ZoneRedundant" : "Standby"
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

# The database of Access. The role that owns it is created by the
# operator command of the deployment, not by the templates: the role
# carries the password of the deployment.
resource "azurerm_postgresql_flexible_server_database" "platform" {
  name      = local.platform_database
  server_id = azurerm_postgresql_flexible_server.platform.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# The database of Data. It holds the business data, and it is the one
# the five roles of Data share.
resource "azurerm_postgresql_flexible_server_database" "data" {
  name      = local.data_database
  server_id = azurerm_postgresql_flexible_server.platform.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
