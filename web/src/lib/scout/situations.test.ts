import { describe, expect, it } from 'vitest'
import { FLAG, Replay } from '../replay'
import type { MapInfo } from '../types'
import { Binner } from './aggregate'
import {
  buildTrack,
  buildZones,
  buyKind,
  nearSite,
  noteScore,
  pickTendencies,
  readRound,
  SituationAcc,
  splitText,
  stackNeed,
  trackLabel,
  tTerritory,
  zoneAt,
  type RoundCtx,
} from './situations'
import { newGrid } from './aggregate'

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

// The test map. T spawn bottom left, CT spawn top right, A top left and B
// bottom right. Ts reach A through T Left and A Long, B through T Bottom
// and B Ramp. CTs go through Connector to either site.
const PLACES = ['', 'TSpawn', 'CTSpawn', 'BombsiteA', 'BombsiteB', 'TLeft', 'ALong', 'TBottom', 'BRamp', 'Connector', 'Middle']
const P = Object.fromEntries(PLACES.map((p, i) => [p, i])) as Record<string, number>
const SPOT: Record<string, [number, number]> = {
  TSpawn: [100, 100],
  CTSpawn: [900, 900],
  BombsiteA: [150, 900],
  BombsiteB: [900, 150],
  TLeft: [100, 400],
  ALong: [120, 700],
  TBottom: [400, 100],
  BRamp: [700, 120],
  Connector: [700, 700],
  Middle: [500, 500],
}

// Way is a waypoint: seconds after freeze end, where, and the place from
// there to the next waypoint.
type Way = [number, string] | [number, string, number, number]

interface Plan {
  side: number
  ways: Way[]
  dies?: number
  awp?: boolean
}

interface RoundSpec {
  plans: Plan[]
  winnerTeam: number
  buy?: [string, string]
  hit?: string
  hitTime?: number
  kills?: { t: number; killer: number; victim: number }[]
  grenades?: { t: number; thrower: number; type: number; at: string; until?: number }[]
  plant?: { t: number; player: number; site: string }
}

const RATE = 64
// Frames every 16 ticks: four a second.
const TICK = 16
const FREEZE = 2
const LENGTH = 50
const GAP = 4

const INFO: MapInfo = {
  name: 'de_test', posX: 0, posY: 1024, scale: 1, size: 1024, known: true,
  levels: [{ name: 'default', altitudeMin: -1e6, altitudeMax: 1e6, image: '' }],
}

function spot(w: Way): [number, number] {
  return w.length === 4 ? [w[2], w[3]] : SPOT[w[1]]
}

function at(ways: Way[], t: number): { x: number; y: number; place: number } {
  let k = 0
  while (k + 1 < ways.length && ways[k + 1][0] <= t) k++
  const [x0, y0] = spot(ways[k])
  const next = ways[k + 1]
  if (!next || t <= ways[k][0]) return { x: x0, y: y0, place: P[ways[k][1]] }
  const [x1, y1] = spot(next)
  const u = (t - ways[k][0]) / (next[0] - ways[k][0])
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, place: P[ways[k][1]] }
}

