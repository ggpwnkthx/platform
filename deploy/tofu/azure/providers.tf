# The providers of the deployment.
#
# The templates do not register the resource providers of the
# subscription: registering one is a permission that a deployment of the
# platform does not need and does not have. The list of the providers
# the deployment needs is in the README of this directory, and the
# operator registers them once, before the first apply.
provider "azurerm" {
  features {}

  resource_provider_registrations = "none"

  # The resources of the deployment are written in the subscription of
  # the deployment, and in no other: a provider that takes the
  # subscription of the session writes the resources of the deployment
  # wherever the session of the operator happens to point at. The
  # wizard of the deployment writes the subscription of the deployment
  # in the values of the deployment, and a value that is empty takes
  # the subscription of the session.
  subscription_id = var.subscription_id != "" ? var.subscription_id : null

  # The tenant of the deployment is the tenant of the subscription of
  # the deployment: the vault of the deployment lives in it, and the
  # provider of the identity writes the application of Access in it.
  tenant_id = var.tenant_id
}

# The identity provider of the deployment is Entra ID: the templates
# create the application of Access, the broker of the platform, in the
# tenant of the deployment, and not in the tenant of the session of the
# operator.
provider "azuread" {
  tenant_id = var.tenant_id
}

# The secrets of the deployment are generated, and the key that signs
# the identity of a request is a pair of elliptic curve keys.
provider "random" {}
provider "tls" {}
