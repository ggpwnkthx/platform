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
# deployment puts the sessions and the state that the replicas share in
# one database, and the two stores are apart by the keys they use.
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

    # The policy of the cluster of the cache.
    #
    # An Azure Managed Redis is a cluster on every tier and every size:
    # the service is built on Redis Enterprise, and the policy of the
    # cluster decides how a client reaches it. The default is the policy
    # of the Redis of the community edition, `OSSCluster`, and a client
    # of one server cannot use it: the server answers a command on a key
    # it does not hold with a redirection, `MOVED <the-slot> <the-node>`,
    # and the client of the platform follows no redirection. The gateway
    # then says that the shared state is not reachable, and it keeps the
    # sessions of the callers and the windows of the limits in the
    # memory of a replica.
    #
    # The policy of the proxy, `EnterpriseCluster`, is the one a client of
    # one server can use: the proxy routes every command to the shard
    # that holds the key, and the cache looks like a server to the
    # client. The policy is chosen when the database is created, and
    # changing it recreates the database: the sessions of the callers are
    # lost, and nothing else is.
    clustering_policy = "EnterpriseCluster"
  }

  tags = local.tags
}
