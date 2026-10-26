import { describe, expect, it } from 'vitest'
import { FLAG, Replay } from '../replay'
import type { MapInfo } from '../types'
import { Binner } from './aggregate'
import { addRoles, confidenceOf, entryPlayer, finishRoles, hadAwp, hitUtility, lurkers, RoleAcc, rotated } from './roles'
import { buildZones, readRound, type RoundCtx } from './situations'

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
const ROLE_OPTS = { utilitySeconds: 20 }

function acc(name = 'ZoRoBeast', order = 0): RoleAcc {
  return new RoleAcc(`id-${name}`, name, '#4fa6ff', order)
}

function counts<K>(entries: [K, number][]): Map<K, number> {
  return new Map(entries)
}

describe('CT roles', () => {
  it('names an anchor with the spot they hold', () => {
    const a = acc()
    a.ct.rounds = 12
    a.ct.zones = counts([['B', 9], ['A', 3]])
    a.ct.places = counts([['Ramp', 8], ['Bombsite B', 1], ['Hut', 3]])
    a.ct.rotates = 1
    const [card] = finishRoles([a]).cards
    expect(card.ct).toEqual({ rounds: 12, zone: 'B', zoneShare: 0.75, place: 'Ramp', placeShare: 8 / 12, rotates: 1, awp: 0, label: 'B anchor' })
    expect(card.notes).toEqual(['ZoRoBeast played B anchor in 9 of 12 CT rounds, usually at Ramp (8 of 12).'])
  })

  it('names the AWP', () => {
    const a = acc()
    a.ct.rounds = 12
    a.ct.awp = 9
    a.ct.zones = counts([['A', 5], ['mid', 4], ['B', 3]])
    a.ct.places = counts([['Heaven', 5], ['Mid', 4], ['Ramp', 3]])
    a.ct.awpPlaces = counts([['Heaven', 6], ['Mid', 3]])
    const [card] = finishRoles([a]).cards
    expect(card.ct.label).toBe('AWP')
    expect(card.ct.awp).toBe(0.75)
    expect(card.notes).toEqual(['ZoRoBeast had the AWP in 9 of 12 CT rounds, mostly at Heaven (6 of 9).'])
    // An AWP who always holds the same site says both in one note.
    a.ct.zones = counts([['B', 12]])
    a.ct.places = counts([['Ramp', 12]])
    expect(finishRoles([a]).cards[0].notes).toEqual(['ZoRoBeast had the AWP in 9 of 12 CT rounds and held B in 12 of 12, usually at Ramp (12 of 12).'])
  })

  it('names rotators, mid players, fixed spots and the rest', () => {
    const rot = acc('Rot', 0)
    rot.ct.rounds = 10
    rot.ct.zones = counts([['A', 5], ['B', 4], ['mid', 1]])
    rot.ct.rotates = 4
    const mid = acc('Mid', 1)
    mid.ct.rounds = 10
    mid.ct.zones = counts([['mid', 5], ['A', 3], ['B', 2]])
    mid.ct.places = counts([['Middle', 4]])
    const out = acc('Out', 2)
    out.ct.rounds = 12
    out.ct.zones = counts([['other', 10], ['A', 2]])
    out.ct.places = counts([['Outside', 10], ['Hut', 2]])
    const flex = acc('Flex', 3)
    flex.ct.rounds = 8
    flex.ct.zones = counts([['A', 4], ['B', 3], ['other', 1]])
    const { cards } = finishRoles([rot, mid, out, flex])
    expect(cards.map((c) => c.ct.label)).toEqual(['Rotator', 'Mid', 'Outside', 'Flex'])
    expect(cards[0].notes).toEqual(['Rot rotated to the other site in 4 of 10 CT rounds.'])
    expect(cards[1].notes).toEqual(['Mid played mid in 5 of 10 CT rounds.'])
    expect(cards[2].notes).toEqual(['Out played Outside in 10 of 12 CT rounds.'])
    expect(cards[3].notes).toEqual(['Flex moved around on CT: no zone in more than 4 of 8 rounds.'])
  })

  it('leaves the CT side empty without CT rounds', () => {
    const a = acc()
    a.t.rounds = 3
    const [card] = finishRoles([a]).cards
    expect(card.ct.label).toBe('')
    expect(card.ct.rounds).toBe(0)
    expect(card.t.label).toBe('Flex')
  })
})

