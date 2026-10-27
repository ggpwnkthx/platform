/**
 * The drawing of the map: the lanes of the participants and the names of
 * the exchanges.
 *
 * The participants of a request stand in lanes, in the order of the flow,
 * and the exchanges of a request are the rows that cross from one lane to
 * another: in lanes, no two lines cross, and a request reads from the top
 * to the bottom. The names of the exchanges are the names of the story of
 * the platform — *the credential*, *the access*, *the rows* — and the
 * atlas draws them with the same words.
 */

/** The drawing of a station: its lane, and the kind it is drawn with. */
export interface StationShape {
  readonly lane: number
  readonly kind: string
}

/** The drawing of a hop: the name it is drawn with. */
export interface HopShape {
  readonly label: string
}

/** The drawing of the map. */
export const GEOMETRY: {
  readonly stations: Readonly<Record<string, StationShape>>
  readonly hops: Readonly<Record<string, HopShape>>
} = {
  stations: {
    browser: { lane: 0, kind: 'a caller' },
    console: { lane: 1, kind: 'a caller' },
    gateway: { lane: 2, kind: 'a service' },
    'gateway-db': { lane: 3, kind: 'PostgreSQL' },
    shared: { lane: 4, kind: 'Redis' },
    access: { lane: 5, kind: 'a service' },
    provider: { lane: 6, kind: 'a provider' },
    'access-db': { lane: 7, kind: 'PostgreSQL' },
    data: { lane: 8, kind: 'a service' },
    'data-db': { lane: 9, kind: 'PostgreSQL' },
  },
  hops: {
    call: { label: 'the credential' },
    'login-page': { label: 'the sign-in' },
    counters: { label: 'the route table and the limits' },
    sessions: { label: 'the session' },
    decision: { label: 'the decision' },
    login: { label: 'the tenant' },
    forward: { label: 'the signed request' },
    provider: { label: 'the authorization code' },
    codes: { label: 'the login codes' },
    token: { label: 'the identity' },
    context: { label: 'the permissions' },
    rows: { label: 'the rows' },
    'console-access': { label: 'the administration' },
    'console-context': { label: "the operator's scope" },
    grants: { label: 'the grants' },
  },
}
