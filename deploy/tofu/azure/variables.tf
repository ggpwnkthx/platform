# The inputs of the deployment.
#
# The values that name a thing are variables: the name of the
# deployment, the region it runs in, the images it runs and the public
# names it answers under. The values that carry a credential are not
# variables: the templates generate them and write them into the vault,
# so a deployment that applies the templates has a working set of
# secrets without a step in between.

# --------------------------------------------------------------------------
# The names and the place
# --------------------------------------------------------------------------

variable "name_prefix" {
  description = "The prefix of the name of every resource of the deployment."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name_prefix))
    error_message = "The prefix of the name is lower case, and it starts with a letter."
  }
}

variable "environment" {
  description = "The environment of the deployment: development, staging or production."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "The environment is development, staging or production."
  }
}

variable "location" {
  description = "The region of Azure the deployment runs in."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "The name of the resource group of the deployment."
  type        = string
  default     = ""
}

variable "tenant_id" {
  description = "The identifier of the Entra ID tenant of the deployment."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.tenant_id))
    error_message = "The tenant is the identifier of a directory of Entra ID."
  }
}

# --------------------------------------------------------------------------
# The names that are unique in the whole of Azure
#
# The vault and the registry of the deployment carry a name that nobody
# else in Azure carries. The defaults are the name of the deployment;
# the operator names them when the default name is taken.
# --------------------------------------------------------------------------

variable "key_vault_name" {
  description = "The name of the vault of the deployment. It is unique in Azure."
  type        = string
  default     = ""

  validation {
    condition     = var.key_vault_name == "" || can(regex("^[a-zA-Z][a-zA-Z0-9-]{2,23}$", var.key_vault_name))
    error_message = "The name of the vault is between three and twenty-four characters, and it starts with a letter."
  }
}

variable "registry_name" {
  description = "The name of the registry of the deployment. It is unique in Azure."
  type        = string
  default     = ""

  validation {
    condition     = var.registry_name == "" || can(regex("^[a-zA-Z0-9]{5,50}$", var.registry_name))
    error_message = "The name of the registry is between five and fifty characters, and it carries no dash."
  }
}

# --------------------------------------------------------------------------
# The images
#
# An image is a digest, never a tag: a tag is a name that moves, and the
# deployment of a release has to run the bytes that the gates of the
# release proved.
# --------------------------------------------------------------------------

variable "gateway_image" {
  description = "The image of the gateway, by digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.gateway_image))
    error_message = "The image is a digest: the deployment runs the bytes that the release proved."
  }
}

variable "access_image" {
  description = "The image of Access, by digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.access_image))
    error_message = "The image is a digest: the deployment runs the bytes that the release proved."
  }
}

variable "data_image" {
  description = "The image of Data, by digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.data_image))
    error_message = "The image is a digest: the deployment runs the bytes that the release proved."
  }
}

variable "console_image" {
  description = "The image of the console, by digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.console_image))
    error_message = "The image is a digest: the deployment runs the bytes that the release proved."
  }
}

variable "postgres_client_image" {
  description = "The image of the client of PostgreSQL, by digest. It carries the psql of the operator command."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.postgres_client_image))
    error_message = "The image is a digest: the deployment runs the bytes that the release proved."
  }
}

# --------------------------------------------------------------------------
# The public names
#
# The three public hosts of the deployment: the one the callers reach,
# the issuer of Access and the one the browser reaches.
# --------------------------------------------------------------------------

variable "gateway_hostname" {
  description = "The public name of the gateway, for example api.example.com."
  type        = string
}

variable "access_hostname" {
  description = "The public name of the issuer of Access, for example access.example.com."
  type        = string
}

variable "console_hostname" {
  description = "The public name of the console, for example console.example.com."
  type        = string
}

# --------------------------------------------------------------------------
# The clients of Access
#
# The gateway and the console are clients of Access: Access holds their
# credentials, and the identifiers below are the ones the deployment
# registers with the administration API of Access.
# --------------------------------------------------------------------------

variable "gateway_client_id" {
  description = "The identifier of the gateway as a client of Access."
  type        = string
  default     = "gateway"
}

