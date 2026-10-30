# The place where the state of the deployment lives.
#
# The state of a deployment holds the value of every secret of the
# deployment, so the state is a secret store. The store of Azure is
# encrypted at rest, it keeps the versions of the state, and the access
# to it is a role of Entra ID.
#
# The bootstrap runs once per deployment, before the first apply of the
# templates, and it is the only stack that runs without a backend:
#
#   tofu -chdir=deploy/tofu/azure/bootstrap init
#   tofu -chdir=deploy/tofu/azure/bootstrap apply
#
# The outputs of the bootstrap are the configuration of the backend of
# the deployment. Write them to the runtime directory of the deployment
# as `backend.hcl`.

provider "azurerm" {
  features {}

  resource_provider_registrations = "none"
}

variable "name_prefix" {
  description = "The prefix of the name of every resource of the deployment."
  type        = string
  default     = "platform"
}

variable "environment" {
  description = "The environment of the deployment."
  type        = string
  default     = "production"
}

variable "location" {
  description = "The region of Azure the deployment runs in."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "The name of the resource group of the deployment."
  type        = string
  default     = "platform-production"
}

variable "operator_addresses" {
  description = "The addresses that reach the account of the state. They are the addresses of the operator of the deployment."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for address in var.operator_addresses : can(cidrhost(address, 0))
    ])
    error_message = "Every address of the operator is a range, in the notation of a network."
  }
}

locals {
  prefix = "${var.name_prefix}-${var.environment}"
  name   = replace("${local.prefix}state", "-", "")
}

resource "azurerm_resource_group" "state" {
  name     = var.resource_group_name
  location = var.location
}

# The storage of the state. It is not anonymous and it is not open: the
# shared key of the account is off, the access is a role of Entra ID, and
# the only addresses that reach the account are the addresses of the
# operator of the deployment.
#
# The account is not published behind a private endpoint: the private
# endpoint of the state would live in the network of the deployment, and
# the network is created by the templates that the state is for. The
# operator that applies the first deployment is the one that reaches the
# account, and it reaches it over the address it is given.
resource "azurerm_storage_account" "state" {
  name                = local.name
  resource_group_name = azurerm_resource_group.state.name
  location            = azurerm_resource_group.state.location

  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  min_tls_version = "TLS1_2"

  # The state is a secret store: the shared key of the account is off,
  # and the access is a role of Entra ID.
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = true

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
    ip_rules       = var.operator_addresses
  }

  blob_properties {
    versioning_enabled = true

    # A state that is deleted by accident is a deployment that cannot
    # be read any more.
    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  tags = {
    application = "platform"
    component   = var.environment
    managed-by  = "opentofu"
  }
}

# The container of the state.
resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_name  = azurerm_storage_account.state.name
  container_access_type = "private"
}

# The configuration of the backend of the deployment.
output "backend_config" {
  description = "The configuration of the backend of the state of the deployment."
  value = {
    resource_group_name  = azurerm_resource_group.state.name
    storage_account_name = azurerm_storage_account.state.name
    container_name       = azurerm_storage_container.state.name
    use_azuread_auth     = true
  }
}

output "backend_config_hcl" {
  description = "The configuration of the backend, as it is written to backend.hcl."
  value = join("\n", [
    "resource_group_name  = \"${azurerm_resource_group.state.name}\"",
    "storage_account_name = \"${azurerm_storage_account.state.name}\"",
    "container_name       = \"${azurerm_storage_container.state.name}\"",
    "use_azuread_auth     = true",
  ])
}
