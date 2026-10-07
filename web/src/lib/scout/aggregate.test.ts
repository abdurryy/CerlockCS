import { describe, expect, it } from 'vitest'
import { FLAG, Replay } from '../replay'
import type { MapInfo, Player, Round } from '../types'
import { Binner, findRoster, liveStart, newGrid, ScoutBuilder, scoutLabels, shares, sideIn, topSetups } from './aggregate'
import type { RosterPlayer } from './types'

type Col = { name: string; type: 'u8' | 'i16' | 'u16' | 'i32'; data: ArrayLike<number> }

const ctor = { u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array }

// build writes a replay the same way internal/replay does.
function build(cols: Col[], frames: number, match: object, rounds: object[]): ArrayBuffer {
  const align = (n: number) => (n + 7) & ~7
  let rel = 0
  const offsets: number[] = []
  for (const c of cols) {
    offsets.push(rel)
    rel = align(rel + c.data.length * ctor[c.type].BYTES_PER_ELEMENT)
  }
  const header = (base: number) =>
    JSON.stringify({
      version: 2, frames, match, extra: { analysis: { players: [], teams: [], rounds, insights: [], aim: [], blunders: [] }, parseMs: 1 },
      columns: Object.fromEntries(cols.map((c, i) => [c.name, { type: c.type, offset: base + offsets[i], length: c.data.length }])),
    })
  const base = align(12 + new TextEncoder().encode(header(100000)).length + 64)
  const json = new TextEncoder().encode(header(base))
  const buf = new ArrayBuffer(base + rel)
  const dv = new DataView(buf)
  new Uint8Array(buf).set(new TextEncoder().encode('CRLK'), 0)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, json.length, true)
  new Uint8Array(buf).set(json, 12)
  cols.forEach((c, i) => new ctor[c.type](buf, base + offsets[i], c.data.length).set(Array.from(c.data)))
  return buf
}

// Frames every 16 ticks, so four frames a second at 64 tick.
const TICK = 16
const PLACES = ['', 'BombsiteA', 'Ramp', 'Outside', 'BombsiteB', 'Lower']

interface Pos {
  x: number
  y: number
  z: number
  place: number
  alive: boolean
}

