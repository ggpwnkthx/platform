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
}

# The identity provider of the deployment is Entra ID: the templates
# create the application of Access, the broker of the platform, in the
# tenant of the deployment.
provider "azuread" {}

# The secrets of the deployment are generated, and the key that signs
# the identity of a request is a pair of elliptic curve keys.
provider "random" {}
provider "tls" {}
