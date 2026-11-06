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
#
# The templates write the names without a certificate, and the
# certificate of a name is bound by the client of Azure: the provider
# of the infrastructure of Azure writes a custom domain without a
# certificate, because it has no resource that binds the certificate of
# the environment of the container apps to a name of an application
# (the issue <https://github.com/hashicorp/terraform-provider-azurerm/issues/27362>
# is open). A name without a certificate is a name that answers in
# plain HTTP only.
#
# The wizard of the deployment binds the certificate of every public
# name after the apply, with the client of Azure: the environment
# issues the certificate of the name and renews it, and the ingress of
# the environment terminates the TLS of the callers with it. A
# deployment that is applied without the wizard binds the certificates
# with the client of Azure:
#
#   az containerapp hostname bind \
#     --hostname api.<the-zone-of-the-names> \
#     --name <the-application-of-the-gateway> \
#     --resource-group <the-group-of-the-deployment> \
#     --environment <the-environment-of-the-container-apps> \
#     --validation-method HTTP
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
