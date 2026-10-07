// Builds scouting data for a group of players from several replays. Every
// replay is loaded, read and dropped before the next one, so a long list
// of matches never sits in memory at once.

import { listReplays, mapInfo } from '../api'
import type { Callout, Site } from '../mapview'
import { FLAG, loadReplay, prettyPlace, type Replay } from '../replay'
import type { Grenade, Kill, MapInfo, Player, Round } from '../types'
import { EQ } from '../weapons'
import {
  DEFAULT_SCOUT_OPTIONS,
  type CtSetup,
  type HeatGrid,
  type KillMark,
  type MapScout,
  type OpeningDuel,
  type PlaceShare,
  type PlantScout,
  type PlayerScout,
  type RosterPlayer,
  type ScoutOptions,
  type ScoutReplay,
  type SideHeat,
  type SiteExecute,
  type UtilityMark,
  type Vec3,
} from './types'

// Cells per side of a heat grid, 4 radar pixels each.
export const GRID = 256
// Every 4th frame is plenty for heat over a whole match.
const STEP = 4
// Short windows (the run into a site) use every 2nd frame.
const FINE_STEP = 2
// Frames between samples for callout positions.
const LABEL_STEP = 16
// Utility that went off this long after the hit still belongs to it.
const AFTER_HIT = 3
const SIDE_T = 2
const SIDE_CT = 3
const SETUPS = 6
const AWP = 309

const SIZE = 1024

export interface MapLabels {
  callouts: Callout[]
  sites: Site[]
}

export function newGrid(levels: number, size = GRID): HeatGrid {
  return { size, levels: Array.from({ length: Math.max(1, levels) }, () => new Float32Array(size * size)), samples: 0 }
}

// levelOf picks the floor for a height, the same way MapView does.
export function levelOf(info: MapInfo, z: number): number {
  const ls = info.levels
  for (let i = ls.length - 1; i > 0; i--) {
    if (z < ls[i].altitudeMax) return i
  }
  return 0
}

// Binner drops world positions into heat grid cells.
export class Binner {
  private posX: number
  private posY: number
  private scale: number
  private maxes: number[]
  private k: number
  private cells: number

  constructor(info: MapInfo, readonly size = GRID) {
    this.posX = info.posX
    this.posY = info.posY
    this.scale = info.scale || 5
    this.maxes = info.levels.map((l) => l.altitudeMax)
    this.k = size / SIZE
    this.cells = size * size
  }

  level(z: number): number {
    for (let i = this.maxes.length - 1; i > 0; i--) {
      if (z < this.maxes[i]) return i
    }
    return 0
  }

  // cell returns level * size * size + cell index, or -1 off the radar.
  cell(x: number, y: number, z: number): number {
    const cx = Math.floor(((x - this.posX) / this.scale) * this.k)
    const cy = Math.floor(((this.posY - y) / this.scale) * this.k)
    if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return -1
    return this.level(z) * this.cells + cy * this.size + cx
  }

  put(g: HeatGrid, c: number, w = 1) {
    if (c < 0) return
    const lv = (c / this.cells) | 0
    const grid = g.levels[lv]
    if (!grid) return
    grid[c - lv * this.cells] += w
    g.samples += w
  }

  add(g: HeatGrid, x: number, y: number, z: number, w = 1) {
    this.put(g, this.cell(x, y, z), w)
  }

  radar(x: number, y: number): [number, number] {
    return [(x - this.posX) / this.scale, (this.posY - y) / this.scale]
  }
}

// findRoster finds the team most of the roster played on in a match, and
// the roster players on it in roster order. Roster players on the other
// team are left out. team is -1 when nobody from the roster played.
export function findRoster(players: Player[], roster: RosterPlayer[]): { team: number; players: number[] } {
  const want = new Map<string, number>()
  roster.forEach((p, i) => {
    const id = (p.steamId ?? '').trim()
    if (id && id !== '0' && !want.has(id)) want.set(id, i)
  })
  const count = [0, 0]
  for (const p of players) {
    if ((p.team === 0 || p.team === 1) && want.has(p.steamId)) count[p.team]++
  }
  if (!count[0] && !count[1]) return { team: -1, players: [] }
  const team = count[1] > count[0] ? 1 : 0
  const found = players
    .filter((p) => p.team === team && want.has(p.steamId))
    .sort((a, b) => want.get(a.steamId)! - want.get(b.steamId)! || a.index - b.index)
  return { team, players: found.map((p) => p.index) }
}

// sideIn is the side a player played in a round, 0 when they were not in
// it. Rounds without a player list fall back to the team's side.
export function sideIn(rd: Round, p: number, team: number): number {
  if (rd.players?.length) return rd.players.find((x) => x.player === p)?.side ?? 0
  return rd.sideOf?.[team] ?? 0
}

