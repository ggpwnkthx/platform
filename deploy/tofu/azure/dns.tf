# The zone of the names of the deployment.
#
# The names of the deployment are the subdomains of a domain, and the
# domain is a zone of DNS. The zone can be a zone of Azure: the
# deployment writes the records of the names in the zone, and the
# operator delegates the zone to Azure with the records of the
# registrar, and writes nothing else.
#
# The zone is the second half of the deployment, like the names
# themselves: the record of a name needs the application of the gateway
# to exist, and the delegation of the zone needs the zone to exist.
#
# The zone of the deployment is a zone of the group of the deployment
# when the operator names no group: the zone of the names of a
# deployment dies with the deployment. A zone that the operator names
# outlives the deployment, and the operator owns it: the deployment
# writes the records of the names in it and creates nothing.
resource "azurerm_dns_zone" "platform" {
  count = local.dns_zone_enabled && var.dns_zone_resource_group_name == "" ? 1 : 0

  name                = var.dns_zone_name
  resource_group_name = azurerm_resource_group.platform.name

  tags = local.tags

  # The zone of the names outlives the deployment.
  #
  # The zone is delegated at the registrar of the domain, and the
  # delegation names the name servers of the zone: a zone that is
  # created again is served by other name servers, and the delegation
  # names a zone that is not there anymore. The records of the names
  # are then in a zone the public DNS does not read, and the
  # environment of the container apps proves the ownership of no name.
  #
  # The zone is not destroyed with the deployment: the operator
  # delegates the zone once, and the delegation holds as long as the
  # zone is there.
  lifecycle {
    prevent_destroy = true
  }
}

# The zone of the operator.
#
# A zone that is named in the group of the operator is a zone that the
# operator owns: the deployment writes the records of the names in it
# and creates nothing. The name servers of the zone are the ones the
# operator delegates the zone with.
data "azurerm_dns_zone" "platform" {
  count = local.dns_zone_enabled && var.dns_zone_resource_group_name != "" ? 1 : 0

  name                = var.dns_zone_name
  resource_group_name = var.dns_zone_resource_group_name
}

# The records of the names of the deployment.
#
# Every name of the deployment is a record of the zone that points at
# the application of the gateway: the names are the Host header of the
# requests of the callers, and the edge of the environment routes them
# to the gateway.
#
# The record of a name is the name of the deployment without the zone:
# the name of the gateway is the record "api" of the zone.
resource "azurerm_dns_cname_record" "platform" {
  for_each = local.dns_zone_enabled ? local.public_names : {}

  name                = local.dns_record_names[each.key]
  zone_name           = var.dns_zone_name
  resource_group_name = local.dns_resource_group
  ttl                 = 300
  record              = azurerm_container_app.gateway.ingress[0].fqdn
}

# The records that prove the ownership of the names.
#
# The environment of the container apps proves the ownership of a name
# with a record of DNS, and the record holds the code of the
# verification of the application of the gateway: the code is the code
# of the application, and every name of the deployment carries it.
#
# The names of the deployment are bound to the gateway when the
# environment has proved the ownership of them, and the proof is the
# record: the binding waits for the record.
resource "azurerm_dns_txt_record" "verification" {
  for_each = local.dns_zone_enabled ? local.public_names : {}

  name                = local.dns_verification_names[each.key]
  zone_name           = var.dns_zone_name
  resource_group_name = local.dns_resource_group
  ttl                 = 300
  record {
    value = azurerm_container_app.gateway.custom_domain_verification_id
  }
}
