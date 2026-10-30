# The network of the deployment.
#
# The services of the platform talk to each other over HTTP, and the
# state of the deployment lives in a database and in a cache. Neither
# of them is published: the deployment reaches them over the private
# addresses of the virtual network, and the only way in is from the
# inside of the network.

resource "azurerm_resource_group" "platform" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "platform" {
  name                = "${local.prefix}-network"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  address_space       = ["10.20.0.0/16"]
  tags                = local.tags
}

# The subnet of the infrastructure of the environment of the container
# apps. It is the subnet the platform of Azure reserves for the
# environment, and it is the way the services reach the private
# addresses of the network.
#
# The delegation is the one the provider of Azure accepts. The
# documentation of Azure names `Microsoft.App/managedEnvironments` for
# the same delegation, and the README says what to do when the apply
# refuses the value that is written here.
resource "azurerm_subnet" "infrastructure" {
  name                 = "${local.prefix}-infrastructure"
  resource_group_name  = azurerm_resource_group.platform.name
  virtual_network_name = azurerm_virtual_network.platform.name
  address_prefixes     = ["10.20.0.0/23"]

  delegation {
    name = "managed-environments"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# The subnet of the database. The server of the deployment is injected
# into it, and the server answers on the private addresses of it.
resource "azurerm_subnet" "postgres" {
  name                 = "${local.prefix}-postgres"
  resource_group_name  = azurerm_resource_group.platform.name
  virtual_network_name = azurerm_virtual_network.platform.name
  address_prefixes     = ["10.20.2.0/24"]

  delegation {
    name = "postgresql"

    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# The subnet of the private endpoints. The endpoint of the cache lives
# in it, and it is the private address of the cache.
resource "azurerm_subnet" "private_endpoints" {
  name                 = "${local.prefix}-private-endpoints"
  resource_group_name  = azurerm_resource_group.platform.name
  virtual_network_name = azurerm_virtual_network.platform.name
  address_prefixes     = ["10.20.4.0/26"]
}

# The private zone of the database. The name of the zone is the one
# Azure publishes for the service, and the zone is what makes the
# address of the server resolve to the private one.
resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.platform.name
  tags                = local.tags
}

# The private zone of the cache.
resource "azurerm_private_dns_zone" "redis" {
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = azurerm_resource_group.platform.name
  tags                = local.tags
}

# The private endpoint of the cache of the deployment. The cache is not
# published, and the endpoint is the only way in.
resource "azurerm_private_endpoint" "redis" {
  name                = "${local.prefix}-redis"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "${local.prefix}-redis"
    private_connection_resource_id = azurerm_redis_cache.platform.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "${local.prefix}-redis"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis.id]
  }

  tags = local.tags
}