// shares turns place counts into shares, biggest first.
export function shares(counts: Map<string, number>): PlaceShare[] {
  let total = 0
  for (const n of counts.values()) total += n
  if (!total) return []
  return [...counts]
    .map(([place, n]) => ({ place, share: n / total }))
    .sort((a, b) => b.share - a.share || a.place.localeCompare(b.place))
}

// topSetups counts how often the same set of places came up, most common
// first. Order inside a set does not matter.
export function topSetups(groups: string[][], limit = SETUPS): CtSetup[] {
  const seen = new Map<string, CtSetup>()
  for (const g of groups) {
    if (!g.length) continue
    const places = [...g].sort()
    const key = places.join('|')
    const s = seen.get(key)
    if (s) s.count++
    else seen.set(key, { places, count: 1 })
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || b.places.length - a.places.length || a.places.join().localeCompare(b.places.join()))
    .slice(0, limit)
}

function count(m: Map<string, number>, key: string) {
  m.set(key, (m.get(key) ?? 0) + 1)
}

// placeAt is the place name of player p at frame f. With back set it walks
// back to the last frame they were alive, down to frame from.
function placeAt(r: Replay, p: number, f: number, from: number, back: boolean): string {
  if (!r.pplace.length) return ''
  const F = r.frames
  for (let k = f; k >= from; k--) {
    const i = p * F + k
    if (r.pflags[i] & FLAG.alive) return r.placeName(r.pplace[i])
    if (!back) return ''
  }
  return ''
}

// firstOnSite returns the tick a T of the team first stood on the site,
// or -1.
function firstOnSite(r: Replay, a: number, b: number, members: number[], site: string): number {
  const idx = r.places.indexOf(`Bombsite${site}`)
  if (idx <= 0 || !r.pplace.length) return -1
  const F = r.frames
  for (let f = a; f <= b; f++) {
    for (const p of members) {
      const i = p * F + f
      if (r.pplace[i] === idx && r.pside[i] === SIDE_T && r.pflags[i] & FLAG.alive) return r.tick[f]
    }
  }
  return -1
}

// liveStart is the tick a round went live. Some demos have no freeze end
// event and the parser uses the round start instead, so then it is the
// first frame players move, since nobody can move in freeze time.
export function liveStart(r: Replay, rd: Round): number {
  if (rd.freezeEndTick > rd.startTick || !r.frames) return rd.freezeEndTick
  const F = r.frames
  // Skip the first second, players are still being moved to their spawns.
  const a = r.frameIndex(rd.startTick + r.rate)
  const b = Math.min(r.frameIndex(rd.startTick + 40 * r.rate), r.frameIndex(rd.endTick))
  for (let f = Math.max(1, a + 1); f <= b; f++) {
    let moved = 0
    for (let p = 0; p < r.players; p++) {
      const i = p * F + f
      if (!(r.pflags[i] & FLAG.alive) || !(r.pflags[i - 1] & FLAG.alive)) continue
      const dx = r.px[i] - r.px[i - 1]
      const dy = r.py[i] - r.py[i - 1]
      if (dx * dx + dy * dy > 4) moved++
    }
    if (moved >= 2) return r.tick[f - 1]
  }
  return rd.freezeEndTick
}

// fitInfo centres the radar on everywhere players went, for maps without
// overview data. Same as MapView.fitToPlayers.
export function fitInfo(r: Replay, info: MapInfo): MapInfo {
  const levels = info.levels?.length ? info.levels : [{ name: 'default', altitudeMin: -1e6, altitudeMax: 1e6, image: '' }]
  if (info.known && info.scale) return { ...info, levels }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const F = r.frames
  for (let p = 0; p < r.players; p++) {
    for (let f = 0; f < F; f += 8) {
      const i = p * F + f
      if (!(r.pflags[i] & FLAG.alive)) continue
      minX = Math.min(minX, r.px[i])
      maxX = Math.max(maxX, r.px[i])
      minY = Math.min(minY, r.py[i])
      maxY = Math.max(maxY, r.py[i])
    }
  }
  if (!isFinite(minX)) return { ...info, levels, scale: info.scale || 5 }
  const span = Math.max(maxX - minX, maxY - minY, 1000) * 1.15
  return {
    ...info,
    levels,
    scale: span / SIZE,
    posX: (minX + maxX) / 2 - span / 2,
    posY: (minY + maxY) / 2 + span / 2,
  }
}

interface Spot {
  name: string
  level: number
  x: number
  y: number
  n: number
}

// LabelAcc gathers where callouts and bombsites are, for drawing them.
class LabelAcc {
  spots = new Map<string, Spot>()
  sites = new Map<string, Spot>()

