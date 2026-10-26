// Roles: what each roster player does per side, read round by round. CT
// players by the zone they hold at the setup moment, T players by who
// enters the site, who lurks and who throws the utility.

import { FLAG, type Replay } from '../replay'
import { EQ } from '../weapons'
import { AFTER_HIT, noteScore, siteSpot, spotDist, zoneAt, type Note, type RoundCtx, type RoundRead } from './situations'
import type { RoleCard, Zone } from './types'

const AWP = 309
// A player who had the AWP within this many seconds of the round going
// live had it for the round.
const AWP_SECONDS = 20
// The first player onto the site counts until this long after the hit.
const ENTRY_AFTER = 10
// A T on the site place, or this close to the site without places.
const ON_SITE = 350
// Lurkers at the hit are this far from the hit site and from every
// teammate.
const LURK_SITE = 1800
const LURK_TEAM = 1400

// Label thresholds.
const AWP_SHARE = 0.5
const ANCHOR_SHARE = 0.6
const ROTATE_SHARE = 0.3
const MID_SHARE = 0.4
const PLACE_SHARE = 0.5
const ENTRY_SHARE = 0.35
const LURK_SHARE = 0.3
// Fewer rounds than this get a label but no notes.
const NOTE_ROUNDS = 3

interface CtAcc {
  rounds: number
  zones: Map<Zone, number>
  places: Map<string, number>
  awpPlaces: Map<string, number>
  rotates: number
  awp: number
}

interface TAcc {
  rounds: number
  // Rounds with a site hit, the base for entry and lurk.
  hitRounds: number
  entry: number
  lurk: number
  // Utility before hits: theirs, the team's and the team size behind it.
  nades: number
  teamNades: number
  teamSize: number
  awp: number
}

export class RoleAcc {
  ct: CtAcc = { rounds: 0, zones: new Map(), places: new Map(), awpPlaces: new Map(), rotates: 0, awp: 0 }
  t: TAcc = { rounds: 0, hitRounds: 0, entry: 0, lurk: 0, nades: 0, teamNades: 0, teamSize: 0, awp: 0 }

  constructor(
    readonly steamId: string,
    readonly name: string,
    readonly color: string,
    readonly order: number,
  ) {}
}

export interface RoleOptions {
  utilitySeconds: number
}

// hadAwp is true when player p held the AWP as their main gun between
// frames a and b.
export function hadAwp(r: Replay, p: number, a: number, b: number): boolean {
  const F = r.frames
  const prim = r.pprimary.length ? r.pprimary : r.pweapon
  for (let f = a; f <= b; f += 4) {
    const j = p * F + f
    if (r.pflags[j] & FLAG.alive && (prim[j] === AWP || r.pweapon[j] === AWP)) return true
  }
  return false
}

// addRoles adds one round to the role of every roster player in it. accs
// lines up with ctx.players.
export function addRoles(accs: RoleAcc[], ctx: RoundCtx, read: RoundRead, opts: RoleOptions) {
  const { r, a, b, live, players } = ctx
  const awpEnd = Math.min(b, r.frameIndex(live + AWP_SECONDS * r.rate))
  if (read.side === 'ct') {
    players.forEach((p, k) => {
      const ct = accs[k].ct
      ct.rounds++
      inc(ct.zones, read.setupZones[k])
      if (read.setupPlaces[k]) inc(ct.places, read.setupPlaces[k])
      if (hadAwp(r, p, a, awpEnd)) {
        ct.awp++
        if (read.setupPlaces[k]) inc(ct.awpPlaces, read.setupPlaces[k])
      }
      if (rotated(ctx, read, k)) ct.rotates++
    })
    return
  }
  const entry = read.hit ? entryPlayer(ctx, read) : -1
  const lurks = read.hit ? lurkers(ctx, read) : []
  const nades = read.hit ? hitUtility(ctx, read, opts) : []
  let total = 0
  for (const n of nades) total += n
  players.forEach((p, k) => {
    const t = accs[k].t
    t.rounds++
    if (hadAwp(r, p, a, awpEnd)) t.awp++
    if (!read.hit) return
    t.hitRounds++
    if (entry === k) t.entry++
    if (lurks[k]) t.lurk++
    t.nades += nades[k] ?? 0
    t.teamNades += total
    t.teamSize += players.length
  })
}