// game builds a match from round specs. Players 0 to 4 are team 0, 5 to
// 9 team 1, unless teams says otherwise.
function game(specs: RoundSpec[], teams?: number[]): Replay {
  const n = specs[0].plans.length
  const teamOf = teams ?? Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : 1))
  const span = (FREEZE + LENGTH + GAP) * RATE
  const rounds = specs.map((s, i) => {
    const startTick = i * span
    const freezeEndTick = startTick + FREEZE * RATE
    const endTick = freezeEndTick + LENGTH * RATE
    const side0 = s.plans[teamOf.indexOf(0)].side
    return {
      number: i + 1, startTick, freezeEndTick, endTick, officialEndTick: endTick,
      sideOf: [side0, side0 === 3 ? 2 : 3], winner: 0, winnerTeam: s.winnerTeam, players: null,
    }
  })
  const frames = Math.ceil((specs.length * span) / TICK)
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
    const ri = Math.min(specs.length - 1, Math.floor(tick[f] / span))
    const t = (tick[f] - rounds[ri].freezeEndTick) / RATE
    for (let p = 0; p < n; p++) {
      const plan = specs[ri].plans[p]
      const s = at(plan.ways, t)
      const i = p * frames + f
      x[i] = Math.round(s.x)
      y[i] = Math.round(s.y)
      flags[i] = plan.dies !== undefined && t >= plan.dies ? 0 : FLAG.alive
      side[i] = plan.side
      place[i] = s.place
      weapon[i] = plan.awp ? 309 : 7
    }
  }
  const tickOf = (ri: number, t: number) => rounds[ri].freezeEndTick + t * RATE
  const posOf = (ri: number, p: number, t: number): [number, number, number] => {
    const s = at(specs[ri].plans[p].ways, t)
    return [s.x, s.y, 0]
  }
  const kills = specs.flatMap((s, ri) =>
    (s.kills ?? []).map((k) => ({
      tick: tickOf(ri, k.t), round: ri, killer: k.killer, victim: k.victim, weapon: 7, headshot: false,
      killerSide: s.plans[k.killer].side, victimSide: s.plans[k.victim].side,
      killerPos: posOf(ri, k.killer, k.t), victimPos: posOf(ri, k.victim, k.t), killerPlace: '', victimPlace: '',
    })),
  )
  let gid = 0
  const grenades = specs.flatMap((s, ri) =>
    (s.grenades ?? []).map((g) => ({
      id: gid++, type: g.type, thrower: g.thrower, side: s.plans[g.thrower].side, round: ri,
      throwTick: tickOf(ri, g.t - 1), effectTick: tickOf(ri, g.t), endTick: g.until ? tickOf(ri, g.until) : tickOf(ri, g.t),
      pos: [...SPOT[g.at], 0], pathStart: 0, pathLen: 0,
    })),
  )
  const bombEvents = specs.flatMap((s, ri) =>
    s.plant ? [{ tick: tickOf(ri, s.plant.t), round: ri, kind: 'planted', player: s.plant.player, site: s.plant.site, pos: [...SPOT[`Bombsite${s.plant.site}`], 0] }] : [],
  )
  const m = {
    map: 'de_test', tickRate: RATE,
    players: teamOf.map((team, i) => ({ index: i, name: `p${i}`, steamId: `${100 + i}`, team, isBot: false })),
    teams: [{ name: 'Us', score: 0 }, { name: 'Them', score: 0 }],
    rounds, kills, grenades, bombEvents, places: PLACES,
  }
  const report = specs.map((s, i) => ({ round: i, hit: s.hit ?? '', hitTime: s.hitTime ?? -1, buyType: s.buy ?? ['full', 'full'] }))
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

// Ways for the usual runs.
const T_TO_A: Way[] = [[0, 'TSpawn'], [4, 'TLeft'], [11, 'ALong'], [14, 'BombsiteA']]
const T_TO_B: Way[] = [[0, 'TSpawn'], [4, 'TBottom'], [11, 'BRamp'], [14, 'BombsiteB']]
const CT_TO_A: Way[] = [[0, 'CTSpawn'], [5, 'Connector'], [8, 'BombsiteA']]
const CT_TO_B: Way[] = [[0, 'CTSpawn'], [5, 'Connector'], [8, 'BombsiteB']]
const T_HOLD: Way[] = [[0, 'TSpawn']]

// A round with team 0 on CT, everyone running the given ways.
function ctRound(ours: Way[][], theirs: Way[][] = [T_TO_A, T_TO_A, T_TO_B, T_TO_B, T_TO_A], extra: Partial<RoundSpec> = {}): RoundSpec {
  return { winnerTeam: 0, ...extra, plans: [...ours.map((ways) => ({ side: 3, ways })), ...theirs.map((ways) => ({ side: 2, ways }))] }
}

function tRound(ours: Way[][], theirs: Way[][] = [CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B, CT_TO_B], extra: Partial<RoundSpec> = {}): RoundSpec {
  return { winnerTeam: 0, ...extra, plans: [...ours.map((ways) => ({ side: 2, ways })), ...theirs.map((ways) => ({ side: 3, ways }))] }
}