  add(r: Replay, bin: Binner) {
    const F = r.frames
    if (r.pplace.length) {
      for (let p = 0; p < r.players; p++) {
        for (let f = 0; f < F; f += LABEL_STEP) {
          const i = p * F + f
          const place = r.pplace[i]
          if (!place || !(r.pflags[i] & FLAG.alive)) continue
          const name = r.placeName(place)
          const level = bin.level(r.pz[i])
          const key = `${name}|${level}`
          let s = this.spots.get(key)
          if (!s) {
            s = { name, level, x: 0, y: 0, n: 0 }
            this.spots.set(key, s)
          }
          const [x, y] = bin.radar(r.px[i], r.py[i])
          s.x += x
          s.y += y
          s.n++
        }
      }
    }
    for (const b of r.match.bombEvents ?? []) {
      if (b.kind !== 'planted' || !b.site) continue
      let s = this.sites.get(b.site)
      if (!s) {
        s = { name: b.site, level: bin.level(b.pos[2]), x: 0, y: 0, n: 0 }
        this.sites.set(b.site, s)
      }
      const [x, y] = bin.radar(b.pos[0], b.pos[1])
      s.x += x
      s.y += y
      s.n++
    }
  }

  finish(): MapLabels {
    const callouts: Callout[] = []
    for (const s of this.spots.values()) {
      if (s.n < 8 || !s.name || /spawn/i.test(s.name)) continue
      callouts.push({ name: s.name, x: s.x / s.n, y: s.y / s.n, level: s.level, weight: s.n })
    }
    callouts.sort((a, b) => b.weight - a.weight)
    const sites: Site[] = [...this.sites.values()].map((s) => ({ name: s.name, x: s.x / s.n, y: s.y / s.n, level: s.level }))
    for (const c of callouts) {
      const m = /^Bombsite ([AB])$/.exec(c.name)
      if (m && !sites.some((s) => s.name === m[1])) sites.push({ name: m[1], x: c.x, y: c.y, level: c.level })
    }
    sites.sort((a, b) => a.name.localeCompare(b.name))
    return { callouts: callouts.filter((c) => !/^Bombsite [AB]$/.test(c.name)), sites }
  }
}

// replayLabels finds the callouts and bombsites of one replay.
export function replayLabels(r: Replay, info: MapInfo): MapLabels {
  const acc = new LabelAcc()
  acc.add(r, new Binner(info))
  return acc.finish()
}

// What the renderer needs besides the scout itself: callouts, bombsites
// and the options the scout was built with.
const extras = new WeakMap<MapScout, { labels: MapLabels; opts: ScoutOptions }>()

export function scoutLabels(scout: MapScout): MapLabels | undefined {
  return extras.get(scout)?.labels
}

export function scoutOptions(scout: MapScout): ScoutOptions {
  return extras.get(scout)?.opts ?? DEFAULT_SCOUT_OPTIONS
}

interface PlayerAcc {
  steamId: string
  name: string
  order: number
  ctRounds: number
  tRounds: number
  ct: HeatGrid
  t: HeatGrid
  ctEarly: HeatGrid
  tEarly: HeatGrid
  ctPlaces: Map<string, number>
  tPlaces: Map<string, number>
  tEarlyPlaces: Map<string, number>
  kills: KillMark[]
  deaths: KillMark[]
  awp: { ct: number; t: number }
}

interface ExecAcc {
  site: string
  rounds: number
  hitSum: number
  positions: HeatGrid
  utility: UtilityMark[]
  plants: Vec3[]
}

interface HeatAcc {
  rounds: number
  won: number
  heat: HeatGrid
  places: Map<string, number>
  splits: Map<string, { rounds: number; won: number }>
}

interface PlantAcc extends HeatAcc {
  site: string
  plants: Vec3[]
}

interface Sides<T> {
  ct: T
  t: T
}

interface MapAcc {
  map: string
  info: MapInfo
  bin: Binner
  replays: ScoutReplay[]
  ctRounds: number
  tRounds: number
  won: { ct: number; t: number }
  team: { ct: HeatGrid; t: HeatGrid }
  players: Map<string, PlayerAcc>
  executes: Map<string, ExecAcc>
  noHit: number
  setups: string[][]
  labels: LabelAcc
  pistol: Sides<HeatAcc>
  eco: Sides<HeatAcc>
  awp: Sides<HeatAcc>
  utility: Sides<UtilityMark[]>
  openings: OpeningDuel[]
  postPlant: Map<string, PlantAcc>
  retake: Map<string, PlantAcc>
}

