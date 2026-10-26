// Situational scouting: what the roster does on one side with one buy,
// like T pistol rounds or CT force buys. Works out map zones, reads each
// round (rush, stack, push, save), keeps the first seconds of every round
// as a track and writes plain notes with the numbers behind them.

import { SLOT_COLORS } from '../colors'
import { FLAG, lerpAngle, type Replay } from '../replay'
import type { Grenade } from '../types'
import { EQ } from '../weapons'
import type { Binner } from './aggregate'
import type { BuyKind, HeatGrid, Situation, SituationTrack, TrackEvent, TrackPlayer, Zone } from './types'

const SIDE_T = 2
const SIDE_CT = 3

// Samples per second when reading how players move between places.
const REACH_RATE = 8
// A place belongs to a site when players there reach it this soon...
const REACH_SECONDS = 10
// ...in at least this share of the samples, on average within this many
// seconds, and 3 times as often as the other site.
const REACH_SHARE = 0.12
const REACH_AVG = 5
const REACH_RATIO = 3
// Places where players reach both sites at least this often are mid.
const BOTH_SHARE = 0.04
// Places players stood in for less than this many seconds in total use
// the distance to the sites.
const MIN_SECONDS = 8
// A jump this long between two frames is a respawn, not a walk.
const TELEPORT = 300

// Contact this soon counts for a CT push.
const PUSH_SECONDS = 20
// Saving players are this far from the bomb and from every enemy.
const SAVE_BOMB = 1200
const SAVE_ENEMY = 1000
// Utility that went off this long after the hit still belongs to it.
export const AFTER_HIT = 3

// Colours per roster player, in roster order: the slot colours first.
export const ROSTER_COLORS = [...SLOT_COLORS.slice(0, 5), '#ff6fae', '#4fd6d0', '#c6e05a', '#f2f2f2', '#ffb08a']

export function rosterColor(order: number): string {
  return ROSTER_COLORS[Math.max(0, order) % ROSTER_COLORS.length]
}

export const BUY_ORDER: BuyKind[] = ['pistol', 'eco', 'force', 'antieco', 'full']

const BUY_TITLE: Record<BuyKind, string> = {
  pistol: 'pistol rounds',
  eco: 'eco rounds',
  force: 'force buys',
  antieco: 'anti-eco rounds',
  full: 'full buys',
}

export function situationTitle(side: 'ct' | 't', buy: BuyKind): string {
  return `${side.toUpperCase()} ${BUY_TITLE[buy]}`
}

// ---- Zones ----

export interface SiteSpot {
  name: string
  x: number
  y: number
  z: number
}

// ZoneMap gives every position of one replay a zone.
//
// The rule: a player on BombsiteA or BombsiteB is on that site, and a
// place with "mid" in its name is mid. Other places are read from how
// players move: a place belongs to a site when players there walk onto it
// within REACH_SECONDS in at least REACH_SHARE of the samples, within
// REACH_AVG seconds on average, and REACH_RATIO times as often as onto the
// other site. Places that lead to both sites are mid, the rest is other.
// This follows the real paths, so it works on maps like Nuke where the
// sites are on top of each other. Positions without a place, or places
// players hardly visited, go to the nearest site when close enough.
export interface ZoneMap {
  byPlace: (Zone | null)[]
  sites: SiteSpot[]
  // Distance between the two sites, 0 with fewer than two.
  siteDist: number
  // Distance to a site that still counts as on it, for positions
  // without a usable place.
  radius: number
  tSpawn: [number, number] | null
  ctSpawn: [number, number] | null
}

// spotDist is the distance used for zones: flat distance plus twice the
// height difference, so floors above and below count as far.
export function spotDist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by) + 2 * Math.abs(az - bz)
}