// ctxFor is the roster context of a round for team 0.
function ctxFor(r: Replay, i: number, team = 0): RoundCtx {
  const rd = r.match.rounds[i]
  const players = r.teamPlayers[team]
  const live = rd.freezeEndTick
  return {
    r, i, team, side: rd.sideOf[team], won: rd.winnerTeam === team, live,
    a: r.frameIndex(live), b: r.frameIndex(rd.endTick), players,
    names: players.map((p) => r.playerName(p)), ids: players.map((p) => r.match.players[p].steamId), colors: players.map(() => '#fff'),
    zones: buildZones(r, r.match.rounds.map((x) => x.freezeEndTick)),
    bin: new Binner(INFO),
  }
}

const OPTS = { rushSeconds: 25, setupSeconds: 15 }

describe('buildZones', () => {
  // Six rounds: Ts go A and B in turn, CTs split through Connector.
  const specs: RoundSpec[] = []
  for (let i = 0; i < 6; i++) {
    const t = i % 2 ? T_TO_A : T_TO_B
    specs.push(ctRound([CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B, CT_TO_A], [t, t, t, t, t]))
  }
  const r = game(specs)
  const zm = buildZones(r, r.match.rounds.map((x) => x.freezeEndTick))

  it('gives places a zone from where players walk next', () => {
    const z = (name: string) => zm.byPlace[P[name]]
    expect(z('BombsiteA')).toBe('A')
    expect(z('BombsiteB')).toBe('B')
    // A Long leads onto A within 3 s, B Ramp onto B.
    expect(z('ALong')).toBe('A')
    expect(z('BRamp')).toBe('B')
    // Connector leads to both sites, Middle is mid by its name.
    expect(z('Connector')).toBe('mid')
    expect(z('Middle')).toBe('mid')
    // The spawn and the T side paths are too far from the sites.
    expect(z('TSpawn')).toBe('other')
    expect(z('TLeft')).toBe('other')
    expect(z('TBottom')).toBe('other')
  })

  it('finds the sites and the spawns', () => {
    expect(zm.sites.map((s) => s.name)).toEqual(['A', 'B'])
    const a = zm.sites[0]
    expect(a.x).toBeCloseTo(150, 0)
    expect(a.y).toBeCloseTo(900, 0)
    expect(zm.tSpawn![0]).toBeCloseTo(100, 0)
    expect(zm.ctSpawn![1]).toBeCloseTo(900, 0)
  })

  it('uses the distance to the sites without a place', () => {
    expect(nearSite(zm, 180, 870, 0)).toBe('A')
    expect(nearSite(zm, 880, 180, 0)).toBe('B')
    expect(nearSite(zm, 500, 500, 0)).toBe('other')
    // A floor above or below the site is far away.
    expect(nearSite(zm, 150, 900, 400)).toBe('other')
    // A sample on a place uses the place.
    const f = r.frameIndex(r.match.rounds[0].freezeEndTick + 20 * RATE)
    expect(zoneAt(zm, r, 0 * r.frames + f)).toBe('A')
  })

  it('knows T territory', () => {
    expect(tTerritory(zm, 'other', 150, 300)).toBe(true)
    expect(tTerritory(zm, 'other', 800, 700)).toBe(false)
    // Sites never count, even close to the T spawn.
    expect(tTerritory(zm, 'A', 150, 300)).toBe(false)
  })

  it('falls back to the plants without site places', () => {
    const plain = game([ctRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { plant: { t: 20, player: 5, site: 'B' } })])
    plain.places[3] = 'Somewhere'
    plain.places[4] = 'Elsewhere'
    const z = buildZones(plain, [plain.match.rounds[0].freezeEndTick])
    expect(z.sites.map((s) => [s.name, s.x, s.y])).toEqual([['B', 900, 150]])
  })
})

describe('buyKind', () => {
  const r = game([
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['pistol', 'pistol'] }),
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['eco', 'full'] }),
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['force', 'full'] }),
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['full', 'eco'] }),
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['full', 'force'] }),
    tRound([T_HOLD, T_HOLD, T_HOLD, T_HOLD, T_HOLD], undefined, { buy: ['full', 'full'] }),
  ])

  it('reads the buy from the roster side', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => buyKind(r, i, 0))).toEqual(['pistol', 'eco', 'force', 'antieco', 'antieco', 'full'])
    // The other team sees an anti-eco where we were on eco.
    expect(buyKind(r, 1, 1)).toBe('antieco')
    expect(buyKind(r, 3, 1)).toBe('eco')
  })

  it('falls back to the equipment value without the analysis', () => {
    r.report.rounds[2].buyType = ['', ''] as unknown as [string, string]
    r.match.rounds[2].players = [
      { player: 0, side: 2, equipValue: 800 },
      { player: 1, side: 2, equipValue: 900 },
      { player: 5, side: 3, equipValue: 5000 },
    ] as never
    expect(buyKind(r, 2, 0)).toBe('eco')
    expect(buyKind(r, 2, 1)).toBe('antieco')
    r.report.rounds[0].buyType = ['', ''] as unknown as [string, string]
    expect(buyKind(r, 0, 0)).toBe('pistol')
  })
})