describe('T roles', () => {
  let order = 0
  const t = (name: string, f: Partial<RoleAcc['t']>) => {
    const a = acc(name, order++)
    a.t = { rounds: 10, hitRounds: 8, entry: 0, lurk: 0, nades: 6, teamNades: 30, teamSize: 40, awp: 0, ...f }
    return a
  }

  it('names entry, lurker, support, AWP and flex players', () => {
    const { cards } = finishRoles([
      t('Entry', { entry: 5 }),
      t('Lurk', { lurk: 3 }),
      t('Sup', { nades: 12 }),
      t('Awp', { awp: 7, entry: 3 }),
      t('Flex', { entry: 1, lurk: 1 }),
    ])
    expect(cards.map((c) => c.t.label)).toEqual(['Entry', 'Lurker', 'Support', 'AWP', 'Flex'])
    expect(cards[0].t.entry).toBe(5 / 8)
    expect(cards[2].t.support).toBe(0.4)
    expect(cards[0].notes).toEqual(['Entry was first onto the site in 5 of 8 T rounds with a hit.'])
    expect(cards[1].notes).toEqual(['Lurk lurked away from the team in 3 of 8 T rounds with a hit.'])
    expect(cards[2].notes).toEqual(["Sup threw 40% of the team's utility before site hits (12 of 30)."])
    expect(cards[3].notes).toEqual(['Awp had the AWP in 7 of 10 T rounds.', 'Awp was first onto the site in 3 of 8 T rounds with a hit.'])
    expect(cards[4].notes).toEqual([])
  })

  it('picks the strongest of several', () => {
    const [card] = finishRoles([t('Both', { entry: 3, lurk: 4 })]).cards
    // 4 of 8 lurks is further over its bar than 3 of 8 entries.
    expect(card.t.label).toBe('Lurker')
    expect(card.notes[0]).toContain('lurked')
  })
})

describe('confidence and team notes', () => {
  it('goes by the rounds behind the card', () => {
    expect(confidenceOf(4, 12)).toBe('low')
    expect(confidenceOf(8, 12)).toBe('medium')
    expect(confidenceOf(12, 12)).toBe('high')
    expect(confidenceOf(0, 13)).toBe('high')
    expect(confidenceOf(5, 0)).toBe('low')
  })

  it('says when the team plays fixed positions', () => {
    const team = ['A', 'B', 'C', 'D', 'E'].map((n, i) => {
      const a = acc(n, i)
      a.ct.rounds = 12
      a.ct.zones = i < 4 ? counts([['A', 8], ['mid', 4]]) : counts([['B', 6], ['mid', 6]])
      return a
    })
    const { notes } = finishRoles(team)
    expect(notes.map((n) => n.text)).toContain('On CT 4 of 5 players held the same zone in at least 60% of their rounds, so they play fixed positions.')
    for (const a of team) a.ct.zones = counts([['A', 6], ['B', 6]])
    expect(finishRoles(team).notes.map((n) => n.text)).toContain(
      'On CT only 0 of 5 players held the same zone in at least 60% of their rounds, so their positions change a lot.',
    )
  })

  it('keeps roster order', () => {
    const { cards } = finishRoles([acc('Second', 1), acc('Unknown', -1), acc('First', 0)].map((a) => ((a.ct.rounds = 1), a)))
    expect(cards.map((c) => c.name)).toEqual(['First', 'Second', 'Unknown'])
  })
})