// buildZones reads one replay. lives are the ticks each round went live.
export function buildZones(r: Replay, lives: number[]): ZoneMap {
  const F = r.frames
  const n = r.places.length
  const hasPlace = r.pplace.length > 0 && n > 1
  const sum = new Float64Array(n * 3)
  const tot = new Float64Array(n)
  const ra = new Float64Array(n)
  const rb = new Float64Array(n)
  const ta = new Float64Array(n)
  const tb = new Float64Array(n)
  const ia = hasPlace ? r.places.indexOf('BombsiteA') : -1
  const ib = hasPlace ? r.places.indexOf('BombsiteB') : -1
  const W = REACH_SECONDS * r.rate
  const fps = F > 1 && r.tick[F - 1] > r.tick[0] ? ((F - 1) * r.rate) / (r.tick[F - 1] - r.tick[0]) : 1
  const step = Math.max(1, Math.round(fps / REACH_RATE))
  // Samples that make up MIN_SECONDS.
  const enough = (MIN_SECONDS * fps) / step
  if (hasPlace) {
    for (let p = 0; p < r.players; p++) {
      const base = p * F
      // Walk back in time, keeping the next tick this player stands on
      // each site.
      let na = Infinity
      let nb = Infinity
      for (let f = F - 1; f >= 0; f--) {
        const i = base + f
        if (!(r.pflags[i] & FLAG.alive)) {
          na = nb = Infinity
          continue
        }
        if (f + 1 < F) {
          const dx = r.px[i + 1] - r.px[i]
          const dy = r.py[i + 1] - r.py[i]
          if (dx * dx + dy * dy > TELEPORT * TELEPORT) na = nb = Infinity
        }
        const k = r.pplace[i]
        const t = r.tick[f]
        if (k === ia && ia > 0) na = t
        if (k === ib && ib > 0) nb = t
        if (f % step || !k) continue
        tot[k]++
        sum[k * 3] += r.px[i]
        sum[k * 3 + 1] += r.py[i]
        sum[k * 3 + 2] += r.pz[i]
        const da = na - t
        const db = nb - t
        if (da <= W && da <= db) {
          ra[k]++
          ta[k] += da / r.rate
        } else if (db <= W) {
          rb[k]++
          tb[k] += db / r.rate
        }
      }
    }
  }
  const sites: SiteSpot[] = []
  const centre = (k: number): SiteSpot | null =>
    k > 0 && tot[k] >= enough / 4 ? { name: '', x: sum[k * 3] / tot[k], y: sum[k * 3 + 1] / tot[k], z: sum[k * 3 + 2] / tot[k] } : null
  for (const [name, k] of [['A', ia], ['B', ib]] as const) {
    let s = centre(k)
    if (!s) {
      // No players on the site place: use where the bomb went down.
      let x = 0
      let y = 0
      let z = 0
      let c = 0
      for (const e of r.match.bombEvents ?? []) {
        if (e.kind !== 'planted' || e.site !== name) continue
        x += e.pos[0]
        y += e.pos[1]
        z += e.pos[2]
        c++
      }
      if (c) s = { name, x: x / c, y: y / c, z: z / c }
    }
    if (s) sites.push({ ...s, name })
  }
  const siteDist = sites.length === 2 ? spotDist(sites[0].x, sites[0].y, sites[0].z, sites[1].x, sites[1].y, sites[1].z) : 0
  const radius = siteDist ? Math.min(900, Math.max(350, siteDist * 0.3)) : 700
  const zm: ZoneMap = { byPlace: new Array(n).fill(null), sites, siteDist, radius, tSpawn: null, ctSpawn: null }
  for (let k = 1; k < n; k++) {
    const name = r.places[k] ?? ''
    const m = /^Bombsite([AB])$/.exec(name)
    if (m) zm.byPlace[k] = m[1] as Zone
    else if (/mid/i.test(name)) zm.byPlace[k] = 'mid'
    else if (tot[k] >= enough) {
      const sa = ra[k] / tot[k]
      const sb = rb[k] / tot[k]
      const avgA = ra[k] ? ta[k] / ra[k] : Infinity
      const avgB = rb[k] ? tb[k] / rb[k] : Infinity
      if (sa >= REACH_SHARE && sa >= REACH_RATIO * sb && avgA <= REACH_AVG) zm.byPlace[k] = 'A'
      else if (sb >= REACH_SHARE && sb >= REACH_RATIO * sa && avgB <= REACH_AVG) zm.byPlace[k] = 'B'
      else if (sa >= BOTH_SHARE && sb >= BOTH_SHARE) zm.byPlace[k] = 'mid'
      else zm.byPlace[k] = 'other'
    } else if (tot[k] > 0) {
      zm.byPlace[k] = nearSite(zm, sum[k * 3] / tot[k], sum[k * 3 + 1] / tot[k], sum[k * 3 + 2] / tot[k])
    }
  }
  // Spawns are where each side stands when the round goes live.
  const sp = [0, 0, 0, 0, 0, 0]
  r.match.rounds.forEach((rd, i) => {
    const live = lives[i] ?? rd.freezeEndTick
    if (rd.endTick <= live) return
    const f = r.frameIndex(live)
    for (let p = 0; p < r.players; p++) {
      const j = p * F + f
      if (!(r.pflags[j] & FLAG.alive)) continue
      const o = r.pside[j] === SIDE_T ? 0 : r.pside[j] === SIDE_CT ? 3 : -1
      if (o < 0) continue
      sp[o] += r.px[j]
      sp[o + 1] += r.py[j]
      sp[o + 2]++
    }
  })
  if (sp[2]) zm.tSpawn = [sp[0] / sp[2], sp[1] / sp[2]]
  if (sp[5]) zm.ctSpawn = [sp[3] / sp[5], sp[4] / sp[5]]
  return zm
}

// nearSite is the site a position is close to, or other.
export function nearSite(zm: ZoneMap, x: number, y: number, z: number): Zone {
  let best: Zone = 'other'
  let bd = zm.radius
  for (const s of zm.sites) {
    const d = spotDist(x, y, z, s.x, s.y, s.z)
    if (d < bd) {
      bd = d
      best = s.name as Zone
    }
  }
  return best
}

// zoneAt is the zone of sample j (player * frames + frame).
export function zoneAt(zm: ZoneMap, r: Replay, j: number): Zone {
  const k = r.pplace.length ? r.pplace[j] : 0
  const z = k ? zm.byPlace[k] : null
  return z ?? nearSite(zm, r.px[j], r.py[j], r.pz[j])
}

