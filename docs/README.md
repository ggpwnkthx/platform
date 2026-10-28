# Documentation

Documentation for the platform's gateway, access service, data service and console. Follow the reading path below, or jump to an area. Each service's spec is normative: where another page disagrees, the spec wins.

## Reading path

1. **Understand**: [Platform](platform/README.md) for how the pieces fit, and the [atlas](platform/atlas.html) for the whole platform on one page, with a request walked across it.
2. **Run it locally**: [Quickstart](platform/quickstart.md), then [Development](platform/development.md).
3. **Deploy**: [Platform operations](platform/operations.md), then each service's operations page.
4. **Integrate**: put a service behind the gateway with [Upstream identity](gateway/upstream-identity.md); administer tenants and grants with the [Access API](access/api.md); read and write workspace data with the [Data client](data/client.md) or [Data API](data/api.md).
5. **Reference**: the specs of the [gateway](gateway/spec.md), [access service](access/spec.md), [data service](data/spec.md) and [console](console/spec.md).

## Areas

| Area | What it covers |
| --- | --- |
| [Platform](platform/README.md) | How the services fit, quickstart, development, deployment, security, repository internals |
| [Gateway](gateway/README.md) | Authenticates callers, asks the access service, forwards to the matched route's upstream |
| [Access service](access/README.md) | Signs callers in at each tenant's provider, maps them to principals, answers the gateway's decisions |
| [Data service](data/README.md) | Workspace data behind data policies: collections, records, audit, events |
| [Console](console/README.md) | The web interface for data, administration, status and these docs |

Within each area, pages are grouped the same way: an overview, guides, reference (spec, API, configuration), and internals for maintainers.
