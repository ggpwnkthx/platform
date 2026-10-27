import { describe, expect, test } from 'bun:test'
import { GEOMETRY, MAP_HOPS, MAP_REQUESTS, MAP_STATIONS } from '../src/domains/map'

describe('the map of the platform', () => {
  test('every hop goes from a station to a station', () => {
    const names = new Set(MAP_STATIONS.map((station) => station.name))
    for (const hop of MAP_HOPS) {
      expect(names.has(hop.from)).toBe(true)
      expect(names.has(hop.to)).toBe(true)
    }
  })

  test('every step of a request is a hop that names the request', () => {
    for (const request of MAP_REQUESTS) {
      for (const step of request.steps) {
        const hop = MAP_HOPS.find((entry) => entry.id === step)
        expect(hop?.requests).toContain(request.id)
      }
    }
  })

  test('every station has a lane of its own, and every hop a name', () => {
    const lanes = MAP_STATIONS.map((station) => GEOMETRY.stations[station.id]?.lane)
    expect(new Set(lanes).size).toBe(MAP_STATIONS.length)
    for (const hop of MAP_HOPS) expect(GEOMETRY.hops[hop.id]?.label).toBeTruthy()
  })
})
