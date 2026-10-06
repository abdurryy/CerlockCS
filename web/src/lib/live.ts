import { clock } from './format'
import type { Replay } from './replay'

export interface RoundClock {
  phase: 'freeze' | 'live' | 'planted' | 'over'
  text: string
  seconds: number
}

// roundClock returns what the in game timer would show.
export function roundClock(r: Replay, tick: number): RoundClock {
  const i = r.roundIndex(tick)
  const rd = r.round(i)
  if (tick >= rd.endTick) return { phase: 'over', text: '0:00', seconds: 0 }
  if (tick < rd.freezeEndTick) {
    const s = (rd.freezeEndTick - tick) / r.rate
    return { phase: 'freeze', text: clock(s), seconds: s }
  }
  const plant = r.roundBomb[i].find((e) => e.kind === 'planted' && e.tick <= tick)
  if (plant) {
    const s = rd.bombTime - (tick - plant.tick) / r.rate
    return { phase: 'planted', text: clock(s), seconds: s }
  }
  const s = rd.roundTime - (tick - rd.freezeEndTick) / r.rate
  return { phase: 'live', text: clock(s), seconds: s }
}

export interface LiveStats {
  kills: number
  deaths: number
  assists: number
  damage: number
}

// statsAt counts kills, deaths, assists and damage up to a tick.
export function statsAt(r: Replay, tick: number): LiveStats[] {
  const out = Array.from({ length: r.players }, () => ({ kills: 0, deaths: 0, assists: 0, damage: 0 }))
  const team = (p: number) => r.match.players[p]?.team ?? -1
  for (const k of r.kills) {
    if (k.tick > tick) break
    out[k.victim].deaths++
    if (k.killer >= 0 && team(k.killer) !== team(k.victim)) out[k.killer].kills++
    if (k.assister >= 0 && team(k.assister) !== team(k.victim)) out[k.assister].assists++
  }
  for (const d of r.match.damages ?? []) {
    if (d.tick > tick) break
    if (d.attacker >= 0 && team(d.attacker) !== team(d.victim)) out[d.attacker].damage += d.health
  }
  return out
}

// scoreAt returns the score of both teams before the round at tick ended.
export function scoreAt(r: Replay, tick: number): [number, number] {
  const i = r.roundIndex(tick)
  const rd = r.round(i)
  if (tick >= rd.endTick) return [rd.scoreA, rd.scoreB]
  if (i === 0) return [0, 0]
  const prev = r.round(i - 1)
  return [prev.scoreA, prev.scoreB]
}