// Ctx is what every round of one replay needs.
interface Ctx {
  r: Replay
  acc: MapAcc
  team: number
  players: number[]
  pas: PlayerAcc[]
  // Player index to roster entry, for kills and grenades.
  byIndex: Map<number, PlayerAcc>
  // Pretty place names by index, worked out once per replay.
  places: string[]
  // Seconds between frames.
  dt: number
}

function heatAcc(levels: number): HeatAcc {
  return { rounds: 0, won: 0, heat: newGrid(levels), places: new Map(), splits: new Map() }
}

function sides<T>(make: () => T): Sides<T> {
  return { ct: make(), t: make() }
}

function vec(v: ArrayLike<number> | null | undefined): Vec3 {
  return [Number(v?.[0]) || 0, Number(v?.[1]) || 0, Number(v?.[2]) || 0]
}

function countRound(h: { rounds: number; won: number; splits?: Map<string, { rounds: number; won: number }> }, won: boolean, split?: string) {
  h.rounds++
  if (won) h.won++
  if (split && h.splits) {
    const sp = h.splits.get(split) ?? { rounds: 0, won: 0 }
    sp.rounds++
    if (won) sp.won++
    h.splits.set(split, sp)
  }
}

function finishHeat(h: HeatAcc): SideHeat {
  return {
    rounds: h.rounds,
    won: h.won,
    heat: h.heat,
    places: shares(h.places),
    splits: [...h.splits].map(([label, sp]) => ({ label, rounds: sp.rounds, won: sp.won })),
  }
}

// buyOf is the team's buy in a round: pistol, eco, force or full.
function buyOf(r: Replay, i: number, team: number): string {
  const buy = r.report?.rounds?.[i]?.buyType?.[team]
  if (buy) return buy
  const rs = r.match.rounds
  // Without the analysis, the first round of each half is the pistol.
  if (i === 0 || (i < 24 && rs[i - 1]?.sideOf?.[team] !== rs[i]?.sideOf?.[team])) return 'pistol'
  return ''
}

// openingKill is the first kill of a round between the two teams.
export function openingKill(kills: Kill[]): Kill | null {
  let best: Kill | null = null
  for (const k of kills) {
    if (k.killer < 0 || k.killer === k.victim || k.killerSide === k.victimSide) continue
    if (k.killerSide !== SIDE_T && k.killerSide !== SIDE_CT) continue
    if (!best || k.tick < best.tick) best = k
  }
  return best
}

// ScoutBuilder adds replays one at a time and keeps only the totals.
export class ScoutBuilder {
  readonly opts: ScoutOptions
  private maps = new Map<string, MapAcc>()

  constructor(
    private roster: RosterPlayer[],
    opts: Partial<ScoutOptions> = {},
  ) {
    this.opts = { ...DEFAULT_SCOUT_OPTIONS, ...opts }
  }

  private get earlyT(): number {
    return this.opts.earlyTSeconds ?? DEFAULT_SCOUT_OPTIONS.earlyTSeconds ?? 25
  }

  private mapFor(r: Replay, info: MapInfo): MapAcc {
    const name = r.match.map
    let acc = this.maps.get(name)
    if (!acc) {
      const fitted = fitInfo(r, info)
      const L = fitted.levels.length
      acc = {
        map: name,
        info: fitted,
        bin: new Binner(fitted),
        replays: [],
        ctRounds: 0,
        tRounds: 0,
        won: { ct: 0, t: 0 },
        team: { ct: newGrid(L), t: newGrid(L) },
        players: new Map(),
        executes: new Map(),
        noHit: 0,
        setups: [],
        labels: new LabelAcc(),
        pistol: sides(() => heatAcc(L)),
        eco: sides(() => heatAcc(L)),
        awp: sides(() => heatAcc(L)),
        utility: sides(() => []),
        openings: [],
        postPlant: new Map(),
        retake: new Map(),
      }
      this.maps.set(name, acc)
    }
    return acc
  }

  private playerFor(acc: MapAcc, r: Replay, p: number): PlayerAcc {
    const id = r.match.players[p].steamId
    let pa = acc.players.get(id)
    if (!pa) {
      const order = this.roster.findIndex((x) => x.steamId.trim() === id)
      const L = acc.info.levels.length
      pa = {
        steamId: id,
        name: this.roster[order]?.name || r.playerName(p),
        order,
        ctRounds: 0,
        tRounds: 0,
        ct: newGrid(L),
        t: newGrid(L),
        ctEarly: newGrid(L),
        tEarly: newGrid(L),
        ctPlaces: new Map(),
        tPlaces: new Map(),
        tEarlyPlaces: new Map(),
        kills: [],
        deaths: [],
        awp: { ct: 0, t: 0 },
      }
      acc.players.set(id, pa)
    }
    return pa
  }