// Test match: round 0 has team 0 on CT, round 1 has team 0 on T. By
// default players 0, 1 and 2 are team 0, players 3 and 4 team 1.
function match(at: (p: number, f: number, round: number) => Pos, players: Partial<Player>[]): Replay {
  const R0 = { startTick: 0, freezeEndTick: 160, endTick: 160 + 64 * 40 }
  const R1 = { startTick: 2800, freezeEndTick: 2960, endTick: 2960 + 64 * 40 }
  const frames = Math.ceil(R1.endTick / TICK) + 2
  const n = players.length
  const teamOf = players.map((p, i) => p.team ?? (i < 3 ? 0 : 1))
  const sides = [[3, 2], [2, 3]]
  const tick = new Int32Array(frames)
  const x = new Int16Array(frames * n)
  const y = new Int16Array(frames * n)
  const z = new Int16Array(frames * n)
  const flags = new Uint16Array(frames * n)
  const side = new Uint8Array(frames * n)
  const place = new Uint8Array(frames * n)
  const weapon = new Uint16Array(frames * n)
  for (let f = 0; f < frames; f++) {
    tick[f] = f * TICK
    const round = tick[f] >= R1.startTick ? 1 : 0
    for (let p = 0; p < n; p++) {
      const s = at(p, f, round)
      const i = p * frames + f
      x[i] = s.x
      y[i] = s.y
      z[i] = s.z
      flags[i] = s.alive ? FLAG.alive : 0
      side[i] = sides[round][teamOf[p]]
      place[i] = s.place
      // Player 1 carries the AWP on CT side.
      weapon[i] = p === 1 && round === 0 ? 309 : 303
    }
  }
  const rounds = [
    { number: 1, ...R0, officialEndTick: R0.endTick, sideOf: [3, 2], winner: 3, winnerTeam: 0, players: null },
    { number: 2, ...R1, officialEndTick: R1.endTick, sideOf: [2, 3], winner: 3, winnerTeam: 1, players: null },
  ]
  const m = {
    map: 'de_test', tickRate: 64,
    players: players.map((p, i) => ({ index: i, name: `p${i}`, steamId: `${100 + i}`, team: teamOf[i], isBot: false, ...p })),
    teams: [{ name: 'A', score: 1 }, { name: 'B', score: 1 }],
    rounds,
    kills: [
      // Round 0: Ace (CT) opens on player 4.
      { tick: 500, round: 0, killer: 0, victim: 4, weapon: 303, headshot: true, killerSide: 3, victimSide: 2, killerPos: [100, 900, 0], victimPos: [300, 700, 0], killerPlace: 'BombsiteA', victimPlace: 'Ramp' },
      // Round 1: player 3 (CT) opens on Bee, then Ace trades.
      { tick: 3000, round: 1, killer: 3, victim: 1, weapon: 309, headshot: false, killerSide: 3, victimSide: 2, killerPos: [520, 520, 0], victimPos: [300, 300, 0], killerPlace: 'BombsiteB', victimPlace: 'Outside' },
      { tick: 3700, round: 1, killer: 0, victim: 3, weapon: 303, headshot: false, killerSide: 2, victimSide: 3, killerPos: [500, 500, 0], victimPos: [520, 520, 0], killerPlace: 'BombsiteB', victimPlace: 'BombsiteB' },
    ],
    places: PLACES,
    grenades: [
      // Roster smoke 5 s before the hit.
      { id: 0, type: 505, thrower: 0, side: 2, round: 1, throwTick: 3200, effectTick: 3280, endTick: 4400, pos: [400, 300, 0], pathStart: 0, pathLen: 0 },
      // Roster flash long after the hit.
      { id: 1, type: 504, thrower: 1, side: 2, round: 1, throwTick: 4400, effectTick: 4500, endTick: 4500, pos: [300, 300, 0], pathStart: 0, pathLen: 0 },
      // Not from the roster.
      { id: 2, type: 505, thrower: 2, side: 2, round: 1, throwTick: 3200, effectTick: 3300, endTick: 4400, pos: [420, 300, 0], pathStart: 0, pathLen: 0 },
      // Roster utility on CT side does not count for executes.
      { id: 3, type: 506, thrower: 0, side: 3, round: 0, throwTick: 400, effectTick: 500, endTick: 500, pos: [100, 100, 0], pathStart: 0, pathLen: 0 },
    ],
    bombEvents: [{ tick: 4000, round: 1, kind: 'planted', player: 0, site: 'B', pos: [500, 500, 0] }],
  }
  const report = [
    { round: 0, hit: '', hitTime: -1, buyType: ['pistol', 'pistol'] },
    // The first T on a site: B after 10 s, so the hit tick is 3600.
    { round: 1, hit: 'B', hitTime: 10, buyType: ['eco', 'full'] },
  ]
  return new Replay(
    build(
      [
        { name: 'frame.tick', type: 'i32', data: tick },
        { name: 'player.x', type: 'i16', data: x },
        { name: 'player.y', type: 'i16', data: y },
        { name: 'player.z', type: 'i16', data: z },
        { name: 'player.flags', type: 'u16', data: flags },
        { name: 'player.side', type: 'u8', data: side },
        { name: 'player.place', type: 'u8', data: place },
        { name: 'player.weapon', type: 'u16', data: weapon },
      ],
      frames,
      m,
      report,
    ),
  )
}

const INFO: MapInfo = {
  name: 'de_test', posX: 0, posY: 1024, scale: 1, size: 1024, known: true,
  levels: [{ name: 'default', altitudeMin: -1e6, altitudeMax: 1e6, image: '' }],
}