describe('reading roles from a round', () => {
  it('finds the entry, the lurker and the utility', () => {
    const fast: Way[] = [[0, 'TSpawn'], [3, 'TLeft'], [9, 'ALong'], [11, 'BombsiteA']]
    const hide: Way[] = [[0, 'TSpawn'], [10, 'TSpawn', -1500, -1500]]
    const r = game([
      tRound([T_TO_A, fast, T_TO_A, hide, T_TO_B], undefined, {
        hit: 'A', hitTime: 11,
        grenades: [
          { t: 1, thrower: 0, type: 504, at: 'TLeft' },
          { t: 5, thrower: 2, type: 505, at: 'ALong', until: 23 },
          { t: 8, thrower: 2, type: 504, at: 'ALong' },
          { t: 10, thrower: 2, type: 502, at: 'BombsiteA', until: 17 },
          { t: 10, thrower: 2, type: 501, at: 'BombsiteA' },
          // Too late for the hit.
          { t: 20, thrower: 0, type: 506, at: 'BombsiteA' },
        ],
      }),
    ])
    const ctx = ctxFor(r, 0)
    const read = readRound(ctx, OPTS)
    expect(read.hit).toBe('A')
    expect(entryPlayer(ctx, read)).toBe(1)
    // p3 hides far from everyone, p4 is alone on B.
    expect(lurkers(ctx, read)).toEqual([false, false, false, true, true])
    expect(hitUtility(ctx, read, ROLE_OPTS)).toEqual([1, 0, 3, 0, 0])

    const accs = [0, 1, 2, 3, 4].map((i) => acc(`p${i}`, i))
    addRoles(accs, ctx, read, ROLE_OPTS)
    expect(accs[1].t).toMatchObject({ rounds: 1, hitRounds: 1, entry: 1, lurk: 0, nades: 0, teamNades: 4, teamSize: 5 })
    expect(accs[2].t).toMatchObject({ nades: 3, teamNades: 4 })
    expect(accs[4].t.lurk).toBe(1)
  })

  it('takes the first fight when nobody from the roster reached the site', () => {
    const r = game([tRound([T_TO_A, T_TO_A, T_TO_A, T_TO_A, T_TO_A], undefined, { hit: 'B', hitTime: 20, kills: [{ t: 9, killer: 7, victim: 3 }] })])
    const ctx = ctxFor(r, 0)
    expect(entryPlayer(ctx, readRound(ctx, OPTS))).toBe(3)
  })

  it('finds CT rotations and the AWP', () => {
    // p0 holds A and goes B before the plant there, p1 fights on A first.
    const rot: Way[] = [...CT_TO_A, [18, 'BombsiteA'], [24, 'BombsiteB']]
    const stay: Way[] = [...CT_TO_A, [21, 'BombsiteA'], [27, 'BombsiteB']]
    const r = game([
      ctRound([rot, stay, CT_TO_A, CT_TO_B, CT_TO_B], undefined, { plant: { t: 28, player: 7, site: 'B' }, kills: [{ t: 20, killer: 1, victim: 6 }] }),
    ])
    r.match.rounds[0].players = null
    const ctx = ctxFor(r, 0)
    const read = readRound(ctx, OPTS)
    expect(rotated(ctx, read, 0)).toBe(true)
    expect(rotated(ctx, read, 1)).toBe(false)
    expect(rotated(ctx, read, 2)).toBe(false)
    const accs = [0, 1, 2, 3, 4].map((i) => acc(`p${i}`, i))
    addRoles(accs, ctx, read, ROLE_OPTS)
    expect(accs[0].ct.rotates).toBe(1)
    expect(accs[0].ct.zones.get('A')).toBe(1)
    expect(accs[3].ct.places.get('Bombsite B')).toBe(1)

    const withAwp = game([{ ...ctRound([CT_TO_A, CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B]), plans: ctRound([CT_TO_A, CT_TO_A, CT_TO_A, CT_TO_B, CT_TO_B]).plans.map((p, i) => ({ ...p, awp: i === 2 })) }])
    const b = withAwp.frameIndex(withAwp.match.rounds[0].endTick)
    expect(hadAwp(withAwp, 2, 0, b)).toBe(true)
    expect(hadAwp(withAwp, 1, 0, b)).toBe(false)
  })
})