  private execFor(acc: MapAcc, site: string): ExecAcc {
    let ex = acc.executes.get(site)
    if (!ex) {
      ex = { site, rounds: 0, hitSum: 0, positions: newGrid(acc.info.levels.length), utility: [], plants: [] }
      acc.executes.set(site, ex)
    }
    return ex
  }

  private plantFor(m: Map<string, PlantAcc>, acc: MapAcc, site: string): PlantAcc {
    let pl = m.get(site)
    if (!pl) {
      pl = { ...heatAcc(acc.info.levels.length), site, plants: [] }
      m.set(site, pl)
    }
    return pl
  }

  // add reads one replay. It returns false when nobody from the roster
  // played in it. date is when the match was played in unix seconds, 0
  // when not known.
  add(r: Replay, id: string, name: string, info: MapInfo, date = 0): boolean {
    const { team, players } = findRoster(r.match.players, this.roster)
    if (team < 0 || !r.frames) return false
    const acc = this.mapFor(r, info)
    const pas = players.map((p) => this.playerFor(acc, r, p))
    const byIndex = new Map<number, PlayerAcc>()
    players.forEach((p, k) => byIndex.set(p, pas[k]))
    const span = r.frames > 1 ? (r.tick[r.frames - 1] - r.tick[0]) / (r.frames - 1) : 2
    const ctx: Ctx = { r, acc, team, players, pas, byIndex, places: r.places.map((_, i) => r.placeName(i)), dt: span / r.rate }
    let rounds = 0
    r.match.rounds.forEach((rd, i) => {
      const side = rd.sideOf?.[team]
      if ((side !== SIDE_T && side !== SIDE_CT) || rd.endTick <= rd.freezeEndTick) return
      rounds++
      this.round(ctx, i)
    })
    const ours = r.match.teams?.[team]?.score ?? 0
    const theirs = r.match.teams?.[1 - team]?.score ?? 0
    acc.replays.push({
      id,
      name,
      rounds,
      won: ours > theirs ? true : ours < theirs ? false : null,
      score: `${ours}-${theirs}`,
      opponent: r.teamName(1 - team),
      date,
    })
    acc.labels.add(r, acc.bin)
    return true
  }

  private round(ctx: Ctx, i: number) {
    const { r, acc, team, players, pas } = ctx
    const rd = r.match.rounds[i]
    const side = rd.sideOf[team]
    const ct = side === SIDE_CT
    const won = rd.winnerTeam === team
    if (ct) acc.ctRounds++
    else acc.tRounds++
    if (won) {
      if (ct) acc.won.ct++
      else acc.won.t++
    }
    const live = liveStart(r, rd)
    const a = r.frameIndex(live)
    const b = r.frameIndex(rd.endTick)
    const early = Math.min(b, r.frameIndex(live + this.opts.earlyCtSeconds * r.rate))
    const earlyT = Math.min(b, r.frameIndex(live + this.earlyT * r.rate))
    const buy = buyOf(r, i, team)
    const key = ct ? 'ct' : 't'
    const pistol = buy === 'pistol' ? acc.pistol[key] : null
    const eco = buy === 'eco' || buy === 'force' ? acc.eco[key] : null
    if (pistol) countRound(pistol, won)
    if (eco) countRound(eco, won, buy === 'eco' ? 'Eco' : 'Force')
    const awp = acc.awp[key]
    let awpSeen = false

    const F = r.frames
    const { px, py, pz, pflags, pside, pplace, pweapon } = r
    const bin = acc.bin
    const names = ctx.places
    const hasPlace = pplace.length > 0
    const step = STEP * ctx.dt
    players.forEach((p, k) => {
      const pa = pas[k]
      const ps = sideIn(rd, p, team)
      if (ps === SIDE_CT) pa.ctRounds++
      else if (ps === SIDE_T) pa.tRounds++
      else return
      const base = p * F
      for (let f = a; f <= b; f += STEP) {
        const j = base + f
        if (!(pflags[j] & FLAG.alive)) continue
        const s = pside[j]
        if (s !== SIDE_CT && s !== SIDE_T) continue
        const c = bin.cell(px[j], py[j], pz[j])
        if (c < 0) continue
        const place = hasPlace ? names[pplace[j]] : ''
        if (s === SIDE_CT) {
          bin.put(pa.ct, c)
          bin.put(acc.team.ct, c)
          if (f <= early) bin.put(pa.ctEarly, c)
        } else {
          bin.put(pa.t, c)
          bin.put(acc.team.t, c)
          if (f <= earlyT) bin.put(pa.tEarly, c)
        }
        if (pistol) addHeat(bin, pistol, c, place)
        if (eco) addHeat(bin, eco, c, place)
        if (pweapon[j] === AWP) {
          awpSeen = true
          addHeat(bin, awp, c, place)
          if (s === SIDE_CT) pa.awp.ct += step
          else pa.awp.t += step
        }
      }
    })
    if (awpSeen) countRound(awp, won)
    if (ct) this.ctSetup(ctx, rd, a, early)
    else {
      this.execute(ctx, i, live, a, b)
      this.tEarly(ctx, rd, a, earlyT)
    }
    this.afterPlant(ctx, i, b, ct, won)
    this.kills(ctx, i, live)
    this.utility(ctx, i)
  }