// Where everyone is. Team 0 is CT in round 0: player 0 holds A, player 1
// holds Ramp and dies at frame 60, player 2 also plays Ramp. In round 1
// team 0 is T: player 0 walks onto B at the hit (frame 225), player 1
// lurks Outside, player 2 stays Outside.
function story(p: number, f: number, round: number): Pos {
  if (round === 0) {
    if (p === 0) return { x: 100, y: 900, z: 0, place: 1, alive: true }
    if (p === 1) return { x: 200, y: 900, z: 0, place: 2, alive: f < 60 }
    if (p === 2) return { x: 210, y: 900, z: 0, place: 2, alive: true }
    return { x: 800, y: 200, z: 0, place: 3, alive: true }
  }
  if (p === 0) return f >= 225 ? { x: 500, y: 500, z: 0, place: 4, alive: true } : { x: 400, y: 300, z: 0, place: 3, alive: true }
  if (p === 1 || p === 2) return { x: 300, y: 300, z: 0, place: 3, alive: true }
  return { x: 520, y: 520, z: 0, place: 4, alive: true }
}

const PLAYERS: Partial<Player>[] = [{}, {}, {}, {}, {}]

// Roster: players 0 and 1 of team 0, and player 3 who played for the
// other team in this match.
const ROSTER: RosterPlayer[] = [
  { steamId: '101', name: 'Bee' },
  { steamId: '100', name: 'Ace' },
  { steamId: '103', name: 'Cee' },
  { steamId: '999', name: 'Absent' },
]

describe('findRoster', () => {
  const players = (teams: number[]): Player[] =>
    teams.map((team, i) => ({ index: i, steamId: `${100 + i}`, name: `p${i}`, team, isBot: false }))

  it('picks the team most of the roster was on', () => {
    expect(findRoster(players([0, 0, 0, 1, 1]), ROSTER)).toEqual({ team: 0, players: [1, 0] })
    expect(findRoster(players([1, 1, 0, 1, 0]), ROSTER)).toEqual({ team: 1, players: [1, 0, 3] })
  })

  it('returns -1 when nobody played', () => {
    expect(findRoster(players([0, 1]), [{ steamId: '5', name: 'x' }])).toEqual({ team: -1, players: [] })
  })

  it('ignores bots and empty ids', () => {
    const ps = players([0, 0])
    ps[0].steamId = '0'
    expect(findRoster(ps, [{ steamId: '0', name: 'bot' }, { steamId: ' ', name: 'blank' }])).toEqual({ team: -1, players: [] })
  })
})

describe('sideIn', () => {
  const rd = { sideOf: [3, 2], players: null } as unknown as Round
  it('uses the team side when there is no player list', () => {
    expect(sideIn(rd, 4, 0)).toBe(3)
    expect(sideIn(rd, 4, 1)).toBe(2)
  })

  it('uses the player list when there is one', () => {
    const withList = { ...rd, players: [{ player: 1, side: 2 }] } as unknown as Round
    expect(sideIn(withList, 1, 0)).toBe(2)
    expect(sideIn(withList, 2, 0)).toBe(0)
  })
})

describe('shares and setups', () => {
  it('turns counts into shares, biggest first', () => {
    const got = shares(new Map([['Ramp', 1], ['Outside', 3], ['Bombsite A', 0], ['Hut', 1]]))
    expect(got.map((s) => s.place)).toEqual(['Outside', 'Hut', 'Ramp', 'Bombsite A'])
    expect(got[0].share).toBeCloseTo(0.6)
    expect(got[1].share).toBeCloseTo(0.2)
    expect(shares(new Map())).toEqual([])
  })

  it('counts setups regardless of order', () => {
    const got = topSetups([
      ['Ramp', 'Bombsite A', 'Outside'],
      ['Outside', 'Ramp', 'Bombsite A'],
      ['Ramp', 'Ramp', 'Outside'],
      [],
      ['Bombsite A', 'Outside', 'Ramp'],
      ['Outside', 'Ramp', 'Ramp'],
      ['Hut'],
    ])
    expect(got).toEqual([
      { places: ['Bombsite A', 'Outside', 'Ramp'], count: 3 },
      { places: ['Outside', 'Ramp', 'Ramp'], count: 2 },
      { places: ['Hut'], count: 1 },
    ])
    expect(topSetups([['a'], ['b'], ['c']], 2)).toHaveLength(2)
  })
})