variable "console_client_id" {
  description = "The identifier of the console as a client of Access."
  type        = string
  default     = "console"
}

# --------------------------------------------------------------------------
# The route table
# --------------------------------------------------------------------------

variable "route_id" {
  description = "The identifier of the route that forwards to Data."
  type        = string
  default     = "data-api"
}

variable "workspace_path_prefix" {
  description = "The path prefix of the workspace, as the route table names it."
  type        = string
  default     = "/ws/{workspaceId}/"
}

# --------------------------------------------------------------------------
# The tenant and the workspace
#
# The tenant is a record of Access, and the workspace is a record of
# Data. The templates do not create them: the platform creates them
# through the administration API of Access, and the identifiers they
# carry are the ones the deployment tells the templates about.
# --------------------------------------------------------------------------

variable "access_tenant_id" {
  description = "The identifier of the tenant of Access."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.access_tenant_id))
    error_message = "The tenant is the identifier that Access gave the deployment."
  }
}

variable "data_workspace_id" {
  description = "The identifier of the workspace of Data."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.data_workspace_id))
    error_message = "The workspace is the identifier that the deployment registered."
  }
}

variable "data_workspace_slug" {
  description = "The slug of the workspace of Data."
  type        = string
  default     = "acme"
}

# --------------------------------------------------------------------------
# The size of the services
# --------------------------------------------------------------------------

variable "services" {
  description = "The size of every service of the deployment."
  type = map(object({
    min_replicas = number
    max_replicas = number
    cpu          = number
    memory       = string
  }))
  default = {
    gateway = { min_replicas = 2, max_replicas = 5, cpu = 0.5, memory = "1Gi" }
    access  = { min_replicas = 2, max_replicas = 5, cpu = 0.5, memory = "1Gi" }
    data    = { min_replicas = 2, max_replicas = 6, cpu = 1.0, memory = "2Gi" }
    console = { min_replicas = 1, max_replicas = 2, cpu = 0.5, memory = "1Gi" }
  }

  validation {
    condition     = alltrue([for service in var.services : service.max_replicas >= service.min_replicas])
    error_message = "A service has at least as many replicas at its ceiling as at its floor."
  }
}

# --------------------------------------------------------------------------
# The PostgreSQL
# --------------------------------------------------------------------------

variable "postgresql_version" {
  description = "The version of PostgreSQL the deployment runs."
  type        = string
  default     = "17"
}

variable "postgresql_sku_name" {
  description = "The size of the server of PostgreSQL."
  type        = string
  default     = "GP_Standard_D2s_v3"
}

variable "postgresql_storage_mb" {
  description = "The storage of the server of PostgreSQL, in megabytes."
  type        = number
  default     = 32768
}

variable "postgresql_high_availability" {
  description = "Whether the server of PostgreSQL is zone redundant."
  type        = bool
  default     = true
}

variable "postgresql_backup_retention_days" {
  description = "The number of days the backups of the deployment are kept."
  type        = number
  default     = 7
}

# --------------------------------------------------------------------------
# The Redis
#
# The cache of the deployment holds the sessions of the callers, the
# windows of the limits and the decisions that Access answered. The
# tier is Premium: the tier that holds more than one database and that
# knows the access control list of the users.
# --------------------------------------------------------------------------

variable "redis_sku_name" {
  description = "The size of the cache of Redis."
  type        = string
  default     = "P1"
}

variable "redis_capacity" {
  description = "The number of shards of the cache of Redis."
  type        = number
  default     = 1
}

variable "redis_version" {
  description = "The version of Redis the deployment runs."
  type        = string
  default     = "6"
}

# --------------------------------------------------------------------------
# The edge
# --------------------------------------------------------------------------

variable "frontdoor_sku_name" {
  description = "The size of the profile of Front Door."
  type        = string
  default     = "Standard_Azure"
}

variable "trusted_proxy_cidrs" {
  description = "The addresses of the proxies of the deployment, as the gateway is told."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.trusted_proxy_cidrs : can(cidrnetmask(cidr))
    ])
    error_message = "Every address of a proxy is a range, in the notation of a network."
  }
}
