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
#
# The name of the zone is the one of the service: the cache is an Azure
# Managed Redis, its names are names of `<name>.<region>.redis.azure.net`,
# and the zone of those names is `privatelink.redis.azure.net`.
#
# The zone of the Azure Cache for Redis, `privatelink.redis.cache.windows.net`,
# and the zone of the Redis Enterprise,
# `privatelink.redisenterprise.cache.windows.net`, are the zones of the
# other services: the Azure Managed Redis is served by the resource
# provider `Microsoft.Cache/redisEnterprise`, and the zone that the
# provider publishes for it is the one above. A zone of the wrong name
# holds the record of the cache in a zone that the name of the cache is
# not a name of, and the name of the cache then resolves to its public
# address, which is closed.
resource "azurerm_private_dns_zone" "redis" {
  name                = "privatelink.redis.azure.net"
  resource_group_name = azurerm_resource_group.platform.name
  tags                = local.tags
}

# The private zone of the vault.
#
# The zone is the one Azure publishes for the vaults, and it is what
# makes the name of the vault resolve to the private address of the
# endpoint of the vault.
resource "azurerm_private_dns_zone" "vault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.platform.name
  tags                = local.tags
}

# The link between the private zone of the vault and the network of the
# deployment.
#
# The zone is linked to the network of the deployment and not to the
# subnet of the services: the resolver of Azure answers the zone for
# the networks that are linked to it, and the services of the deployment
# read the secrets of the vault over the private address of the
# endpoint of the vault.
resource "azurerm_private_dns_zone_virtual_network_link" "vault" {
  name                  = "${local.prefix}-vault"
  resource_group_name   = azurerm_resource_group.platform.name
  private_dns_zone_name = azurerm_private_dns_zone.vault.name
  virtual_network_id    = azurerm_virtual_network.platform.id
  registration_enabled  = false
}

# The link between the private zone of the cache and the network of the
# deployment.
#
# The zone is linked to the network of the deployment and not to the
# subnet of the services: the resolver of Azure answers the zone for
# the networks that are linked to it, and the services of the
# deployment reach the cache over the private address of the endpoint
# of the cache.
#
# The link is written by the templates and not left to Azure: the zone
# group of the endpoint writes the records of the zone, and the records
# of a zone that is not linked to the network are not answered by the
# resolver of Azure. The name of the cache then resolves to the public
# address of the cache, which is closed, and the services of the
# deployment cannot reach the cache at all: the gateway reports that
# the session store is not reachable and that the shared state is not
# reachable, and it cannot read the certificate of the deployment,
# which lives in the shared state.
#
# The zone of the vault has the same link, and the zone of the database
# has one as well: a zone of the deployment that is linked in one place
# and not in the other is a zone that answers in one place and not in
# the other.
resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  name                  = "${local.prefix}-redis"
  resource_group_name   = azurerm_resource_group.platform.name
  private_dns_zone_name = azurerm_private_dns_zone.redis.name
  virtual_network_id    = azurerm_virtual_network.platform.id
  registration_enabled  = false
}

# The link between the private zone of the database and the network of
# the deployment.
#
# The zone of the private names of Azure is answered by the resolver of
# Azure, and the resolver answers it only for the networks that are
# linked to the zone. The server of the database is injected into the
# network of the deployment, and the services of the deployment are in
# that network: without the link, the name of the server does not
# resolve at all, and every service that reads the database fails to
# start with a name it cannot find.
#
# The link of the zone of the cache is written above: the endpoint of
# the cache is a private endpoint, and the records of its zone are
# answered by the resolver of Azure only for the networks that are
# linked to the zone.
resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${local.prefix}-postgres"
  resource_group_name   = azurerm_resource_group.platform.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.platform.id
  registration_enabled  = false
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
    private_connection_resource_id = azurerm_managed_redis.platform.id
    # The subresource of an Azure Managed Redis is `redisEnterprise`.
    # The cache is served by the resource provider
    # `Microsoft.Cache/redisEnterprise`, and the name of the subresource
    # is the name of that provider, not the name of the service. Azure
    # refuses the endpoint with any other name: the answer is
    # `GroupIds weren't provided or do not match 'redisEnterprise'`.
    subresource_names    = ["redisEnterprise"]
    is_manual_connection = false
  }

  private_dns_zone_group {
    name                 = "${local.prefix}-redis"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis.id]
  }

  tags = local.tags
}

# The private endpoint of the vault of the deployment.
#
# The services of the deployment read the secrets of the vault over the
# private address of this endpoint, and never over the public address
# of the vault: the name of the vault resolves to the private address
# inside the network of the deployment, and the resolver of Azure
# answers it there.
#
# The vault keeps its public address open, because the operator writes
# the secrets of the deployment in it from a machine that is not in the
# network of the deployment: the access of the vault is a role of
# Entra ID, and the role is what protects the secrets.
resource "azurerm_private_endpoint" "vault" {
  name                = "${local.prefix}-vault"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "${local.prefix}-vault"
    private_connection_resource_id = azurerm_key_vault.platform.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "${local.prefix}-vault"
    private_dns_zone_ids = [azurerm_private_dns_zone.vault.id]
  }

  tags = local.tags
}
