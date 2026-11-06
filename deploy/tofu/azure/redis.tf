# The cache of the deployment.
#
# The cache holds the sessions of the callers, the windows of the
# limits, the decisions that Access answered and the codes of the
# logins of Access. It is not published: the cache is injected into the
# network of the deployment, and it answers on the private addresses of
# it.
#
# The cache is an Azure Managed Redis: the service that replaces Azure
# Cache for Redis, which is retired and refuses to be created. The
# deployment puts the sessions in one database and the state that the
# replicas share in another.
#
# The users of the access control list of the cache are not a resource
# of the templates: the provider of Azure has no resource for them, and
# they are created by the operator with the client of Redis, once, from
# inside the network of the deployment. Until they are there, the
# credential of the cache is its access key, and the access key is the
# whole of the cache. The README of the deployment says what the
# operator does.
resource "azurerm_managed_redis" "platform" {
  name                = "${local.prefix}-redis"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  sku_name            = var.redis_sku_name

  # The cache is not published: the private endpoint of the network of
  # the deployment is the only way in.
  public_network_access = "Disabled"

  # The credentials of the cache are the access key of the deployment.
  # The access key is the whole of the cache until the users of the
  # access control list are there, and the users are made by the
  # operator: the provider of Azure has no resource for them. The
  # README describes the access control list that narrows the access of
  # the cache to the keys of the platform.
  default_database {
    access_keys_authentication_enabled = true
  }

  tags = local.tags
}
