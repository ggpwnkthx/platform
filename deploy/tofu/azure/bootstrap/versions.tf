terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }

  # The state of the bootstrap is local: the bootstrap is the thing that
  # creates the place where the state of the deployment lives. The state
  # of the bootstrap holds the credentials of the storage account of the
  # state, and the operator keeps it out of the repository.
}
