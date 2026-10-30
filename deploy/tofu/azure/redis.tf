# The cache of the deployment.
#
# The cache holds the sessions of the callers, the windows of the
# limits, the decisions that Access answered and the codes of the
# logins of Access. It is not published: the cache is injected into the
# network of the deployment, and it answers on the private addresses of
# it.
#
# The tier is Premium: the tier that holds more than one database, and
# the tier that knows the access control list of the users. The
# deployment puts the sessions in one database and the state that the
# replicas share in another.
resource "azurerm_redis_cache" "platform" {
  name                = "${local.prefix}-redis"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  sku_name            = var.redis_sku_name
  family              = "P"
  capacity            = var.redis_capacity
  redis_version       = var.redis_version

  minimum_tls_version  = "1.2"
  non_ssl_port_enabled = false

  # The credentials of the cache are the access key of the deployment.
  # The README describes the access control list that narrows them to
  # the keys of the platform.
  access_keys_authentication_enabled = true

  # The cache is not published: the private endpoint of the network of
  # the deployment is the only way in.
  public_network_access_enabled = false

  tags = local.tags
}
