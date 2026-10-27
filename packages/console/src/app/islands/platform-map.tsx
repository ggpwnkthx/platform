/**
 * The map of the platform.
 *
 * The participants of a request stand in lanes, in the order of the
 * flow, and the exchanges of a request are the rows that cross from one
 * lane to another. A reader picks a request — a record, a sign-in, a
 * change of a grant — and the map lights the exchanges it crosses, in
 * order; every exchange is also a row of the table under the drawing.
 *
 * The server renders the request of the url, so the map is a document
 * before it is an instrument.
 */

import { useState } from 'hono/jsx'
import type { Hop, MapRequest, Station } from '../../domains/map'

interface Geometry {
  readonly stations: Readonly<Record<string, { lane: number; kind: string }>>
  readonly hops: Readonly<Record<string, { label: string }>>
}

const LANE = 112
const LEFT = 16
const TOP = 74
const ROW = 38

/** The lines of a name that fits in a box of a lane. */
function linesOf(name: string, width = 17): string[] {
  const words = name.replace(/^The /, '').split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

export default function PlatformMap(props: {
  stations: readonly Station[]
  hops: readonly Hop[]
  requests: readonly MapRequest[]
  geometry: Geometry
  initialRequest: string
}) {
  const [chosen, setChosen] = useState(props.initialRequest)
  const [focus, setFocus] = useState<string | null>(null)

  const byName = new Map(props.stations.map((station) => [station.name, station]))
  const request = props.requests.find((entry) => entry.id === chosen) ?? null
  const steps = request
    ? request.steps
    : [...new Set(props.requests.flatMap((entry) => entry.steps))].concat(
        props.hops
          .map((hop) => hop.id)
          .filter((id) => !props.requests.some((entry) => entry.steps.includes(id)))
      )
  const rows = steps
    .map((id) => props.hops.find((hop) => hop.id === id))
    .filter((hop): hop is Hop => hop !== undefined)

  const laneOf = (name: string): number => {
    const station = byName.get(name)
    return station ? (props.geometry.stations[station.id]?.lane ?? 0) : 0
  }
  const xOf = (lane: number): number => LEFT + lane * LANE + LANE / 2
  const lanes = [...props.stations].sort(
    (left, right) =>
      (props.geometry.stations[left.id]?.lane ?? 0) - (props.geometry.stations[right.id]?.lane ?? 0)
  )
  const width = LEFT * 2 + lanes.length * LANE
  const height = TOP + rows.length * ROW + 24

  const choose = (id: string) => (event: Event) => {
    event.preventDefault()
    setChosen(id)
    setFocus(null)
    const url = new URL(location.href)
    if (id) url.searchParams.set('request', id)
    else url.searchParams.delete('request')
    history.replaceState(null, '', url)
  }

  return (
    <section class="map" aria-label="The map of the platform">
      <div class="row spread">
        <nav class="segmented" aria-label="The requests">
          <a
            href="?request="
            aria-current={chosen === '' ? 'true' : undefined}
            onClick={choose('')}
          >
            Every exchange
          </a>
          {props.requests.map((entry) => (
            <a
              href={`?request=${entry.id}`}
              aria-current={chosen === entry.id ? 'true' : undefined}
              onClick={choose(entry.id)}
            >
              {entry.label}
            </a>
          ))}
        </nav>
        <span class="small muted">{rows.length} exchanges, read from the top to the bottom</span>
      </div>
      {request?.note ? <p class="lede small">{request.note}</p> : null}
      <div class="map-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="The lanes of the platform">
          {lanes.map((station) => {
            const lane = props.geometry.stations[station.id]?.lane ?? 0
            const x = xOf(lane)
            const lines = linesOf(station.name)
            return (
              <g class="lane">
                <title>{`${station.name}: ${station.what}`}</title>
                <line x1={x} x2={x} y1={58} y2={height - 8} />
                <rect x={x - 50} y={8} width={100} height={50} rx={6} />
                <text class="kind" x={x} y={21} text-anchor="middle">
                  {props.geometry.stations[station.id]?.kind ?? station.kind}
                </text>
                {lines.map((text, index) => (
                  <text x={x} y={34 + index * 11} text-anchor="middle">
                    {text}
                  </text>
                ))}
              </g>
            )
          })}
          {rows.map((hop, index) => {
            const from = xOf(laneOf(hop.from))
            const to = xOf(laneOf(hop.to))
            const y = TOP + index * ROW + 16
            const direction = to >= from ? 1 : -1
            const tip = to - direction * 3
            const lit = request !== null || focus === hop.id
            const dim = focus !== null && focus !== hop.id
            return (
              // biome-ignore lint/a11y/useSemanticElements: an exchange is a group of an svg drawing, and an svg holds no button.
              <g
                class={`hop ${hop.store ? 'store' : ''} ${lit ? 'lit' : ''} ${dim ? 'dim' : ''}`}
                role="button"
                tabindex={0}
                aria-pressed={focus === hop.id ? 'true' : 'false'}
                onClick={() => setFocus(focus === hop.id ? null : hop.id)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setFocus(focus === hop.id ? null : hop.id)
                }}
              >
                <title>{`${hop.from} → ${hop.to}: ${hop.contract}`}</title>
                <line x1={from} x2={tip - direction * 6} y1={y} y2={y} />
                <polygon
                  points={`${tip},${y} ${tip - direction * 8},${y - 4} ${tip - direction * 8},${y + 4}`}
                />
                <text x={(from + to) / 2} y={y - 6} text-anchor="middle">
                  {request ? `${index + 1}. ` : ''}
                  {props.geometry.hops[hop.id]?.label ?? hop.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Exchange</th>
              <th>Contract</th>
              <th>Carries</th>
              <th>Decides</th>
              <th>Refuses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((hop, index) => (
              <tr
                onClick={() => setFocus(focus === hop.id ? null : hop.id)}
                aria-selected={focus === hop.id ? 'true' : undefined}
                style={focus === hop.id ? 'outline: 2px solid var(--accent)' : undefined}
              >
                <td class="num">{index + 1}</td>
                <td>
                  <strong>{props.geometry.hops[hop.id]?.label ?? hop.id}</strong>
                  <div class="small muted">
                    {hop.from} → {hop.to}
                  </div>
                </td>
                <td>
                  {/^(?:[A-Z]+ |\/)/.test(hop.contract) ? (
                    <code>{hop.contract}</code>
                  ) : (
                    hop.contract
                  )}
                </td>
                <td>{hop.carries}</td>
                <td>{hop.decides}</td>
                <td>{hop.refuses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