describe('liveStart', () => {
  it('uses the freeze end, or the first movement when it is missing', () => {
    // Everyone stands still until frame 40, then runs.
    const moving = (p: number, f: number): Pos => ({ x: 100 + Math.max(0, f - 40) * 8, y: 900 - p * 20, z: 0, place: 1, alive: true })
    const r = match(moving, PLAYERS)
    expect(liveStart(r, r.match.rounds[0])).toBe(160)
    r.match.rounds[0].freezeEndTick = r.match.rounds[0].startTick
    expect(liveStart(r, r.match.rounds[0])).toBe(40 * TICK)
  })
})

describe('Binner', () => {
  it('bins by floor', () => {
    const info: MapInfo = {
      ...INFO,
      levels: [
        { name: 'default', altitudeMin: -495, altitudeMax: 1e6, image: '' },
        { name: 'lower', altitudeMin: -1e6, altitudeMax: -495, image: '' },
      ],
    }
    const bin = new Binner(info)
    const g = newGrid(2)
    bin.add(g, 10, 1014, 0)
    bin.add(g, 10, 1014, -600)
    bin.add(g, 10, 1014, -600)
    // Off the radar.
    bin.add(g, -10, 1014, 0)
    expect(g.samples).toBe(3)
    // Radar (10, 10) is cell (2, 2).
    expect(g.levels[0][2 * 256 + 2]).toBe(1)
    expect(g.levels[1][2 * 256 + 2]).toBe(2)
  })
})