// tTerritory is true for positions outside the site zones that are closer
// to the T spawn than to the CT spawn.
export function tTerritory(zm: ZoneMap, zone: Zone, x: number, y: number): boolean {
  if (zone === 'A' || zone === 'B' || !zm.tSpawn || !zm.ctSpawn) return false
  const dt = Math.hypot(x - zm.tSpawn[0], y - zm.tSpawn[1])
  const dc = Math.hypot(x - zm.ctSpawn[0], y - zm.ctSpawn[1])
  return dt < dc
}

export function siteSpot(zm: ZoneMap, name: string): SiteSpot | undefined {
  return zm.sites.find((s) => s.name === name)
}

// ---- Rounds ----

// buyKind is the roster team's buy in a round. Without the analysis it
// falls back to the equipment value, the same split the server uses.
export function buyKind(r: Replay, i: number, team: number): BuyKind {
  const info = r.report?.rounds?.[i]?.buyType
  let ours = info?.[team] ?? ''
  let theirs = info?.[1 - team] ?? ''
  if (!ours) {
    const rs = r.match.rounds
    if (i === 0 || (i < 24 && rs[i - 1]?.sideOf?.[team] !== rs[i]?.sideOf?.[team])) return 'pistol'
    ours = valueBuy(r, i, team)
    theirs = valueBuy(r, i, 1 - team)
  }
  if (ours === 'pistol') return 'pistol'
  if (ours === 'eco') return 'eco'
  if (ours === 'force') return 'force'
  if (theirs === 'eco' || theirs === 'force') return 'antieco'
  return 'full'
}

function valueBuy(r: Replay, i: number, team: number): string {
  let sum = 0
  let n = 0
  for (const rp of r.match.rounds[i]?.players ?? []) {
    if (r.match.players[rp.player]?.team !== team) continue
    sum += rp.equipValue
    n++
  }
  if (!n) return 'full'
  const avg = sum / n
  return avg < 1000 ? 'eco' : avg < 4000 ? 'force' : 'full'
}