// rotated is true when a CT went from one site zone at the setup moment
// to the other one by their first fight or the plant, whichever came
// first.
export function rotated(ctx: RoundCtx, read: RoundRead, k: number): boolean {
  const from = read.setupZones[k]
  if ((from !== 'A' && from !== 'B') || !read.setupAlive[k]) return false
  const { r, players } = ctx
  const p = players[k]
  const setupTick = r.tick[read.setupFrame]
  let check = read.plantTick > setupTick ? read.plantTick : Infinity
  for (const c of read.fights) {
    if (c.tick <= setupTick) continue
    if (c.tick >= check) break
    if (c.p === p || c.q === p) {
      check = c.tick
      break
    }
  }
  if (!isFinite(check)) return false
  const f = r.frameIndex(check)
  const j = p * r.frames + f
  if (!(r.pflags[j] & FLAG.alive)) return false
  const to = zoneAt(ctx.zones, r, j)
  return (to === 'A' || to === 'B') && to !== from
}

// entryPlayer is the roster T (index into players) first onto the hit
// site, or the one in the first fight of the round when none of them got
// there. -1 when neither.
export function entryPlayer(ctx: RoundCtx, read: RoundRead): number {
  const { r, a, b, players, zones } = ctx
  const F = r.frames
  const idx = r.pplace.length ? r.places.indexOf(`Bombsite${read.hit}`) : -1
  const spot = siteSpot(zones, read.hit)
  const end = Math.min(b, r.frameIndex(read.hitTick + ENTRY_AFTER * r.rate))
  if (idx > 0 || spot) {
    for (let f = a; f <= end; f++) {
      for (let k = 0; k < players.length; k++) {
        const j = players[k] * F + f
        if (!(r.pflags[j] & FLAG.alive)) continue
        if (idx > 0 ? r.pplace[j] === idx : spotDist(r.px[j], r.py[j], r.pz[j], spot!.x, spot!.y, spot!.z) < ON_SITE) return k
      }
    }
  }
  for (const c of read.fights) {
    const k = players.indexOf(c.p)
    const m = k >= 0 ? k : players.indexOf(c.q)
    if (m >= 0) return m
  }
  return -1
}

// lurkers marks the roster Ts who, at the hit, were alone in the other
// site's zone, or far from both the hit site and every teammate.
export function lurkers(ctx: RoundCtx, read: RoundRead): boolean[] {
  const { r, players, zones } = ctx
  const F = r.frames
  const f = r.frameIndex(read.hitTick)
  const spot = siteSpot(zones, read.hit)
  const other: Zone = read.hit === 'A' ? 'B' : 'A'
  const alive: boolean[] = players.map((p) => (r.pflags[p * F + f] & FLAG.alive) !== 0)
  const zone: Zone[] = players.map((p) => zoneAt(zones, r, p * F + f))
  return players.map((p, k) => {
    if (!alive[k]) return false
    const j = p * F + f
    if (zone[k] === other && !zone.some((z, m) => m !== k && alive[m] && z === other)) return true
    if (!spot || spotDist(r.px[j], r.py[j], r.pz[j], spot.x, spot.y, spot.z) < LURK_SITE) return false
    for (let m = 0; m < players.length; m++) {
      if (m === k || !alive[m]) continue
      const i = players[m] * F + f
      if (Math.hypot(r.px[j] - r.px[i], r.py[j] - r.py[i]) < LURK_TEAM) return false
    }
    return players.length > 1
  })
}

// hitUtility counts the grenades each roster T threw for the hit: the
// ones that went off from utilitySeconds before it to just after it.
export function hitUtility(ctx: RoundCtx, read: RoundRead, opts: RoleOptions): number[] {
  const { r, i, players } = ctx
  const out = players.map(() => 0)
  const t0 = read.hitTick - opts.utilitySeconds * r.rate
  const t1 = read.hitTick + AFTER_HIT * r.rate
  for (const g of r.roundGrenades[i] ?? []) {
    if (g.type === EQ.decoy || g.type < EQ.molotov || g.type > EQ.he) continue
    if (g.effectTick < t0 || g.effectTick > t1) continue
    const k = players.indexOf(g.thrower)
    if (k >= 0) out[k]++
  }
  return out
}

