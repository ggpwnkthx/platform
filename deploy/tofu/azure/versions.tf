terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    azuread = { source = "hashicorp/azuread", version = "~> 2.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    tls     = { source = "hashicorp/tls", version = "~> 4.0" }
  }

  # The state of a deployment holds the credentials of the deployment:
  # the templates write the secrets of the platform into the vault, and
  # the value of a secret is in the state. The state is therefore a
  # secret store, and it lives in the storage of the deployment, which
  # the bootstrap stack in `bootstrap/` creates.
  #
  #   tofu -chdir=deploy/tofu/azure init \
  #     -backend-config=../../runtime/<environment>/backend.hcl
  #
  # The state is never committed, and the runtime directory that holds
  # the configuration of the backend is not committed either.
  backend "azurerm" {}
}
