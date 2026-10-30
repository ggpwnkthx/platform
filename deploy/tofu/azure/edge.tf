# The edge of the deployment.
#
# No service of the platform terminates TLS itself: the edge does it, and
# the edge is the only thing the callers reach. The three public hosts
# of the deployment are three endpoints of one profile, and each of them
# answers for one service.
#
# The endpoints carry the default domain of the profile. The operator
# points the public names of the deployment at them, with a record of
# DNS, and the names the services answer under are the names of the
# deployment, not the names of the profile.

resource "azurerm_cdn_frontdoor_profile" "platform" {
  name                = "${local.prefix}-frontdoor"
  resource_group_name = azurerm_resource_group.platform.name
  sku_name            = var.frontdoor_sku_name
  tags                = local.tags
}

# The three origins of the deployment: the gateway, Access and the
# console. The origin of the gateway is the address the gateway answers
# on, and the certificate of the origin is the one of the environment
# of the deployment.
resource "azurerm_cdn_frontdoor_origin" "gateway" {
  name                           = "${local.prefix}-gateway-origin"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.gateway.id
  certificate_name_check_enabled = true
  host_name                      = local.gateway_fqdn
  origin_host_header             = local.gateway_fqdn
  http_port                      = 80
  https_port                     = 443
}

resource "azurerm_cdn_frontdoor_origin" "access" {
  name                           = "${local.prefix}-access-origin"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.access.id
  certificate_name_check_enabled = true
  host_name                      = local.access_fqdn
  origin_host_header             = local.access_fqdn
  http_port                      = 80
  https_port                     = 443
}

resource "azurerm_cdn_frontdoor_origin" "console" {
  name                           = "${local.prefix}-console-origin"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.console.id
  certificate_name_check_enabled = true
  host_name                      = local.console_fqdn
  origin_host_header             = local.console_fqdn
  http_port                      = 80
  https_port                     = 443
}

resource "azurerm_cdn_frontdoor_origin_group" "gateway" {
  name                     = "${local.prefix}-gateway-group"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  session_affinity_enabled = true

  health_probe {
    protocol            = "Https"
    path                = "/"
    interval_in_seconds = 30
  }

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
}

resource "azurerm_cdn_frontdoor_origin_group" "access" {
  name                     = "${local.prefix}-access-group"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  session_affinity_enabled = true

  health_probe {
    protocol            = "Https"
    path                = "/"
    interval_in_seconds = 30
  }

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
}

resource "azurerm_cdn_frontdoor_origin_group" "console" {
  name                     = "${local.prefix}-console-group"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  session_affinity_enabled = true

  health_probe {
    protocol            = "Https"
    path                = "/"
    interval_in_seconds = 30
  }

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
}

# The endpoints of the deployment. One endpoint answers for one public
# name, and the operator points the name at the default domain of the
# endpoint.
resource "azurerm_cdn_frontdoor_endpoint" "gateway" {
  name                     = "${local.prefix}-gateway"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  enabled                  = true
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "access" {
  name                     = "${local.prefix}-access"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  enabled                  = true
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "console" {
  name                     = "${local.prefix}-console"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.platform.id
  enabled                  = true
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_route" "gateway" {
  name                          = "${local.prefix}-gateway-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.gateway.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.gateway.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.gateway.id]
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  link_to_default_domain        = true
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Https", "Http"]
  enabled                       = true

  # The gateway forwards the websockets of its upstreams, and the edge
  # has to carry them.
  cache {
    query_string_caching_behavior = "IgnoreQueryString"
    compression_enabled           = false
  }
}

resource "azurerm_cdn_frontdoor_route" "access" {
  name                          = "${local.prefix}-access-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.access.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.access.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.access.id]
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  link_to_default_domain        = true
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Https", "Http"]
  enabled                       = true

  cache {
    query_string_caching_behavior = "IgnoreQueryString"
    compression_enabled           = false
  }
}

resource "azurerm_cdn_frontdoor_route" "console" {
  name                          = "${local.prefix}-console-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.console.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.console.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.console.id]
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  link_to_default_domain        = true
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Https", "Http"]
  enabled                       = true

  cache {
    query_string_caching_behavior = "IgnoreQueryString"
    compression_enabled           = false
  }
}