// confidenceOf goes by the rounds behind a card: the weaker side when the
// player played both.
export function confidenceOf(ct: number, t: number): RoleCard['confidence'] {
  const n = ct && t ? Math.min(ct, t) : Math.max(ct, t)
  return n < 6 ? 'low' : n < 12 ? 'medium' : 'high'
}

export function finishRoles(accs: RoleAcc[]): { cards: RoleCard[]; notes: Note[] } {
  const cards: RoleCard[] = []
  const all: Note[] = []
  const sorted = [...accs]
    .filter((a) => a.ct.rounds + a.t.rounds > 0)
    .sort((a, b) => (a.order < 0 ? 1e9 : a.order) - (b.order < 0 ? 1e9 : b.order) || a.name.localeCompare(b.name))
  for (const acc of sorted) {
    const ct = ctRole(acc)
    const t = tRole(acc)
    const notes = [...ct.notes, ...t.notes]
    all.push(...notes)
    cards.push({
      steamId: acc.steamId,
      name: acc.name,
      color: acc.color,
      ct: ct.card,
      t: t.card,
      confidence: confidenceOf(acc.ct.rounds, acc.t.rounds),
      notes: notes.map((n) => n.text),
    })
  }
  all.push(...teamNotes(cards))
  return { cards, notes: all }
}

function ctRole(acc: RoleAcc): { card: RoleCard['ct']; notes: Note[] } {
  const c = acc.ct
  const n = c.rounds
  const zone = top(c.zones) ?? ['other', 0]
  const place = top(c.places) ?? ['', 0]
  const card: RoleCard['ct'] = {
    rounds: n,
    zone: zone[0] as Zone,
    zoneShare: n ? zone[1] / n : 0,
    place: place[0],
    placeShare: n ? place[1] / n : 0,
    rotates: c.rotates,
    awp: n ? c.awp / n : 0,
    label: '',
  }
  const notes: Note[] = []
  if (!n) return { card, notes }
  const name = acc.name
  const group = `player:${acc.steamId}`
  const say = n >= NOTE_ROUNDS
  const spot = place[1] >= 2 && card.placeShare >= PLACE_SHARE && place[0] ? `, usually at ${place[0]} (${place[1]} of ${n})` : ''
  const anchor = (zone[0] === 'A' || zone[0] === 'B') && card.zoneShare >= ANCHOR_SHARE
  const mid = zone[0] === 'mid' && card.zoneShare >= MID_SHARE
  if (card.awp > AWP_SHARE) card.label = 'AWP'
  else if (anchor) card.label = `${zone[0]} anchor`
  else if (c.rotates >= 2 && c.rotates / n >= ROTATE_SHARE) card.label = 'Rotator'
  else if (mid) card.label = 'Mid'
  else if (zone[0] === 'other' && place[0] && card.placeShare >= PLACE_SHARE) card.label = place[0]
  else card.label = 'Flex'
  if (!say) return { card, notes }
  if (card.label === 'AWP') {
    // Where the AWP played, by zone when it was a site, else by spot.
    const ap = top(c.awpPlaces)
    let where = ''
    if (anchor) where = ` and held ${zone[0]} in ${zone[1]} of ${n}${spot}`
    else if (ap && ap[1] >= 2 && ap[1] * 2 >= c.awp) where = `, mostly at ${ap[0]} (${ap[1]} of ${c.awp})`
    notes.push({ text: `${name} had the AWP in ${c.awp} of ${n} CT rounds${where}.`, score: noteScore(c.awp, n, 0.9), group })
  } else if (anchor) {
    notes.push({ text: `${name} played ${zone[0]} anchor in ${zone[1]} of ${n} CT rounds${spot}.`, score: noteScore(zone[1], n, 1), group })
  } else if (mid) {
    notes.push({ text: `${name} played mid in ${zone[1]} of ${n} CT rounds${spot}.`, score: noteScore(zone[1], n, 0.9), group })
  } else if (card.label === place[0] && place[0]) {
    notes.push({ text: `${name} played ${place[0]} in ${place[1]} of ${n} CT rounds.`, score: noteScore(place[1], n, 0.9), group })
  } else if (card.label === 'Flex' && n >= 6) {
    notes.push({ text: `${name} moved around on CT: no zone in more than ${zone[1]} of ${n} rounds.`, score: noteScore(n - zone[1], n, 0.5), group })
  }
  if (c.rotates >= 2 && c.rotates / n >= ROTATE_SHARE) {
    notes.push({ text: `${name} rotated to the other site in ${c.rotates} of ${n} CT rounds.`, score: noteScore(c.rotates, n, card.label === 'Rotator' ? 0.9 : 0.6), group })
  }
  return { card, notes }
}

