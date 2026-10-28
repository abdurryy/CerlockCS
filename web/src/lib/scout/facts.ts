// Facts: what each round says for the game plan, from the scouted team's
// side. They are kept on the round's track, so the plan can point to the
// rounds behind every line.

import { FLAG, prettyPlace } from '../replay'
import type { Kill } from '../types'
import { lurkers } from './roles'
import { zoneAt, type RoundCtx, type RoundRead } from './situations'
import type { TrackFacts, Zone } from './types'

const SIDE_T = 2
const SIDE_CT = 3
const AWP = 309

// Seconds after the T side got to a site in which a CT coming over from
// elsewhere counts as a rotation.
export const ROTATE_SECONDS = 20
// Seconds before the hit that show where the T side came from.
const ENTRY_BEFORE = 4

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

export function trackFacts(ctx: RoundCtx, read: RoundRead): TrackFacts {
  const { r, players, names } = ctx
  const setup: Record<Zone, number> = { A: 0, B: 0, mid: 0, other: 0 }
  for (const z of read.setupZones) setup[z]++
  const out: TrackFacts = { setup, plant: read.plantSite }
  if (read.push) out.push = { player: names[read.push.k], place: read.push.place }
  const first = openingKill(r.roundKills[ctx.i] ?? [])
  if (first) {
    const killer = players.indexOf(first.killer)
    const victim = players.indexOf(first.victim)
    const k = killer >= 0 ? killer : victim
    if (k >= 0) {
      const won = killer >= 0
      out.opening = {
        player: names[k],
        place: prettyPlace((won ? first.killerPlace : first.victimPlace) ?? ''),
        won,
        time: Math.max(0, (first.tick - ctx.live) / r.rate),
        other: prettyPlace((won ? first.victimPlace : first.killerPlace) ?? ''),
      }
    }
  }
  const awp = awpAt(ctx, read)
  if (awp) out.awp = awp
  if (read.hit === 'A' || read.hit === 'B') {
    if (read.side === 'ct') out.rotate = rotation(ctx, read)
    else {
      const lurk = lurkers(ctx, read).indexOf(true)
      if (lurk >= 0) {
        const j = players[lurk] * r.frames + r.frameIndex(read.hitTick)
        out.lurk = { player: names[lurk], place: r.pplace.length ? r.placeName(r.pplace[j]) : '' }
      }
      const entry = entryPlace(ctx, read)
      if (entry) out.entry = entry
    }
  }
  return out
}

// awpAt is the player with the AWP at the setup moment and where.
function awpAt(ctx: RoundCtx, read: RoundRead): TrackFacts['awp'] | null {
  const { r, players, names } = ctx
  if (!r.pprimary.length && !r.pweapon.length) return null
  for (let k = 0; k < players.length; k++) {
    if (!read.setupAlive[k]) continue
    const j = players[k] * r.frames + read.setupFrame
    const gun = r.pprimary.length ? r.pprimary[j] : r.pweapon[j]
    if (gun === AWP) return { player: names[k], place: read.setupPlaces[k] }
  }
  return null
}

// rotation counts the CTs who got to the hit site from elsewhere within
// ROTATE_SECONDS of the hit, and when the first of them got there.
function rotation(ctx: RoundCtx, read: RoundRead): { players: number; first: number } {
  const { r, players, zones, b } = ctx
  const F = r.frames
  const site = read.hit as Zone
  const from = r.frameIndex(read.hitTick)
  const to = Math.min(b, r.frameIndex(read.hitTick + ROTATE_SECONDS * r.rate))
  let count = 0
  let first = -1
  for (const p of players) {
    const base = p * F
    if (!(r.pflags[base + from] & FLAG.alive) || zoneAt(zones, r, base + from) === site) continue
    for (let f = from + 1; f <= to; f++) {
      const j = base + f
      if (!(r.pflags[j] & FLAG.alive)) break
      if (zoneAt(zones, r, j) !== site) continue
      count++
      const t = (r.tick[f] - read.hitTick) / r.rate
      if (first < 0 || t < first) first = t
      break
    }
  }
  return { players: count, first: first < 0 ? -1 : Math.max(0, first) }
}

// entryPlace is where most of the T side stood a few seconds before the
// hit, the way they came in.
function entryPlace(ctx: RoundCtx, read: RoundRead): string {
  const { r, players } = ctx
  if (!r.pplace.length) return ''
  const f = Math.max(ctx.a, r.frameIndex(read.hitTick - ENTRY_BEFORE * r.rate))
  const count = new Map<string, number>()
  for (const p of players) {
    const j = p * r.frames + f
    if (!(r.pflags[j] & FLAG.alive)) continue
    const z = zoneAt(ctx.zones, r, j)
    if (z === read.hit) continue
    const name = r.placeName(r.pplace[j])
    if (name) count.set(name, (count.get(name) ?? 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [name, c] of count) {
    if (c > n || (c === n && name < best)) {
      best = name
      n = c
    }
  }
  return best
}