// firstOnSite returns the tick a T of the team first stood on the site
// between frames a and b, or -1.
export function firstOnSite(r: Replay, a: number, b: number, members: number[], site: string): number {
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

// siteHit is the site the T side of a round went for and the tick the
// first of them got there. A planted site wins over the first site
// stepped on, so fakes count as the site they really went for.
export function siteHit(r: Replay, i: number, tTeam: number, live: number): { site: string; tick: number } {
  const rd = r.match.rounds[i]
  const info = r.report?.rounds?.[i]
  const plant = (r.roundBomb[i] ?? []).find((e) => e.kind === 'planted')
  const site = plant?.site || info?.hit || ''
  if (!site) return { site: '', tick: -1 }
  let tick = -1
  // The analysis counts the hit time from its own freeze end.
  if (info && info.hit === site && info.hitTime >= 0) tick = rd.freezeEndTick + info.hitTime * r.rate
  else tick = firstOnSite(r, r.frameIndex(live), r.frameIndex(rd.endTick), r.teamPlayers[tTeam] ?? [], site)
  if (tick < 0 && plant) tick = plant.tick
  if (tick < 0) return { site: '', tick: -1 }
  return { site, tick: Math.max(live, tick) }
}

// Contact is a fight between the two teams: p hit, shot at or killed q.
export interface Contact {
  tick: number
  p: number
  q: number
}

// contacts lists the fights of a round in time order: gun damage, kills
// and, for demos without damage, the first shot of each duel.
export function contacts(r: Replay, i: number): Contact[] {
  const out: Contact[] = []
  const team = (p: number) => r.match.players[p]?.team ?? -1
  const enemies = (p: number, q: number) => p >= 0 && q >= 0 && p !== q && team(p) >= 0 && team(q) >= 0 && team(p) !== team(q)
  const dmg = r.roundDamages[i] ?? []
  for (const d of dmg) {
    if (d.weapon > 0 && d.weapon < 400 && enemies(d.attacker, d.victim)) out.push({ tick: d.tick, p: d.attacker, q: d.victim })
  }
  for (const k of r.roundKills[i] ?? []) {
    if (enemies(k.killer, k.victim)) out.push({ tick: k.tick, p: k.killer, q: k.victim })
  }
  if (!dmg.length) {
    for (const e of r.engagements) {
      if (e.round !== i || e.firstShotTick < 0 || !enemies(e.attacker, e.victim)) continue
      out.push({ tick: e.firstShotTick, p: e.attacker, q: e.victim })
    }
  }
  return out.sort((a, b) => a.tick - b.tick)
}

// RoundCtx is one round of one replay from the roster's point of view.
export interface RoundCtx {
  r: Replay
  i: number
  team: number
  // 2 = T, 3 = CT.
  side: number
  won: boolean
  // Tick the round went live and the frames from there to the end.
  live: number
  a: number
  b: number
  // Roster players on the side this round, their names and colours.
  players: number[]
  names: string[]
  ids: string[]
  colors: string[]
  zones: ZoneMap
  bin: Binner
}

// RoundRead is what a round says about the team.
export interface RoundRead {
  buy: BuyKind
  side: 'ct' | 't'
  won: boolean
  // The site the T side went for, '' when none, and when they got there.
  hit: string
  hitTick: number
  hitTime: number
  plantTick: number
  plantSite: string
  rush: boolean
  setupFrame: number
  // Per roster player: zone and pretty place at the setup moment (where
  // they died when that was before it) and if they were still alive.
  setupZones: Zone[]
  setupPlaces: string[]
  setupAlive: boolean[]
  // CT: site with 3 or more players at the setup moment and how many.
  stack: string
  stackSize: number
  // CT: the roster player (index into players) who pushed, and where.
  push: { k: number; place: string } | null
  // Players saving at the end of a lost round.
  saved: number
  fights: Contact[]
}

export interface ReadOptions {
  rushSeconds: number
  setupSeconds: number
}

// lastAlive is the last frame from f back to a where sample base + f is
// alive, or -1.
export function lastAlive(r: Replay, base: number, f: number, a: number): number {
  for (let k = f; k >= a; k--) if (r.pflags[base + k] & FLAG.alive) return k
  return -1
}

// stackNeed is how many players make a stack: 3, or both players in
// wingman.
export function stackNeed(players: number): number {
  return Math.min(3, Math.max(2, players))
}

export function readRound(ctx: RoundCtx, opts: ReadOptions): RoundRead {
  const { r, i, team, side, live, a, b, players, zones } = ctx
  const F = r.frames
  const rate = r.rate
  const ct = side === SIDE_CT
  const rd = r.match.rounds[i]
  const hit = siteHit(r, i, ct ? 1 - team : team, live)
  const plant = (r.roundBomb[i] ?? []).find((e) => e.kind === 'planted')
  const hitTime = hit.tick >= 0 ? (hit.tick - live) / rate : -1
  const setupFrame = Math.max(a, Math.min(b, r.frameIndex(live + opts.setupSeconds * rate)))
  const read: RoundRead = {
    buy: buyKind(r, i, team),
    side: ct ? 'ct' : 't',
    won: ctx.won,
    hit: hit.site,
    hitTick: hit.tick,
    hitTime,
    plantTick: plant ? plant.tick : -1,
    plantSite: plant?.site ?? '',
    rush: !ct && hit.site !== '' && hitTime <= opts.rushSeconds,
    setupFrame,
    setupZones: [],
    setupPlaces: [],
    setupAlive: [],
    stack: '',
    stackSize: 0,
    push: null,
    saved: 0,
    fights: contacts(r, i),
  }
  const inSite = { A: 0, B: 0 }
  players.forEach((p) => {
    const base = p * F
    const alive = (r.pflags[base + setupFrame] & FLAG.alive) !== 0
    const f = alive ? setupFrame : lastAlive(r, base, setupFrame, a)
    const zone: Zone = f >= 0 ? zoneAt(zones, r, base + f) : 'other'
    read.setupZones.push(zone)
    read.setupPlaces.push(f >= 0 && r.pplace.length ? r.placeName(r.pplace[base + f]) : '')
    read.setupAlive.push(alive)
    if (alive && (zone === 'A' || zone === 'B')) inSite[zone]++
  })
  if (ct) {
    const need = stackNeed(players.length)
    for (const s of ['A', 'B'] as const) {
      if (inSite[s] >= need && inSite[s] > read.stackSize) {
        read.stack = s
        read.stackSize = inSite[s]
      }
    }
    read.push = findPush(ctx, read)
  }
  if (!ctx.won) read.saved = countSaves(ctx, plant ? plant.pos : null, rd.endTick)
  return read
}

// findPush looks for a CT in T territory at the setup moment, or taking
// the first fight of the round there within PUSH_SECONDS.
function findPush(ctx: RoundCtx, read: RoundRead): { k: number; place: string } | null {
  const { r, players, zones } = ctx
  const F = r.frames
  const place = (j: number) => (r.pplace.length ? r.placeName(r.pplace[j]) : '')
  for (let k = 0; k < players.length; k++) {
    if (!read.setupAlive[k]) continue
    const j = players[k] * F + read.setupFrame
    if (tTerritory(zones, read.setupZones[k], r.px[j], r.py[j])) return { k, place: place(j) }
  }
  const first = read.fights[0]
  if (!first || first.tick - ctx.live > PUSH_SECONDS * r.rate) return null
  for (const p of [first.p, first.q]) {
    const k = players.indexOf(p)
    if (k < 0) continue
    const f = lastAlive(r, p * F, r.frameIndex(first.tick), ctx.a)
    if (f < 0) continue
    const j = p * F + f
    if (tTerritory(zones, zoneAt(zones, r, j), r.px[j], r.py[j])) return { k, place: place(j) }
  }
  return null
}

// countSaves counts roster players alive at the end of a lost round, away
// from the bomb and from every enemy still alive.
function countSaves(ctx: RoundCtx, bomb: ArrayLike<number> | null, endTick: number): number {
  const { r, players, team } = ctx
  const F = r.frames
  const f = r.frameIndex(endTick)
  let saved = 0
  for (const p of players) {
    const j = p * F + f
    if (!(r.pflags[j] & FLAG.alive)) continue
    const x = r.px[j]
    const y = r.py[j]
    if (bomb && Math.hypot(x - bomb[0], y - bomb[1]) < SAVE_BOMB) continue
    let near = false
    for (const q of r.teamPlayers[1 - team] ?? []) {
      const e = q * F + f
      if (!(r.pflags[e] & FLAG.alive)) continue
      if (Math.hypot(x - r.px[e], y - r.py[e]) < SAVE_ENEMY) {
        near = true
        break
      }
    }
    if (!near) saved++
  }
  return saved
}

// ---- Tracks ----

export interface TrackOptions {
  trackSeconds: number
  trackStep: number
}

const NADE_KIND: Record<number, TrackEvent['kind']> = {
  [EQ.smoke]: 'smoke',
  [EQ.flash]: 'flash',
  [EQ.he]: 'he',
  [EQ.molotov]: 'fire',
  [EQ.incendiary]: 'fire',
  [EQ.decoy]: 'decoy',
}

// throwSpot is where a grenade left the thrower's hand: the start of its
// recorded path, or where the thrower stood.
export function throwSpot(r: Replay, g: Grenade): [number, number, number] | undefined {
  if (g.pathLen > 0 && g.pathStart >= 0 && g.pathStart < r.nade.x.length) {
    const k = g.pathStart
    return [r.nade.x[k], r.nade.y[k], r.nade.z[k]]
  }
  if (g.thrower < 0 || g.thrower >= r.players || !r.frames) return undefined
  const j = g.thrower * r.frames + r.frameIndex(g.throwTick)
  return [r.px[j], r.py[j], r.pz[j]]
}

// buildTrack samples the roster from the moment the round went live until
// it was decided, at most trackSeconds, every trackStep seconds. The label
// is filled in when the scout is finished.
export function buildTrack(ctx: RoundCtx, read: RoundRead, replayId: string, opts: TrackOptions): SituationTrack {
  const { r, i, live, players, bin } = ctx
  const F = r.frames
  const rate = r.rate
  const step = Math.max(0.01, opts.trackStep)
  const end = r.match.rounds[i].endTick
  const length = Math.max(0, Math.min(opts.trackSeconds, (end - live) / rate))
  const n = Math.max(1, Math.floor(length / step + 1e-6) + 1)
  // The frame and the share of the way to the next frame for each sample,
  // the same for every player.
  const frame = new Int32Array(n)
  const part = new Float32Array(n)
  for (let s = 0; s < n; s++) {
    const tick = Math.min(end, live + s * step * rate)
    const f = r.frameIndex(tick)
    frame[s] = f
    const t0 = r.tick[f]
    const t1 = f + 1 < F ? r.tick[f + 1] : t0
    part[s] = t1 > t0 ? Math.min(1, Math.max(0, (tick - t0) / (t1 - t0))) : 0
  }
  const tp: TrackPlayer[] = players.map((p, k) => {
    const xs = new Float32Array(n)
    const ys = new Float32Array(n)
    const zs = new Float32Array(n)
    const yaws = new Float32Array(n)
    const alive = new Uint8Array(n)
    const base = p * F
    const hasYaw = r.pyaw.length > 0
    let dead = false
    let lx = 0
    let ly = 0
    let lz = 0
    let lyaw = 0
    // Start from where they stood when the round went live.
    const f0 = lastAlive(r, base, ctx.a, Math.max(0, ctx.a - 64))
    if (f0 >= 0) {
      lx = bin.rx(r.px[base + f0])
      ly = bin.ry(r.py[base + f0])
      lz = r.pz[base + f0]
      if (hasYaw) lyaw = (r.pyaw[base + f0] / 65535) * 360
    }
    for (let s = 0; s < n; s++) {
      if (!dead) {
        const j = base + frame[s]
        if (r.pflags[j] & FLAG.alive) {
          let x = r.px[j]
          let y = r.py[j]
          let z = r.pz[j]
          let yaw = hasYaw ? (r.pyaw[j] / 65535) * 360 : 0
          const t = part[s]
          if (t > 0 && r.pflags[j + 1] & FLAG.alive) {
            const dx = r.px[j + 1] - x
            const dy = r.py[j + 1] - y
            if (dx * dx + dy * dy < TELEPORT * TELEPORT) {
              x += dx * t
              y += dy * t
              z += (r.pz[j + 1] - z) * t
              if (hasYaw) yaw = lerpAngle(yaw, (r.pyaw[j + 1] / 65535) * 360, t)
            }
          }
          lx = bin.rx(x)
          ly = bin.ry(y)
          lz = z
          lyaw = yaw
        } else dead = true
      }
      xs[s] = lx
      ys[s] = ly
      zs[s] = lz
      yaws[s] = lyaw
      alive[s] = dead ? 0 : 1
    }
    return { steamId: ctx.ids[k], name: ctx.names[k], color: ctx.colors[k], xs, ys, zs, yaw: yaws, alive }
  })
  const until = Math.min(end, live + opts.trackSeconds * rate)
  const sec = (tick: number) => Math.max(0, (tick - live) / rate)
  const name = new Map<number, string>()
  players.forEach((p, k) => name.set(p, ctx.names[k]))
  const events: TrackEvent[] = []
  for (const g of r.roundGrenades[i] ?? []) {
    const who = name.get(g.thrower)
    const kind = NADE_KIND[g.type]
    if (!who || !kind || g.effectTick < live || g.effectTick > until) continue
    const [x, y] = bin.radar(g.pos[0], g.pos[1])
    const ev: TrackEvent = { t: sec(g.effectTick), kind, x, y, z: g.pos[2], player: who }
    if ((kind === 'smoke' || kind === 'fire') && g.endTick > g.effectTick) ev.until = sec(g.endTick)
    const from = throwSpot(r, g)
    if (from) ev.from = bin.radar(from[0], from[1])
    events.push(ev)
  }
  for (const k of r.roundKills[i] ?? []) {
    if (k.tick < live || k.tick > until) continue
    const [x, y] = bin.radar(k.victimPos[0], k.victimPos[1])
    const from = k.killer >= 0 ? bin.radar(k.killerPos[0], k.killerPos[1]) : undefined
    const killer = name.get(k.killer)
    const victim = name.get(k.victim)
    if (killer && k.killer !== k.victim && k.killerSide !== k.victimSide) {
      events.push({ t: sec(k.tick), kind: 'kill', x, y, z: k.victimPos[2], player: killer, from })
    }
    if (victim) events.push({ t: sec(k.tick), kind: 'death', x, y, z: k.victimPos[2], player: victim, from })
  }
  for (const e of r.roundBomb[i] ?? []) {
    if (e.kind !== 'planted' || e.tick < live || e.tick > until) continue
    const [x, y] = bin.radar(e.pos[0], e.pos[1])
    events.push({ t: sec(e.tick), kind: 'plant', x, y, z: e.pos[2], player: name.get(e.player) ?? r.playerName(e.player) })
  }
  events.sort((a, b) => a.t - b.t)
  return {
    replayId,
    round: r.match.rounds[i].number || i + 1,
    label: '',
    won: ctx.won,
    hit: read.hit,
    hitTime: read.hitTime,
    end: length,
    tick: Math.round(live),
    rate,
    players: tp,
    events,
  }
}

// trackLabel names a round for the list, like "Match 2, round 13". match
// is 1 based, 0 when the scout has a single match.
export function trackLabel(match: number, round: number): string {
  return match ? `Match ${match}, round ${round}` : `Round ${round}`
}

// ---- Situations ----

// Note is a sentence with a score for picking the best ones. Notes in
// the same group say similar things, like the notes of one player.
export interface Note {
  text: string
  score: number
  group?: string
}

// noteScore weighs how strong a pattern is by how many rounds are behind
// it.
export function noteScore(k: number, n: number, weight = 1): number {
  if (!n) return 0
  return (k / n) * Math.min(1, n / 6) * weight
}

export function secs(s: number): string {
  return `${Math.round(s)} s`
}

// pattern is true when k of n is worth a note: at least 2 rounds and 40%
// of them, or for pistols (few per match) more than half of them.
export function pattern(k: number, n: number, pistol: boolean): boolean {
  if (k >= 2 && k / n >= 0.4) return true
  return pistol && k >= 1 && k / n > 0.5
}

interface Count {
  rounds: number
  time: number
}

export class SituationAcc {
  rounds = 0
  won = 0
  rushes = 0
  noHit = 0
  pushes = 0
  saves = 0
  hits = new Map<string, Count>()
  rushSites = new Map<string, Count>()
  stacks = new Map<string, { rounds: number; min: number; max: number }>()
  pushPlaces = new Map<string, number>()
  pushers = new Map<string, number>()
  splits = new Map<string, number>()
  spots = new Map<string, number>()
  tracks: SituationTrack[] = []
  heat10: HeatGrid
  heat20: HeatGrid

  constructor(
    readonly side: 'ct' | 't',
    readonly buy: BuyKind,
    grid: () => HeatGrid,
    readonly setupSeconds = 15,
  ) {
    this.heat10 = grid()
    this.heat20 = grid()
  }

  get key(): string {
    return `${this.side}-${this.buy}`
  }

  add(ctx: RoundCtx, read: RoundRead, track: SituationTrack) {
    this.rounds++
    if (read.won) this.won++
    this.tracks.push(track)
    if (read.side === 't') {
      if (read.hit) {
        bump(this.hits, read.hit, read.hitTime)
        if (read.rush) {
          this.rushes++
          bump(this.rushSites, read.hit, read.hitTime)
        }
      } else this.noHit++
    } else {
      if (read.stack) {
        const s = this.stacks.get(read.stack) ?? { rounds: 0, min: Infinity, max: 0 }
        s.rounds++
        s.min = Math.min(s.min, read.stackSize)
        s.max = Math.max(s.max, read.stackSize)
        this.stacks.set(read.stack, s)
      }
      if (read.push) {
        this.pushes++
        inc(this.pushPlaces, read.push.place || '?')
        inc(this.pushers, ctx.names[read.push.k])
      }
      const split = splitText(read.setupZones)
      if (split) inc(this.splits, split)
    }
    if (read.saved >= Math.min(2, ctx.players.length)) this.saves++
    const seen = new Set<string>()
    read.setupPlaces.forEach((p, k) => {
      if (p && read.setupAlive[k] && !seen.has(p)) {
        seen.add(p)
        inc(this.spots, p)
      }
    })
    this.addHeat(ctx)
  }

  private addHeat(ctx: RoundCtx) {
    const { r, players, bin, a, b, live } = ctx
    const F = r.frames
    const f10 = Math.min(b, r.frameIndex(live + 10 * r.rate))
    const f20 = Math.min(b, r.frameIndex(live + 20 * r.rate))
    const want = ctx.side
    for (const p of players) {
      const base = p * F
      for (let f = a; f <= f20; f += 2) {
        const j = base + f
        if (!(r.pflags[j] & FLAG.alive) || r.pside[j] !== want) continue
        const c = bin.cell(r.px[j], r.py[j], r.pz[j])
        if (c < 0) continue
        bin.put(this.heat20, c)
        if (f <= f10) bin.put(this.heat10, c)
      }
    }
  }

  finish(): { situation: Situation; notes: Note[] } {
    const notes = this.notes()
    const situation: Situation = {
      key: this.key,
      side: this.side,
      buy: this.buy,
      title: situationTitle(this.side, this.buy),
      rounds: this.rounds,
      won: this.won,
      rushes: this.rushes,
      hits: [...this.hits]
        .map(([site, c]) => ({ site, rounds: c.rounds, avgTime: c.rounds ? c.time / c.rounds : 0 }))
        .sort((a, b) => b.rounds - a.rounds || a.site.localeCompare(b.site)),
      noHit: this.noHit,
      stacks: [...this.stacks]
        .map(([site, s]) => ({ site, rounds: s.rounds }))
        .sort((a, b) => b.rounds - a.rounds || a.site.localeCompare(b.site)),
      pushes: this.pushes,
      saves: this.saves,
      heat10: this.heat10,
      heat20: this.heat20,
      tracks: this.tracks,
      notes: notes.map((n) => n.text),
    }
    return { situation, notes }
  }

  // notes are the patterns of this situation, strongest first.
  notes(): Note[] {
    const out: Note[] = []
    const n = this.rounds
    if (!n) return out
    const pistol = this.buy === 'pistol'
    const on = `On ${situationTitle(this.side, this.buy)}`
    const lost = n - this.won
    if (this.side === 't') {
      const rush = top(this.rushSites)
      if (rush && pattern(this.rushes, n, pistol)) {
        const [site, c] = rush
        const time = sumTime(this.rushSites) / this.rushes
        const avg = `on site after ${secs(time)}${this.rushes > 1 ? ' on average' : ''}`
        if (c.rounds === this.rushes) {
          out.push({ text: `${on} they rushed ${site} in ${c.rounds} of ${n}, ${avg}.`, score: noteScore(c.rounds, n, 1.3), group: 'site' })
        } else {
          const parts = [...this.rushSites].sort((a, b) => b[1].rounds - a[1].rounds || a[0].localeCompare(b[0])).map(([s, x]) => `${x.rounds} ${s}`)
          out.push({ text: `${on} they rushed a site in ${this.rushes} of ${n} (${parts.join(', ')}), ${avg}.`, score: noteScore(this.rushes, n, 1.2), group: 'site' })
        }
      }
      const hit = top(this.hits)
      const hitRounds = n - this.noHit
      if (hit) {
        const [site, c] = hit
        const rushed = this.rushSites.get(site)?.rounds ?? 0
        // Skip when the rush note already says it.
        if (c.rounds > rushed && pattern(c.rounds, n, pistol) && c.rounds / Math.max(1, hitRounds) >= 0.6) {
          out.push({ text: `${on} they went ${site} in ${c.rounds} of ${n}, on site after ${secs(c.time / c.rounds)}${c.rounds > 1 ? ' on average' : ''}.`, score: noteScore(c.rounds, n, 1), group: 'site' })
        }
      }
      if (!this.rushes && hitRounds >= 3) {
        const avg = sumTime(this.hits) / hitRounds
        if (avg >= 45) out.push({ text: `${on} they played slow: no rush in ${n} rounds, first on a site after ${secs(avg)} on average.`, score: noteScore(hitRounds, n, 0.8), group: 'site' })
      }
      if (this.noHit >= 2 && this.noHit / n >= 0.4) {
        out.push({ text: `${on} they did not hit a site in ${this.noHit} of ${n}.`, score: noteScore(this.noHit, n, 0.6), group: 'site' })
      }
    } else {
      const stack = [...this.stacks].sort((a, b) => b[1].rounds - a[1].rounds)[0]
      if (stack && pattern(stack[1].rounds, n, pistol)) {
        const [site, s] = stack
        const size = s.min === s.max ? `${s.min}` : `${s.min} or more`
        out.push({ text: `${on} they stacked ${site} with ${size} players in ${s.rounds} of ${n}.`, score: noteScore(s.rounds, n, 1.2), group: 'setup' })
      }
      if (pattern(this.pushes, n, pistol)) {
        const place = top(this.pushPlaces)
        const who = top(this.pushers)
        const where = place && place[0] !== '?' && place[1] * 2 > this.pushes ? place[0] : 'into T territory'
        const by = who && who[1] * 3 >= this.pushes * 2 ? who[0] : 'a player'
        out.push({ text: `${on} ${by} pushed ${where} early in ${this.pushes} of ${n}.`, score: noteScore(this.pushes, n, 1.2), group: 'push' })
      }
      const split = top(this.splits)
      if (split && !stack && split[1] >= 2 && split[1] * 2 >= n) {
        out.push({ text: `${on} they set up ${split[0]} in ${split[1]} of ${n}.`, score: noteScore(split[1], n, 0.9), group: 'setup' })
      }
    }
    const spots = [...this.spots]
      .filter(([, c]) => c >= 2 && c * 2 >= n)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
    if (spots.length && n >= 2) {
      const list = spots.map(([p, c]) => `${p} (${c} of ${n})`)
      const text = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]
      out.push({ text: `${on} at ${secs(this.setupSeconds)} they were usually at ${text}.`, score: noteScore(spots[0][1], n, 0.6), group: 'spots' })
    }
    if (this.saves >= 2 && lost && this.saves / lost >= 0.3) {
      out.push({ text: `${on} 2 or more players saved in ${this.saves} of ${lost} lost rounds.`, score: noteScore(this.saves, lost, 0.8), group: 'save' })
    }
    // Lost anti-ecos and won ecos or forces stand out.
    if (this.buy === 'antieco' && lost >= 2 && lost * 2 >= n) {
      out.push({ text: `${on} they lost ${lost} of ${n}.`, score: noteScore(lost, n, 0.9), group: 'result' })
    } else if ((this.buy === 'eco' || this.buy === 'force') && this.won >= 2 && this.won * 5 >= n * 3) {
      out.push({ text: `${on} they won ${this.won} of ${n}.`, score: noteScore(this.won, n, 0.9), group: 'result' })
    }
    return out.sort((a, b) => b.score - a.score)
  }
}