describe('readRound', () => {
  it('finds a T rush and its time', () => {
    const r = game([tRound([T_TO_B, T_TO_B, T_TO_B, T_TO_A, T_TO_B], undefined, { hit: 'B', hitTime: 14, buy: ['eco', 'full'] })])
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.side).toBe('t')
    expect(read.buy).toBe('eco')
    expect(read.hit).toBe('B')
    expect(read.hitTime).toBeCloseTo(14)
    expect(read.rush).toBe(true)
    expect(readRound(ctxFor(r, 0), { ...OPTS, rushSeconds: 10 }).rush).toBe(false)
  })

  it('counts the planted site when the first site stepped on was a fake', () => {
    const r = game([tRound([T_TO_A, T_TO_B, T_TO_B, T_TO_B, T_TO_B], undefined, { hit: 'A', hitTime: 14, plant: { t: 30, player: 1, site: 'B' } })])
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.hit).toBe('B')
    // The first T on B got there at 14 s too.
    expect(read.hitTime).toBeCloseTo(14)
    expect(read.plantSite).toBe('B')
  })

  it('finds a CT stack and the setup', () => {
    const r = game([ctRound([CT_TO_A, CT_TO_A, CT_TO_A, CT_TO_B, [[0, 'CTSpawn'], [6, 'Middle']]])])
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.setupZones).toEqual(['A', 'A', 'A', 'B', 'mid'])
    expect(read.setupPlaces).toEqual(['Bombsite A', 'Bombsite A', 'Bombsite A', 'Bombsite B', 'Middle'])
    expect(read.stack).toBe('A')
    expect(read.stackSize).toBe(3)
    expect(read.push).toBeNull()
    expect(splitText(read.setupZones)).toBe('3 A, 1 mid, 1 B')
  })

  it('does not count players who died before the setup in a stack', () => {
    const r = game([ctRound([CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B, CT_TO_A])])
    r.pflags.fill(0, 0 * r.frames + r.frameIndex(r.match.rounds[0].freezeEndTick + 10 * RATE), 1 * r.frames)
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.setupAlive[0]).toBe(false)
    // Where they died still counts for the setup.
    expect(read.setupZones[0]).toBe('A')
    expect(read.stack).toBe('')
  })

  it('finds a CT standing in T territory at the setup moment', () => {
    const push: Way[] = [[0, 'CTSpawn'], [6, 'Connector'], [12, 'TLeft', 150, 350]]
    const r = game([ctRound([CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B, push])])
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.push).toEqual({ k: 4, place: 'T Left' })
  })

  it('finds a CT taking the first fight in T territory', () => {
    // Out to T Left at 10 s for a kill, back on A by 15 s.
    const peek: Way[] = [[0, 'CTSpawn'], [6, 'TLeft', 150, 350], [12, 'TLeft', 150, 350], [14, 'BombsiteA']]
    const r = game([ctRound([CT_TO_A, peek, CT_TO_B, CT_TO_B, CT_TO_B], undefined, { kills: [{ t: 11, killer: 1, victim: 5 }] })])
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.setupZones[1]).toBe('A')
    expect(read.push).toEqual({ k: 1, place: 'T Left' })
    // A fight after 20 s is not an early push.
    const late = game([ctRound([CT_TO_A, peek, CT_TO_B, CT_TO_B, CT_TO_B], undefined, { kills: [{ t: 22, killer: 1, victim: 5 }] })])
    expect(readRound(ctxFor(late, 0), OPTS).push).toBeNull()
  })

  it('counts players saving in a lost round', () => {
    // Bomb down on A, two Ts hide far away and live, CTs win.
    const hide: Way[] = [[0, 'TSpawn'], [10, 'TSpawn', -1500, -1500]]
    const r = game([
      tRound([T_TO_A, T_TO_A, T_TO_A, hide, hide], undefined, { winnerTeam: 1, hit: 'A', hitTime: 14, plant: { t: 20, player: 0, site: 'A' } }),
    ])
    for (const p of [0, 1, 2]) r.pflags.fill(0, p * r.frames + r.frameIndex(r.match.rounds[0].freezeEndTick + 30 * RATE), (p + 1) * r.frames)
    const read = readRound(ctxFor(r, 0), OPTS)
    expect(read.won).toBe(false)
    expect(read.saved).toBe(2)
    // Alive next to an enemy is not saving.
    const near = game([tRound([T_TO_A, T_TO_A, T_TO_A, hide, CT_TO_B], [CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B, CT_TO_B], { winnerTeam: 1 })])
    expect(readRound(ctxFor(near, 0), OPTS).saved).toBe(1)
  })
})