  // ctSetup records where everyone stood at the early CT moment. Players
  // who died before it count where they died.
  private ctSetup(ctx: Ctx, rd: Round, a: number, at: number) {
    const { r, team, players, pas, acc } = ctx
    players.forEach((p, k) => {
      if (sideIn(rd, p, team) !== SIDE_CT) return
      const place = placeAt(r, p, at, a, true)
      if (place) count(pas[k].ctPlaces, place)
    })
    const setup: string[] = []
    for (const p of r.teamPlayers[team]) {
      if (sideIn(rd, p, team) !== SIDE_CT) continue
      const place = placeAt(r, p, at, a, true)
      if (place) setup.push(place)
    }
    if (setup.length) acc.setups.push(setup)
  }

  // tEarly records where each T went for map control.
  private tEarly(ctx: Ctx, rd: Round, a: number, at: number) {
    const { r, team, players, pas } = ctx
    players.forEach((p, k) => {
      if (sideIn(rd, p, team) !== SIDE_T) return
      const place = placeAt(r, p, at, a, true)
      if (place) count(pas[k].tEarlyPlaces, place)
    })
  }

  // execute records a T round: which site, when, how they got there and
  // the utility that went with it. A planted site wins over the first site
  // stepped on, so fakes count as the site they really went for.
  private execute(ctx: Ctx, i: number, live: number, a: number, b: number) {
    const { r, acc, team, players, pas } = ctx
    const rd = r.match.rounds[i]
    const info = r.report?.rounds?.[i]
    const bomb = r.roundBomb[i] ?? []
    const plant = bomb.find((e) => e.kind === 'planted')
    const site = plant?.site || info?.hit || ''
    let hitTick = -1
    if (site) {
      // The analysis counts the hit time from its own freeze end.
      hitTick = info && info.hit === site && info.hitTime >= 0 ? rd.freezeEndTick + info.hitTime * r.rate : firstOnSite(r, a, b, r.teamPlayers[team], site)
      if (hitTick < 0 && plant) hitTick = plant.tick
    }
    if (!site || hitTick < 0) {
      acc.noHit++
      return
    }
    const rate = r.rate
    hitTick = Math.max(live, hitTick)
    const ex = this.execFor(acc, site)
    ex.rounds++
    ex.hitSum += (hitTick - live) / rate
    const h = Math.max(a, Math.min(b, r.frameIndex(hitTick)))
    const from = Math.max(a, r.frameIndex(hitTick - this.opts.preHitSeconds * rate))
    const F = r.frames
    const bin = acc.bin
    const names = new Map<number, string>()
    players.forEach((p, k) => {
      if (sideIn(rd, p, team) !== SIDE_T) return
      names.set(p, pas[k].name)
      const base = p * F
      for (let f = from; f <= h; f += FINE_STEP) {
        const j = base + f
        if (!(r.pflags[j] & FLAG.alive) || r.pside[j] !== SIDE_T) continue
        bin.add(ex.positions, r.px[j], r.py[j], r.pz[j])
      }
      const place = placeAt(r, p, h, h, false)
      if (place) count(pas[k].tPlaces, place)
    })
    const t0 = hitTick - this.opts.utilitySeconds * rate
    const t1 = hitTick + AFTER_HIT * rate
    for (const g of r.roundGrenades[i] ?? []) {
      if (!names.has(g.thrower) || g.side !== SIDE_T || g.effectTick < 0) continue
      if (g.effectTick < t0 || g.effectTick > t1) continue
      ex.utility.push({ type: g.type, pos: vec(g.pos), player: names.get(g.thrower)!, from: throwSpot(r, g) })
    }
    for (const e of bomb) {
      if (e.kind === 'planted' && (!e.site || e.site === site)) ex.plants.push(vec(e.pos))
    }
  }