// splitText is the CT setup by zone, like "2 A, 1 mid, 2 B". Players who
// died before the setup moment count where they died.
export function splitText(zones: Zone[]): string {
  if (zones.length < 2) return ''
  const c = { A: 0, mid: 0, B: 0, other: 0 }
  for (const z of zones) c[z]++
  const parts: string[] = []
  if (c.A) parts.push(`${c.A} A`)
  if (c.mid) parts.push(`${c.mid} mid`)
  if (c.B) parts.push(`${c.B} B`)
  if (c.other) parts.push(`${c.other} elsewhere`)
  return parts.join(', ')
}

function bump(m: Map<string, Count>, key: string, time: number) {
  const c = m.get(key) ?? { rounds: 0, time: 0 }
  c.rounds++
  c.time += time
  m.set(key, c)
}

function inc(m: Map<string, number>, key: string) {
  m.set(key, (m.get(key) ?? 0) + 1)
}

function sumTime(m: Map<string, Count>): number {
  let t = 0
  for (const c of m.values()) t += c.time
  return t
}

function top<T extends number | Count>(m: Map<string, T>): [string, T] | undefined {
  let best: [string, T] | undefined
  const val = (v: T) => (typeof v === 'number' ? v : v.rounds)
  for (const e of m) {
    if (!best || val(e[1]) > val(best[1]) || (val(e[1]) === val(best[1]) && e[0] < best[0])) best = e
  }
  return best
}

// Most notes one group may add to the tendencies, so they stay a mix:
// per player, all players together and the usual spots.
const PER_PLAYER = 2
const ALL_PLAYERS = 6
const SPOTS = 2

// pickTendencies keeps the best notes, at most limit, without repeats.
export function pickTendencies(notes: Note[], limit = 12): string[] {
  const seen = new Set<string>()
  const groups = new Map<string, number>()
  let players = 0
  const out: string[] = []
  for (const n of [...notes].sort((a, b) => b.score - a.score)) {
    if (out.length >= limit) break
    if (n.score <= 0 || seen.has(n.text)) continue
    const g = n.group ?? ''
    const used = groups.get(g) ?? 0
    const player = g.startsWith('player:')
    if (player && (used >= PER_PLAYER || players >= ALL_PLAYERS)) continue
    if (g === 'spots' && used >= SPOTS) continue
    seen.add(n.text)
    groups.set(g, used + 1)
    if (player) players++
    out.push(n.text)
  }
  return out
}
