# The names of the deployment.
#
# The gateway is the front door of the platform: it is the only service
# the callers reach, and it serves the three public names of the
# deployment.
#
# The names are bound to the gateway as custom domains of its application,
# and the certificate of the names is one of Azure: the environment of the
# container apps issues it and renews it, and the ingress of the
# environment terminates the TLS of the callers with it. The gateway does
# not terminate the TLS in this deployment: the platform has no edge of
# its own here, and the environment of the container apps is the edge.
#
# The names are the second half of the deployment. The environment of the
# container apps proves the ownership of a name with a record of DNS, and
# the record needs the application to exist: the first apply creates the
# environment and the applications, the operator writes the records of
# DNS, and the second apply binds the names. The variable
# `public_names_enabled` is the switch between the two halves.
#
# The environment proves the ownership of a name with a record of DNS,
# and the record of a name that the deployment writes is written before
# the name is bound: the binding waits for the proof.
resource "azurerm_container_app_custom_domain" "gateway" {
  count = var.public_names_enabled ? 1 : 0

  name             = local.gateway_hostname
  container_app_id = azurerm_container_app.gateway.id

  # The certificate of the name is one of Azure: the environment issues it
  # and renews it, and the ingress of the environment terminates the TLS of
  # the callers with it.
  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [azurerm_dns_txt_record.verification]
}

resource "azurerm_container_app_custom_domain" "access" {
  count = var.public_names_enabled ? 1 : 0

  name             = local.access_hostname
  container_app_id = azurerm_container_app.gateway.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [azurerm_dns_txt_record.verification]
}

resource "azurerm_container_app_custom_domain" "console" {
  count = var.public_names_enabled ? 1 : 0

  name             = local.console_hostname
  container_app_id = azurerm_container_app.gateway.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [azurerm_dns_txt_record.verification]
}