describe('ScoutBuilder', () => {
  const r = match(story, PLAYERS)

  it('adds up a match for the roster', () => {
    const b = new ScoutBuilder(ROSTER)
    expect(b.add(r, 'r1', 'one.dem', INFO)).toBe(true)
    const [s] = b.result()
    expect(s.map).toBe('de_test')
    expect(s.replays).toEqual([{ id: 'r1', name: 'one.dem', rounds: 2, won: null, score: '1-1', opponent: 'B', date: 0 }])
    expect(s.ctRounds).toBe(1)
    expect(s.tRounds).toBe(1)
    expect(s.won).toEqual({ ct: 1, t: 0 })

    // Roster order, the player on the other team is left out.
    expect(s.players.map((p) => p.name)).toEqual(['Bee', 'Ace'])
    const [bee, ace] = s.players
    expect(ace.ctRounds).toBe(1)
    expect(ace.tRounds).toBe(1)
    expect(ace.ctPlaces).toEqual([{ place: 'Bombsite A', share: 1 }])
    expect(ace.tPlaces).toEqual([{ place: 'Bombsite B', share: 1 }])
    // Died before the early moment, counts where they died.
    expect(bee.ctPlaces).toEqual([{ place: 'Ramp', share: 1 }])
    expect(bee.tPlaces).toEqual([{ place: 'Outside', share: 1 }])

    // Live time is frames 10 to 170, every 4th frame. Bee dies at 60.
    expect(ace.ct.samples).toBe(41)
    expect(bee.ct.samples).toBe(13)
    expect(s.team.ct.samples).toBe(54)
    // The first 20 s are frames 10 to 90.
    expect(ace.ctEarly.samples).toBe(21)
    expect(ace.ct.levels[0][Math.floor(124 / 4) * 256 + Math.floor(100 / 4)]).toBe(41)
    // T side live time is frames 185 to 345.
    expect(ace.t.samples).toBe(41)
    expect(s.team.t.samples).toBe(82)

    // Whole team setup, the non roster teammate is in it.
    expect(s.ctSetups).toEqual([{ places: ['Bombsite A', 'Ramp', 'Ramp'], count: 1 }])

    expect(s.noHit).toBe(0)
    expect(s.executes).toHaveLength(1)
    const ex = s.executes[0]
    expect(ex.site).toBe('B')
    expect(ex.rounds).toBe(1)
    expect(ex.share).toBe(1)
    expect(ex.avgHitTime).toBe(10)
    expect(ex.utility).toEqual([{ type: 505, pos: [400, 300, 0], player: 'Ace', from: [400, 300, 0] }])
    expect(ex.plants).toEqual([[500, 500, 0]])
    // 12 s before the hit at frame 225 is frame 177, before the round,
    // so frames 185 to 225 every 2nd frame, for both roster players.
    expect(ex.positions.samples).toBe(21 * 2)

    const labels = scoutLabels(s)!
    // B from the plant, A from where players stood on it.
    expect(labels.sites).toEqual([
      { name: 'A', x: 100, y: 124, level: 0 },
      { name: 'B', x: 500, y: 524, level: 0 },
    ])
    expect(labels.callouts.map((c) => c.name)).toContain('Outside')
    expect(labels.callouts.map((c) => c.name)).not.toContain('Bombsite A')
  })

  it('splits rounds by buy, weapon, plant, kills and utility', () => {
    const b = new ScoutBuilder(ROSTER)
    b.add(r, 'r1', 'one.dem', INFO, 1790000000)
    const [s] = b.result()
    const [bee, ace] = s.players
    expect(s.replays[0].date).toBe(1790000000)

    // Round 0 is the CT pistol, which the roster won. Ace stands on A for
    // 41 samples, Bee on Ramp for 13 before dying.
    expect(s.pistol.ct.rounds).toBe(1)
    expect(s.pistol.ct.won).toBe(1)
    expect(s.pistol.ct.heat.samples).toBe(54)
    expect(s.pistol.ct.places[0]).toEqual({ place: 'Bombsite A', share: 41 / 54 })
    expect(s.pistol.t.rounds).toBe(0)
    // Round 1 is a T eco they lost.
    expect(s.eco.t.rounds).toBe(1)
    expect(s.eco.t.won).toBe(0)
    expect(s.eco.t.splits).toEqual([{ label: 'Eco', rounds: 1, won: 0 }])
    expect(s.eco.t.heat.samples).toBe(82)
    expect(s.eco.ct.rounds).toBe(0)

    // Bee holds the AWP while alive on CT side, a sample is one second.
    expect(s.awp.ct.rounds).toBe(1)
    expect(s.awp.ct.heat.samples).toBe(13)
    expect(bee.awp).toEqual({ ct: 13, t: 0 })
    expect(s.awp.t.rounds).toBe(0)

    // The first 25 s of the T round are frames 185 to 285.
    expect(ace.tEarly.samples).toBe(26)
    expect(ace.tEarlyPlaces).toEqual([{ place: 'Bombsite B', share: 1 }])
    expect(bee.tEarlyPlaces).toEqual([{ place: 'Outside', share: 1 }])

    expect(ace.kills.map((k) => [k.side, k.opening, k.place, k.headshot])).toEqual([
      [3, true, 'Bombsite A', true],
      [2, false, 'Bombsite B', false],
    ])
    expect(ace.deaths).toEqual([])
    expect(bee.deaths).toHaveLength(1)
    expect(bee.deaths[0]).toMatchObject({ side: 2, opening: true, place: 'Outside', killer: [520, 520, 0], victim: [300, 300, 0], player: 'Bee' })
    expect(s.openings.map((o) => [o.side, o.won, o.player, o.place])).toEqual([
      [3, true, 'Ace', 'Bombsite A'],
      [2, false, 'Bee', 'Outside'],
    ])
    expect(s.openings[1].time).toBeCloseTo(40 / 64)

    // T after the plant on B: frames 250 to 345 every 2nd, two players.
    expect(s.postPlant.map((p) => [p.site, p.rounds, p.won, p.heat.samples])).toEqual([['B', 1, 0, 96]])
    expect(s.postPlant[0].plants).toEqual([[500, 500, 0]])
    expect(s.retake).toEqual([])

    // Utility by side with where it was thrown from.
    expect(s.utility.t).toEqual([
      { type: 505, pos: [400, 300, 0], player: 'Ace', from: [400, 300, 0] },
      { type: 504, pos: [300, 300, 0], player: 'Bee', from: [300, 300, 0] },
    ])
    expect(s.utility.ct).toEqual([{ type: 506, pos: [100, 100, 0], player: 'Ace', from: [100, 900, 0] }])
  })

  it('follows the roster to the other side of the server', () => {
    // The same roster as team 1: swap teams so the roster plays T first.
    const swapped = match(story, PLAYERS.map((_, i) => ({ team: i < 3 ? 1 : 0 })))
    const b = new ScoutBuilder(ROSTER)
    b.add(swapped, 'r2', 'two.dem', INFO)
    const [s] = b.result()
    // Team 1 is T in round 0 (sideOf [3, 2]) and CT in round 1.
    expect(s.ctRounds).toBe(1)
    expect(s.tRounds).toBe(1)
    expect(s.won).toEqual({ ct: 1, t: 0 })
    expect(s.players.map((p) => p.name)).toEqual(['Bee', 'Ace'])
    const ace = s.players[1]
    expect(ace.ctRounds).toBe(1)
    expect(ace.tRounds).toBe(1)
    // Round 0 is their T round now: positions there land in the T grid.
    expect(ace.t.levels[0][Math.floor(124 / 4) * 256 + Math.floor(100 / 4)]).toBe(41)
    expect(ace.ctPlaces).toEqual([{ place: 'Bombsite B', share: 1 }])
    // Nobody planted or hit a site in round 0.
    expect(s.noHit).toBe(1)
  })

  it('adds several matches and skips ones without the roster', () => {
    const b = new ScoutBuilder(ROSTER, { earlyCtSeconds: 10 })
    b.add(r, 'r1', 'one.dem', INFO)
    b.add(r, 'r2', 'two.dem', INFO)
    expect(b.add(r, 'r3', 'three.dem', INFO)).toBe(true)
    const none = new ScoutBuilder([{ steamId: '1', name: 'nobody' }])
    expect(none.add(r, 'r1', 'one.dem', INFO)).toBe(false)
    expect(none.result()).toEqual([])
    const [s] = b.result()
    expect(s.replays).toHaveLength(3)
    expect(s.ctRounds).toBe(3)
    expect(s.executes[0].rounds).toBe(3)
    expect(s.executes[0].plants).toHaveLength(3)
    expect(s.ctSetups).toEqual([{ places: ['Bombsite A', 'Ramp', 'Ramp'], count: 3 }])
    // 10 s early window: frames 10 to 50.
    expect(s.players[1].ctEarly.samples).toBe(11 * 3)
  })

  it('counts rounds without a hit', () => {
    const quiet = (p: number, f: number, round: number): Pos => {
      const s = story(p, f, round)
      return s.place === 4 ? { ...s, place: 3 } : s
    }
    const r2 = match(quiet, PLAYERS)
    // Drop the plant and the hit for this match.
    r2.match.bombEvents = []
    r2.roundBomb[1] = []
    r2.report.rounds[1].hit = ''
    r2.report.rounds[1].hitTime = -1
    const b = new ScoutBuilder(ROSTER)
    b.add(r2, 'q', 'quiet.dem', INFO)
    const [s] = b.result()
    expect(s.noHit).toBe(1)
    expect(s.executes).toEqual([])
    expect(s.players[1].tPlaces).toEqual([])
  })

  it('finds the hit time on the planted site when the first hit was elsewhere', () => {
    const r2 = match(story, PLAYERS)
    // The analysis says A, but the bomb went down on B.
    r2.report.rounds[1].hit = 'A'
    r2.report.rounds[1].hitTime = 3
    const b = new ScoutBuilder(ROSTER)
    b.add(r2, 'f', 'fake.dem', INFO)
    const [s] = b.result()
    expect(s.executes.map((e) => e.site)).toEqual(['B'])
    // Player 0 steps onto B at frame 225, tick 3600, 10 s after freeze end.
    expect(s.executes[0].avgHitTime).toBe(10)
  })
})