function tRole(acc: RoleAcc): { card: RoleCard['t']; notes: Note[] } {
  const t = acc.t
  const n = t.rounds
  const h = t.hitRounds
  const card: RoleCard['t'] = {
    rounds: n,
    entry: h ? t.entry / h : 0,
    lurk: h ? t.lurk / h : 0,
    support: t.teamNades ? t.nades / t.teamNades : 0,
    awp: n ? t.awp / n : 0,
    label: '',
  }
  const notes: Note[] = []
  if (!n) return { card, notes }
  const name = acc.name
  const group = `player:${acc.steamId}`
  // Even share of the utility for the team size, half again counts as
  // the support player.
  const size = h ? t.teamSize / h : 5
  const supportShare = Math.max(0.3, 1.5 / Math.max(1, size))
  const scores: [string, number][] = []
  if (t.entry >= 2) scores.push(['Entry', card.entry / ENTRY_SHARE])
  if (t.lurk >= 2) scores.push(['Lurker', card.lurk / LURK_SHARE])
  if (t.teamNades >= 5 && size > 1) scores.push(['Support', card.support / supportShare])
  scores.sort((a, b) => b[1] - a[1])
  if (card.awp > AWP_SHARE) card.label = 'AWP'
  else card.label = scores[0] && scores[0][1] >= 1 ? scores[0][0] : 'Flex'
  if (n < NOTE_ROUNDS) return { card, notes }
  if (card.awp > AWP_SHARE) notes.push({ text: `${name} had the AWP in ${t.awp} of ${n} T rounds.`, score: noteScore(t.awp, n, 0.9), group })
  for (const [label, s] of scores) {
    if (s < 1) continue
    const w = label === card.label ? 0.9 : 0.5
    if (label === 'Entry') notes.push({ text: `${name} was first onto the site in ${t.entry} of ${h} T rounds with a hit.`, score: noteScore(t.entry, h, w), group })
    if (label === 'Lurker') notes.push({ text: `${name} lurked away from the team in ${t.lurk} of ${h} T rounds with a hit.`, score: noteScore(t.lurk, h, w), group })
    if (label === 'Support') {
      const pct = Math.round(card.support * 100)
      // Twice the even share or more is as strong as it gets.
      const strength = Math.min(1, (card.support * size) / 2)
      notes.push({ text: `${name} threw ${pct}% of the team's utility before site hits (${t.nades} of ${t.teamNades}).`, score: strength * Math.min(1, h / 6) * w * 0.8, group })
    }
  }
  return { card, notes }
}

// teamNotes says if the team plays fixed CT positions or moves around.
function teamNotes(cards: RoleCard[]): Note[] {
  const ct = cards.filter((c) => c.ct.rounds >= 5)
  if (ct.length < 3) return []
  const fixed = ct.filter((c) => c.ct.zoneShare >= ANCHOR_SHARE).length
  const least = Math.min(...ct.map((c) => c.ct.rounds))
  const w = Math.min(1, least / 6)
  if (fixed >= 3 && fixed >= ct.length - 1) {
    return [{ text: `On CT ${fixed} of ${ct.length} players held the same zone in at least 60% of their rounds, so they play fixed positions.`, score: w * 0.95, group: 'team' }]
  }
  if (fixed <= 1) {
    return [{ text: `On CT only ${fixed} of ${ct.length} players held the same zone in at least 60% of their rounds, so their positions change a lot.`, score: w * 0.85, group: 'team' }]
  }
  return []
}

function inc<K>(m: Map<K, number>, key: K) {
  m.set(key, (m.get(key) ?? 0) + 1)
}

function top<K extends string>(m: Map<K, number>): [K, number] | undefined {
  let best: [K, number] | undefined
  for (const e of m) {
    if (!best || e[1] > best[1] || (e[1] === best[1] && e[0] < best[0])) best = e
  }
  return best
}