  // afterPlant records the T side holding a plant and the CT side going
  // for the retake, per site.
  private afterPlant(ctx: Ctx, i: number, b: number, ct: boolean, won: boolean) {
    const { r, acc, team, players } = ctx
    const plant = (r.roundBomb[i] ?? []).find((e) => e.kind === 'planted')
    if (!plant?.site) return
    const pl = this.plantFor(ct ? acc.retake : acc.postPlant, acc, plant.site)
    countRound(pl, won)
    pl.plants.push(vec(plant.pos))
    const want = ct ? SIDE_CT : SIDE_T
    const rd = r.match.rounds[i]
    const F = r.frames
    const from = r.frameIndex(plant.tick)
    for (const p of players) {
      if (sideIn(rd, p, team) !== want) continue
      const base = p * F
      for (let f = from; f <= b; f += FINE_STEP) {
        const j = base + f
        if (!(r.pflags[j] & FLAG.alive) || r.pside[j] !== want) continue
        const c = acc.bin.cell(r.px[j], r.py[j], r.pz[j])
        if (c >= 0) addHeat(acc.bin, pl, c, r.pplace.length ? ctx.places[r.pplace[j]] : '')
      }
    }
  }

  // kills records the roster's kills, deaths and the opening duel.
  private kills(ctx: Ctx, i: number, live: number) {
    const { r, acc, team, byIndex } = ctx
    const list = r.roundKills[i] ?? []
    const first = openingKill(list)
    for (const k of list) {
      const killer = byIndex.get(k.killer)
      const victim = byIndex.get(k.victim)
      const opening = k === first
      if (killer && k.killer !== k.victim && k.killerSide !== k.victimSide) {
        killer.kills.push(mark(k, k.killerSide, prettyPlace(k.killerPlace ?? ''), killer.name, opening))
      }
      if (victim) victim.deaths.push(mark(k, k.victimSide, prettyPlace(k.victimPlace ?? ''), victim.name, opening))
    }
    if (!first) return
    const ours = r.match.players[first.killer]?.team === team
    const theirs = r.match.players[first.victim]?.team === team
    if (!ours && !theirs) return
    const p = ours ? first.killer : first.victim
    acc.openings.push({
      side: ours ? first.killerSide : first.victimSide,
      won: ours,
      killer: vec(first.killerPos),
      victim: vec(first.victimPos),
      player: byIndex.get(p)?.name ?? r.playerName(p),
      place: prettyPlace((ours ? first.killerPlace : first.victimPlace) ?? ''),
      weapon: first.weapon,
      time: Math.max(0, (first.tick - live) / r.rate),
    })
  }

  // utility records where the roster's grenades went off and where they
  // were thrown from. Decoys are left out.
  private utility(ctx: Ctx, i: number) {
    const { r, acc, byIndex } = ctx
    for (const g of r.roundGrenades[i] ?? []) {
      const pa = byIndex.get(g.thrower)
      if (!pa || g.type < EQ.molotov || g.type > EQ.he) continue
      const list = g.side === SIDE_CT ? acc.utility.ct : g.side === SIDE_T ? acc.utility.t : null
      if (!list) continue
      const pos = vec(g.pos)
      if (!pos[0] && !pos[1]) continue
      list.push({ type: g.type, pos, player: pa.name, from: throwSpot(r, g) })
    }
  }

  result(): MapScout[] {
    const out: MapScout[] = []
    const maps = [...this.maps.values()].sort((a, b) => b.replays.length - a.replays.length || a.map.localeCompare(b.map))
    for (const acc of maps) {
      const players: PlayerScout[] = [...acc.players.values()]
        .filter((pa) => pa.ctRounds + pa.tRounds > 0)
        .sort((a, b) => (a.order < 0 ? 1e9 : a.order) - (b.order < 0 ? 1e9 : b.order) || a.name.localeCompare(b.name))
        .map((pa) => ({
          steamId: pa.steamId,
          name: pa.name,
          ctRounds: pa.ctRounds,
          tRounds: pa.tRounds,
          ct: pa.ct,
          t: pa.t,
          ctEarly: pa.ctEarly,
          tEarly: pa.tEarly,
          ctPlaces: shares(pa.ctPlaces),
          tPlaces: shares(pa.tPlaces),
          tEarlyPlaces: shares(pa.tEarlyPlaces),
          kills: pa.kills,
          deaths: pa.deaths,
          awp: pa.awp,
        }))
      const executes: SiteExecute[] = [...acc.executes.values()]
        .map((ex) => ({
          site: ex.site,
          rounds: ex.rounds,
          share: acc.tRounds ? ex.rounds / acc.tRounds : 0,
          avgHitTime: ex.rounds ? ex.hitSum / ex.rounds : 0,
          positions: ex.positions,
          utility: ex.utility,
          plants: ex.plants,
        }))
        .sort((a, b) => b.rounds - a.rounds || a.site.localeCompare(b.site))
      const plants = (m: Map<string, PlantAcc>): PlantScout[] =>
        [...m.values()]
          .map((pl) => ({ site: pl.site, rounds: pl.rounds, won: pl.won, heat: pl.heat, plants: pl.plants, places: shares(pl.places) }))
          .sort((a, b) => b.rounds - a.rounds || a.site.localeCompare(b.site))
      const scout: MapScout = {
        map: acc.map,
        info: acc.info,
        replays: [...acc.replays].sort((a, b) => b.date - a.date),
        ctRounds: acc.ctRounds,
        tRounds: acc.tRounds,
        won: acc.won,
        team: acc.team,
        players,
        executes,
        noHit: acc.noHit,
        ctSetups: topSetups(acc.setups),
        pistol: { ct: finishHeat(acc.pistol.ct), t: finishHeat(acc.pistol.t) },
        eco: { ct: finishHeat(acc.eco.ct), t: finishHeat(acc.eco.t) },
        awp: { ct: finishHeat(acc.awp.ct), t: finishHeat(acc.awp.t) },
        utility: acc.utility,
        openings: acc.openings,
        postPlant: plants(acc.postPlant),
        retake: plants(acc.retake),
      }
      extras.set(scout, { labels: acc.labels.finish(), opts: this.opts })
      out.push(scout)
    }
    return out
  }
}

