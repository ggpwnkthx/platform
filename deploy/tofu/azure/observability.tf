# The workspace of the deployment.
#
# The environment of the container apps holds the four services of the
# platform and the control plane of the gateway. The environment is
# joined to the network of the deployment: the services reach the
# database and the cache on their private addresses, and they do not
# reach the internet to do it.
#
# The environment writes its logs to the workspace of the deployment,
# and the workspace is where the alerts of the deployment read their
# signals from.
resource "azurerm_log_analytics_workspace" "platform" {
  name                = "${local.prefix}-workspace"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_app_environment" "platform" {
  name                       = "${local.prefix}-environment"
  resource_group_name        = azurerm_resource_group.platform.name
  location                   = azurerm_resource_group.platform.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.platform.id

  # The environment is joined to the network of the deployment. The
  # ingress of the environment stays public: the three public hosts of
  # the deployment are answered from the internet, and the two that are
  # not published are told to keep their ingress to themselves.
  infrastructure_subnet_id = azurerm_subnet.infrastructure.id

  workload_profile {
    name                  = "default"
    workload_profile_type = "Consumption"
  }

  zone_redundancy_enabled = false

  tags = local.tags
}
