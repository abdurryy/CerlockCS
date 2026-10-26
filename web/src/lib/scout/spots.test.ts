import { describe, expect, it } from 'vitest'
import type { MapInfo } from '../types'
import { cfgName, findSpots, spotCommand, spotsCfg } from './spots'
import type { RoleCard, Situation, SituationTrack, TrackPlayer } from './types'

const N = 241
const info: MapInfo = {
  name: 'de_test',
  posX: -3000,
  posY: 3000,
  scale: 5,
  size: 1024,
  levels: [{ name: 'default', altitudeMin: -10000, altitudeMax: 10000, image: '' }],
  known: true,
} as MapInfo

// player stands at (x, y) radar, looking yaw, the whole round.
function player(id: string, x: number, y: number, yaw: number, alive = true): TrackPlayer {
  return {
    steamId: id,
    name: id,
    color: '#ffffff',
    xs: new Float32Array(N).fill(x),
    ys: new Float32Array(N).fill(y),
    zs: new Float32Array(N).fill(-120),
    yaw: new Float32Array(N).fill(yaw),
    alive: new Uint8Array(N).fill(alive ? 1 : 0),
  }
}

function track(round: number, players: TrackPlayer[]): SituationTrack {
  return { replayId: 'r', round, label: `Round ${round}`, won: true, hit: '', hitTime: -1, players, events: [] }
}

function situation(side: 'ct' | 't', tracks: SituationTrack[]): Situation {
  return { key: `${side}-full`, side, buy: 'full', title: '', rounds: tracks.length, won: 0, rushes: 0, hits: [], noHit: 0, stacks: [], pushes: 0, saves: 0, heat10: { size: 1, levels: [], samples: 0 }, heat20: { size: 1, levels: [], samples: 0 }, tracks, notes: [] }
}

function role(id: string, name = id): RoleCard {
  return { steamId: id, name, color: '#ffffff', ct: {} as RoleCard['ct'], t: {} as RoleCard['t'], confidence: 'high', notes: [] }
}

describe('findSpots', () => {
  it('finds the spot a player keeps going back to, in world units', () => {
    const sits = [
      situation('ct', [track(1, [player('a', 100, 100, 80)]), track(2, [player('a', 102, 99, 90)]), track(3, [player('a', 101, 101, 100)]), track(4, [player('a', 400, 400, 0)])]),
    ]
    const spots = findSpots({ info, situations: sits, roles: [role('a', 'ZoRoBeast')] })
    expect(spots).toHaveLength(1)
    const s = spots[0]
    expect(s.rounds).toBe(3)
    expect(s.of).toBe(4)
    expect(s.side).toBe('ct')
    // The centre is a real sample, the one with the most around it.
    expect(s.x).toBeCloseTo(100 * 5 - 3000, 0)
    expect(s.y).toBeCloseTo(3000 - 100 * 5, 0)
    expect(s.yaw).toBeCloseTo(90, 3)
    expect(s.alias).toBe('ct_zorobeast_1')
    expect(spotCommand(s)).toBe('setpos -2500.0 2500.0 -119.0; setang 0 90.0 0')
  })

  it('averages yaw across 0 the short way', () => {
    const sits = [situation('ct', [track(1, [player('a', 100, 100, 350)]), track(2, [player('a', 100, 100, 10)])])]
    const [s] = findSpots({ info, situations: sits, roles: [role('a')] })
    expect(Math.abs(((s.yaw + 540) % 360) - 180)).toBeLessThan(1e-3)
  })

  it('skips the dead and keeps a single round when that is all there is', () => {
    const sits = [
      situation('t', [track(1, [player('a', 50, 50, 0), player('b', 10, 10, 0, false)])]),
    ]
    const spots = findSpots({ info, situations: sits, roles: [role('a'), role('b')] })
    expect(spots.map((s) => `${s.alias} ${s.rounds}/${s.of}`)).toEqual(['t_a_1 1/1'])
  })

  it('needs 2 rounds once a player has played 3 or more', () => {
    const sits = [situation('ct', [track(1, [player('a', 0, 0, 0)]), track(2, [player('a', 300, 300, 0)]), track(3, [player('a', 600, 600, 0)])])]
    expect(findSpots({ info, situations: sits, roles: [role('a')] })).toEqual([])
  })

  it('gives two players with the same name their own aliases', () => {
    const sits = [situation('ct', [track(1, [player('a', 0, 0, 0), player('b', 300, 300, 0)])])]
    const spots = findSpots({ info, situations: sits, roles: [role('a', 'Carl'), role('b', 'carl')] })
    expect(spots.map((s) => s.alias)).toEqual(['ct_carl_1', 'ct_carl_2_1'])
  })
})

describe('spotsCfg', () => {
  it('writes aliases the console can read', () => {
    const sits = [situation('ct', [track(1, [player('a', 100, 100, 90)]), track(2, [player('a', 100, 100, 90)])])]
    const spots = findSpots({ info, situations: sits, roles: [role('a', 'Zo"Ro;Beast')] })
    const cfg = spotsCfg('de_nuke', 'Nuke', 'E-ManiacS', 3, spots)
    expect(cfgName('de_nuke', 'E-ManiacS')).toBe('cerlock_nuke_e_maniacs')
    expect(cfg).toContain('exec cerlock_nuke_e_maniacs')
    expect(cfg).toContain('sv_cheats 1')
    expect(cfg).toContain('alias ct_zo_ro_beast_1 "setpos -2500.0 2500.0 -119.0; setang 0 90.0 0; echo ZoRoBeast, CT, 2 of 2 rounds"')
    expect(cfg).toContain('alias cerlock_spot_1 "ct_zo_ro_beast_1; alias spot_next cerlock_spot_1"')
    // No alias line has quotes inside its quotes.
    for (const line of cfg.split('\n').filter((l) => l.startsWith('alias '))) expect([1, 3]).toContain(line.split('"').length)
  })
})