function addHeat(bin: Binner, h: HeatAcc, c: number, place: string) {
  bin.put(h.heat, c)
  if (place) h.places.set(place, (h.places.get(place) ?? 0) + 1)
}

function mark(k: Kill, side: number, place: string, player: string, opening: boolean): KillMark {
  return { killer: vec(k.killerPos), victim: vec(k.victimPos), side, weapon: k.weapon, headshot: !!k.headshot, opening, place, player }
}

// throwSpot is where a grenade left the thrower's hand: the start of its
// recorded path, or where the thrower stood.
function throwSpot(r: Replay, g: Grenade): Vec3 | undefined {
  if (g.pathLen > 0 && g.pathStart >= 0 && g.pathStart < r.nade.x.length) {
    const k = g.pathStart
    return [r.nade.x[k], r.nade.y[k], r.nade.z[k]]
  }
  if (g.thrower < 0 || g.thrower >= r.players || !r.frames) return undefined
  const j = g.thrower * r.frames + r.frameIndex(g.throwTick)
  return [r.px[j], r.py[j], r.pz[j]]
}

// entryDate reads a play date from a library entry, if the server sends
// one.
function entryDate(e: object): number {
  const o = e as Record<string, unknown>
  for (const k of ['playedAt', 'startedAt', 'matchDate', 'date']) {
    const v = o[k]
    if (typeof v === 'number' && v > 0) return v > 1e12 ? Math.round(v / 1000) : v
    if (typeof v === 'string' && v) {
      const t = Date.parse(v)
      if (!isNaN(t)) return Math.round(t / 1000)
    }
  }
  return 0
}

const infos = new Map<string, Promise<MapInfo>>()

// scoutMapInfo is the map's overview data, or a stand in when the server
// does not know the map.
export function scoutMapInfo(name: string): Promise<MapInfo> {
  let p = infos.get(name)
  if (!p) {
    p = mapInfo(name).catch(() => {
      infos.delete(name)
      return {
        name, posX: 0, posY: 0, scale: 0, size: SIZE, known: false,
        levels: [{ name: 'default', altitudeMin: -1e6, altitudeMax: 1e6, image: '' }],
      }
    })
    infos.set(name, p)
  }
  return p
}

// buildScout loads the replays one at a time and adds up everything the
// roster did in them, per map. Replays that fail to load are skipped.
export async function buildScout(
  replayIds: string[],
  roster: RosterPlayer[],
  opts?: Partial<ScoutOptions>,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<MapScout[]> {
  const builder = new ScoutBuilder(roster, opts)
  const names = new Map<string, string>()
  const dates = new Map<string, number>()
  try {
    const { replays } = await listReplays()
    for (const e of replays ?? []) {
      names.set(e.id, e.name)
      dates.set(e.id, entryDate(e))
    }
  } catch {
    // names and dates are only for display
  }
  const total = replayIds.length
  let failed: unknown = null
  let loaded = 0
  for (let k = 0; k < total; k++) {
    const id = replayIds[k]
    const name = names.get(id) ?? id
    onProgress?.(k, total, name)
    try {
      // The replay goes out of scope here, only the totals stay.
      const r = await loadReplay(id)
      builder.add(r, id, name, await scoutMapInfo(r.match.map), dates.get(id) ?? 0)
      loaded++
    } catch (e) {
      failed = e
    }
    // Give the page a moment to paint progress between replays.
    await new Promise((res) => setTimeout(res, 0))
  }
  onProgress?.(total, total, '')
  if (!loaded && failed) throw failed
  return builder.result()
}
