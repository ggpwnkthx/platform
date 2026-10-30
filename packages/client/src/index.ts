/**
 * The clients of the platform.
 *
 * The console and the CLI are clients of the same services: the
 * gateway, Access and Data. They are the two clients of the platform,
 * and they speak to the same contracts.
 *
 * The clients of the platform live here, once: the paths of the
 * contracts, the queries they take, the headers they carry and the
 * refusals they answer. The console and the CLI keep what is theirs —
 * the way they show a refusal, the way they print an answer, the
 * transport they speak with — and they read the contracts here.
 *
 * The services of the platform share nothing with them: they are
 * separate deployments, and they talk over HTTP (decision 2 of
 * `docs/platform/decisions.md`).
 */

export {
  AccessAdminClient,
  AccessClient,
  AccessContextClient,
  type AccessClientOptions,
  type AdminQuery,
  type ContextQuestion,
  decide,
} from './access'
export {
  DataClient,
  type AggregateQuery,
  type DataCallOptions,
  type DataClientOptions,
  type ListQuery,
  type Validated,
} from './data'
export {
  overallOf,
  probeOf,
  type ProbeAnswer,
  probeService,
  type ProbeTarget,
  type ServiceState,
  type ServiceStatus,
  stateOf,
  summaryOf,
  versionOf,
} from './probes'
export {
  bodyOf,
  type ClientAnswer,
  ClientError,
  type ClientMethod,
  type ClientRequest,
  type ClientTransport,
  expectSuccess,
  isSuccess,
  queryOf,
  refusalOf,
  requestIdOf,
} from './transport'
export type {
  AccessContext,
  AdminPage,
  Aggregate,
  AuditEntry,
  AuditRecord,
  BatchOutcome,
  CollectionMetadata,
  FieldAttributes,
  FieldMetadata,
  Grant,
  GrantInput,
  Group,
  GroupInput,
  Me,
  Model,
  ModelCollection,
  ModelField,
  Page,
  Principal,
  PrincipalInput,
  RecordValue,
  RelationAttributes,
  Role,
  RoleInput,
  SchemaMetadata,
  Tenant,
  TenantInput,
  VersionEntry,
} from './types'