describe('buildTrack', () => {
  const r = game([
    tRound([T_TO_A, T_TO_A, T_TO_B, T_TO_B, T_TO_A], undefined, {
      hit: 'A', hitTime: 14,
      kills: [{ t: 16, killer: 5, victim: 0 }, { t: 18, killer: 1, victim: 5 }],
      grenades: [
        { t: 9, thrower: 1, type: 505, at: 'ALong', until: 27 },
        { t: 12, thrower: 2, type: 504, at: 'BRamp' },
        // Not ours, and after the window.
        { t: 10, thrower: 6, type: 505, at: 'Connector', until: 28 },
        { t: 40, thrower: 3, type: 506, at: 'BombsiteB' },
      ],
      plant: { t: 24, player: 1, site: 'A' },
    }),
  ])
  r.match.rounds[0].number = 7
  const ctx = ctxFor(r, 0)
  r.pflags.fill(0, 0 * r.frames + r.frameIndex(r.match.rounds[0].freezeEndTick + 16 * RATE), 1 * r.frames)
  const read = readRound(ctx, OPTS)
  const tr = buildTrack(ctx, read, 'rid', { trackSeconds: 30, trackStep: 0.125 })

  it('samples every roster player every step', () => {
    expect(tr.replayId).toBe('rid')
    expect(tr.round).toBe(7)
    expect(tr.hit).toBe('A')
    expect(tr.hitTime).toBeCloseTo(14)
    expect(tr.won).toBe(true)
    expect(tr.players.map((p) => p.name)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    const p1 = tr.players[1]
    expect(p1.xs.length).toBe(241)
    // Radar space: y is flipped.
    expect(p1.xs[0]).toBeCloseTo(100)
    expect(p1.ys[0]).toBeCloseTo(1024 - 100)
    // Half way from T Spawn to T Left at 2 s, between frames at 2.125 s.
    expect(p1.ys[16]).toBeCloseTo(1024 - 250, 0)
    expect(p1.ys[17]).toBeCloseTo(1024 - (100 + (300 * 2.125) / 4), 0)
    expect(p1.alive.every((a) => a === 1)).toBe(true)
  })

  it('keeps the callout every player is at', async () => {
    const { placeAt } = await import('./overlay')
    const p1 = tr.players[1]
    expect(placeAt(tr, p1, 0.125, 0)).toBe('T Spawn')
    // T Spawn to T Left, then A Long and onto the site by 14 s.
    expect(placeAt(tr, p1, 0.125, 15)).toBe('Bombsite A')
  })

  it('stops at the end of the round', () => {
    expect(tr.end).toBe(30)
    // Rounds here last 50 s, so a longer window ends with the round.
    const whole = buildTrack(ctx, read, 'rid', { trackSeconds: 160, trackStep: 0.25 })
    expect(whole.end).toBe(LENGTH)
    expect(whole.players[1].xs.length).toBe(LENGTH * 4 + 1)
    expect(whole.events.every((e) => e.t <= LENGTH)).toBe(true)
  })

  it('stops a player at their death', () => {
    const p0 = tr.players[0]
    // Died at 16 s, sample 128.
    expect(p0.alive[127]).toBe(1)
    expect(p0.alive[128]).toBe(0)
    expect(p0.alive[240]).toBe(0)
    expect(p0.xs[240]).toBe(p0.xs[127])
    expect(p0.ys[240]).toBe(p0.ys[127])
  })

  it('keeps the roster events in the window', () => {
    expect(tr.events.map((e) => [e.kind, e.t, e.player])).toEqual([
      ['smoke', 9, 'p1'],
      ['flash', 12, 'p2'],
      ['death', 16, 'p0'],
      ['kill', 18, 'p1'],
      ['plant', 24, 'p1'],
    ])
    const smoke = tr.events[0]
    expect(smoke.until).toBe(27)
    expect([smoke.x, smoke.y]).toEqual([120, 1024 - 700])
    // Thrown a second before it went off, from where p1 stood.
    expect(smoke.from![1]).toBeCloseTo(1024 - (400 + (300 * 4) / 7), 0)
    expect(tr.events[1].until).toBeUndefined()
    const kill = tr.events[3]
    expect(kill.from).toBeDefined()
  })

  it('names tracks after the match', () => {
    expect(trackLabel(2, 13)).toBe('Match 2, round 13')
    expect(trackLabel(0, 13)).toBe('Round 13')
  })
})

describe('SituationAcc notes', () => {
  const acc = (side: 'ct' | 't', buy: 'pistol' | 'eco' | 'force' | 'full' | 'antieco') => new SituationAcc(side, buy, () => newGrid(1, 4))

  it('says when they rush', () => {
    const s = acc('t', 'eco')
    s.rounds = 4
    s.rushes = 3
    s.rushSites.set('B', { rounds: 3, time: 66 })
    s.hits.set('B', { rounds: 3, time: 66 })
    s.noHit = 1
    const notes = s.notes().map((n) => n.text)
    expect(notes).toContain('On T eco rounds they rushed B in 3 of 4, on site after 22 s on average.')
    // The site note would say the same.
    expect(notes.some((n) => n.includes('went B'))).toBe(false)
  })

  it('splits rushes over both sites', () => {
    const s = acc('t', 'full')
    s.rounds = 8
    s.rushes = 6
    s.rushSites.set('A', { rounds: 4, time: 72 })
    s.rushSites.set('B', { rounds: 2, time: 42 })
    expect(s.notes()[0].text).toBe('On T full buys they rushed a site in 6 of 8 (4 A, 2 B), on site after 19 s on average.')
  })

  it('says where they go and when they play slow', () => {
    const s = acc('t', 'full')
    s.rounds = 5
    s.hits.set('A', { rounds: 4, time: 240 })
    s.hits.set('B', { rounds: 1, time: 50 })
    const notes = s.notes().map((n) => n.text)
    expect(notes).toEqual([
      'On T full buys they went A in 4 of 5, on site after 60 s on average.',
      'On T full buys they played slow: no rush in 5 rounds, first on a site after 58 s on average.',
    ])
  })

  it('says when they stack, push and set up', () => {
    const s = acc('ct', 'force')
    s.rounds = 3
    s.stacks.set('A', { rounds: 2, min: 3, max: 3 })
    expect(s.notes().map((n) => n.text)).toEqual(['On CT force buys they stacked A with 3 players in 2 of 3.'])
    const p = acc('ct', 'pistol')
    p.rounds = 2
    p.pushes = 2
    p.pushPlaces.set('Outside', 2)
    p.pushers.set('Ace', 1)
    p.pushers.set('Bee', 1)
    p.splits.set('2 A, 1 mid, 2 B', 2)
    expect(p.notes().map((n) => n.text)).toEqual([
      'On CT pistol rounds a player pushed Outside early in 2 of 2.',
      'On CT pistol rounds they set up 2 A, 1 mid, 2 B in 2 of 2.',
    ])
    p.pushers.set('Ace', 2)
    p.pushers.delete('Bee')
    expect(p.notes()[0].text).toBe('On CT pistol rounds Ace pushed Outside early in 2 of 2.')
  })

  it('says where they stood and when they saved', () => {
    const s = acc('ct', 'full')
    s.rounds = 6
    s.won = 2
    s.saves = 2
    s.spots.set('Ramp', 6)
    s.spots.set('Outside', 5)
    s.spots.set('Hut', 2)
    expect(s.notes().map((n) => n.text)).toEqual([
      'On CT full buys at 15 s they were usually at Ramp (6 of 6) and Outside (5 of 6).',
      'On CT full buys 2 or more players saved in 2 of 4 lost rounds.',
    ])
  })

  it('says when an eco wins or an anti-eco loses', () => {
    const e = acc('t', 'force')
    e.rounds = 4
    e.won = 3
    expect(e.notes().map((n) => n.text)).toEqual(['On T force buys they won 3 of 4.'])
    const a = acc('ct', 'antieco')
    a.rounds = 3
    a.won = 1
    expect(a.notes().map((n) => n.text)).toEqual(['On CT anti-eco rounds they lost 2 of 3.'])
    a.won = 2
    expect(a.notes()).toEqual([])
  })

  it('skips things that are not a pattern', () => {
    const s = acc('t', 'full')
    s.rounds = 6
    s.rushes = 1
    s.rushSites.set('A', { rounds: 1, time: 20 })
    s.hits.set('A', { rounds: 2, time: 60 })
    s.hits.set('B', { rounds: 2, time: 80 })
    s.noHit = 2
    expect(s.notes()).toEqual([])
    // One pistol round is all there is, so it still counts.
    const p = acc('t', 'pistol')
    p.rounds = 1
    p.rushes = 1
    p.rushSites.set('B', { rounds: 1, time: 18.4 })
    p.hits.set('B', { rounds: 1, time: 18.4 })
    expect(p.notes().map((n) => n.text)).toEqual(['On T pistol rounds they rushed B in 1 of 1, on site after 18 s.'])
  })

  it('adds rounds from a replay', () => {
    const r = game([
      ctRound([CT_TO_A, CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B], undefined, { buy: ['pistol', 'pistol'] }),
      ctRound([CT_TO_A, CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B], undefined, { buy: ['pistol', 'pistol'], winnerTeam: 1 }),
    ])
    const s = new SituationAcc('ct', 'pistol', () => newGrid(1))
    for (const i of [0, 1]) {
      const ctx = ctxFor(r, i)
      const read = readRound(ctx, OPTS)
      s.add(ctx, read, buildTrack(ctx, read, 'x', { trackSeconds: 30, trackStep: 0.125 }))
    }
    const { situation } = s.finish()
    expect(situation).toMatchObject({ key: 'ct-pistol', side: 'ct', buy: 'pistol', title: 'CT pistol rounds', rounds: 2, won: 1, pushes: 0, saves: 0 })
    expect(situation.stacks).toEqual([{ site: 'A', rounds: 2 }])
    expect(situation.tracks).toHaveLength(2)
    // 10 s at 4 frames a second, every 2nd frame from the start: 21 per player.
    expect(situation.heat10.samples).toBe(2 * 5 * 21)
    expect(situation.heat20.samples).toBe(2 * 5 * 41)
    expect(situation.notes).toEqual([
      'On CT pistol rounds they stacked A with 3 players in 2 of 2.',
      'On CT pistol rounds at 15 s they were usually at Bombsite A (2 of 2) and Bombsite B (2 of 2).',
    ])
  })
})

describe('notes and tendencies', () => {
  it('weighs patterns by the rounds behind them', () => {
    expect(noteScore(3, 4)).toBeCloseTo(0.75 * (4 / 6))
    expect(noteScore(9, 12)).toBeCloseTo(0.75)
    expect(noteScore(0, 0)).toBe(0)
    expect(stackNeed(5)).toBe(3)
    expect(stackNeed(2)).toBe(2)
  })

  it('keeps the best notes as a mix', () => {
    const notes = [
      ...Array.from({ length: 4 }, (_, i) => ({ text: `a${i}`, score: 1 - i * 0.01, group: 'player:1' })),
      ...Array.from({ length: 6 }, (_, i) => ({ text: `b${i}`, score: 0.9 - i * 0.01, group: `player:${i + 2}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ text: `s${i}`, score: 0.5, group: 'spots' })),
      { text: 'r', score: 0.4, group: 'site' },
      { text: 'r', score: 0.3, group: 'site' },
      { text: 'zero', score: 0 },
    ]
    expect(pickTendencies(notes)).toEqual(['a0', 'a1', 'b0', 'b1', 'b2', 'b3', 's0', 's1', 'r'])
    expect(pickTendencies(notes, 3)).toEqual(['a0', 'a1', 'b0'])
  })
})
