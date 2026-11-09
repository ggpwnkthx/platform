# The application of Access at Entra ID.
#
# The provider of the identity of the tenant of the deployment is Entra
# ID, and Access is a client of it: a confidential client, with a
# secret of its own, and with the callback of Access as its only
# redirect URI.
#
# The application belongs to the tenant the deployment creates, and to
# no other tenant: the provider of a tenant is the tenant's own, and
# every tenant names the provider its people sign in at. A tenant of
# the platform that signs in at another provider — a directory of
# another cloud, a broker of another vendor — is registered with that
# provider, and the deployment has nothing to do with it.
#
# The application lives in the tenant of the deployment and in no
# other: the provider of Entra ID is bound to the tenant of the
# deployment, and the application of Access is an object of that
# directory. A deployment whose tenant is another directory has its
# application in the other one, and the logins of its callers are
# refused by the issuer of the tenant.
#
# The application asks for no permission of any other application: it
# is a client and not a resource, and the identity of a caller is the
# only thing it reads of Entra ID. The groups of a caller are read in
# the grants of Access, and not in the directory.
#
# The creation of the application needs a permission in the tenant of
# the deployment: the operator holds the role of an administrator of
# applications, or the identity the templates run as holds it. A
# deployment that has no such permission is a deployment that creates
# no application, and `entra_tenant_enabled` turns the application off.

# The identity of the operator, as the provider of Entra ID knows it.
#
# The application is owned by the operator that creates it: an
# application with no owner is an application that nobody may change,
# and the consent of the tenant and the rotation of its secret are the
# work of its owner.
data "azuread_client_config" "current" {
  count = var.entra_tenant_enabled ? 1 : 0
}

resource "azuread_application" "access" {
  count = var.entra_tenant_enabled ? 1 : 0

  display_name = "${local.prefix}-access"
  description  = "The client of Access at Entra ID, the provider of the identity of the tenant of the deployment."

  # The application is a client of one directory: the tenant of the
  # deployment. An application that signs in the people of other
  # directories is an application that asks for the consent of every
  # one of them, and the tenant of the deployment asks for none.
  sign_in_audience = "AzureADMyOrg"

  owners = [data.azuread_client_config.current[0].object_id]

  # The callback of Access at Entra ID: the address Entra ID sends the
  # browser back to, with the code of the login. It is the only
  # redirect URI of the application, and it is the one the tenant of
  # the deployment registers as its callback at the provider.
  web {
    redirect_uris = [local.entra_redirect_uri]
  }
}

# The enterprise application of Access.
#
# Entra ID creates one when the application is given a redirect URI,
# and the templates take it over when it is there: an enterprise
# application that is already there is the one Entra ID made, and a
# second one cannot be made for the same application.
resource "azuread_service_principal" "access" {
  count = var.entra_tenant_enabled ? 1 : 0

  client_id                    = azuread_application.access[0].client_id
  app_role_assignment_required = false
  use_existing                 = true
}

# The secret of the client of Access at Entra ID.
#
# Access is a confidential client: it exchanges the code of a login
# with the secret of the application, and a client that has no secret
# is refused by the token endpoint of Entra ID.
#
# The secret is rotated by the operator, and by the operator alone: the
# value of the rotation is the key of the secret, and a change of the
# key is a new secret. A rotation is a change of the registration of
# the tenant — the tenant holds the secret of its provider, and the
# secret of the old one is of no use to it — and the registration is
# repeated with the new value.
resource "azuread_application_password" "access" {
  count = var.entra_tenant_enabled ? 1 : 0

  application_id = azuread_application.access[0].id
  display_name   = "${local.prefix}-access-secret"

  rotate_when_changed = {
    rotation = var.entra_secret_rotation
  }
}
