// The game plan: what to do against the scouted team, side by side and
// round type by round type. Every line comes from what they did in the
// demos, says how many rounds it is based on and points to those rounds.

import { scoutOptions } from './aggregate'
import { stackNeed } from './situations'
import type { BuyKind, MapScout, PlantScout, Situation, SituationTrack, TrackFacts } from './types'

export type Strength = 'strong' | 'likely' | 'weak'

export type PlanKind = 'site' | 'setup' | 'fake' | 'speed' | 'utility' | 'fight' | 'awp' | 'push' | 'lurk' | 'plant' | 'retake' | 'economy'

export interface PlanLine {
  kind: PlanKind
  // What to do, like "Hit B".
  do: string
  // Why, from the demos.
  why: string
  strength: Strength
  score: number
  // The side you play when it applies.
  side?: 'ct' | 't'
  // Their situation and the rounds behind the line, as track indices.
  situation?: string
  rounds?: number[]
}

export interface PlanPart {
  // Their situation, '' for the lines about every round.
  key: string
  buy: BuyKind | null
  title: string
  rounds: number
  lines: PlanLine[]
}

export interface PlanSide {
  // The side you play, they are on the other one.
  side: 'ct' | 't'
  title: string
  sub: string
  parts: PlanPart[]
}

export interface GamePlan {
  map: string
  // The best lines of both sides.
  key: PlanLine[]
  t: PlanSide
  ct: PlanSide
}

const PLAN_ORDER: BuyKind[] = ['pistol', 'full', 'force', 'eco', 'antieco']
const KEY_LINES = 6

// strengthOf says how sure a line is from k of n rounds.
export function strengthOf(k: number, n: number): Strength {
  const share = n ? k / n : 0
  if (n >= 5 && k >= 4 && share >= 0.6) return 'strong'
  if (n >= 3 && k >= 2 && share >= 0.5) return 'likely'
  return 'weak'
}

const WEIGHT: Record<Strength, number> = { strong: 1, likely: 0.75, weak: 0.4 }

function line(kind: PlanKind, k: number, n: number, what: string, why: string, s?: Situation, rounds?: number[], weight = 1): PlanLine {
  const strength = strengthOf(k, n)
  const score = (n ? k / n : 0) * Math.min(1, n / 6) * WEIGHT[strength] * weight
  const out: PlanLine = { kind, do: what, why, strength, score }
  if (s) {
    out.situation = s.key
    if (rounds?.length) out.rounds = [...new Set(rounds)].sort((a, b) => a - b)
  }
  return out
}

// enough is when k of n rounds is worth a line: 2 rounds and 40% of them,
// or the only pistols there are.
function enough(k: number, n: number, pistol = false): boolean {
  if (k >= 2 && k / n >= 0.4) return true
  return pistol && n <= 2 && k >= 1 && k / n > 0.5
}

export function of(k: number, n: number): string {
  return `${k} of ${n}`
}

function rounds(n: number): string {
  return `${n} ${n === 1 ? 'round' : 'rounds'}`
}

function sec(s: number): string {
  return `${Math.round(s)} s`
}

export function clock(s: number): string {
  const v = Math.max(0, Math.round(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

// an is "an A" or "a B".
function an(site: string): string {
  return `${/^[AEFHILMNORSX]$|^[aeiou]/i.test(site) ? 'an' : 'a'} ${site}`
}

function and(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] ?? '')
}

interface Tally {
  n: number
  idx: number[]
  who: Map<string, number>
}

// tally groups rounds by a key, with who was behind each.
function tally<T>(tracks: SituationTrack[], pick: (f: TrackFacts, tr: SituationTrack) => T | undefined, key: (v: T) => string, who?: (v: T) => string): [string, Tally][] {
  const m = new Map<string, Tally>()
  tracks.forEach((tr, i) => {
    if (!tr.facts) return
    const v = pick(tr.facts, tr)
    if (v === undefined) return
    const k = key(v)
    if (!k) return
    const t: Tally = m.get(k) ?? { n: 0, idx: [], who: new Map() }
    t.n++
    t.idx.push(i)
    if (who) {
      const w = who(v)
      if (w) t.who.set(w, (t.who.get(w) ?? 0) + 1)
    }
    m.set(k, t)
  })
  return [...m].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
}

function mostly(t: Tally): string {
  let best = ''
  let n = 0
  for (const [w, c] of t.who) {
    if (c > n || (c === n && w < best)) {
      best = w
      n = c
    }
  }
  return n * 2 > t.n ? best : ''
}

function playersIn(f: TrackFacts): number {
  return f.setup.A + f.setup.B + f.setup.mid + f.setup.other
}

// ---- Your T side, they are CT ----

// vsCt is what to do on your T side against one of their CT situations.
function vsCt(s: Situation): PlanLine[] {
  const out: PlanLine[] = []
  const tr = s.tracks
  const n = tr.length
  const pistol = s.buy === 'pistol'
  if (!n) return out
  const site = siteChoice(s)
  if (site) out.push(site.line)
  out.push(...rotations(s, site?.site ?? ''))
  // Early pushes.
  const push = tally(tr, (f) => f.push, (p) => p.place, (p) => p.player)[0]
  if (push && enough(push[1].n, n, pistol)) {
    const [place, t] = push
    const by = mostly(t) || 'One of them'
    out.push(line('push', t.n, n, `Hold ${place} with two for the first 20 s`, `${by} pushed ${place} early in ${of(t.n, n)}. Kill the pusher and you are a player up.`, s, t.idx, 0.9))
  }
  // The AWP.
  const awp = tally(tr, (f) => (f.awp?.place ? f.awp : undefined), (a) => a.place, (a) => a.player)[0]
  if (awp && enough(awp[1].n, n, pistol)) {
    const [place, t] = awp
    const by = mostly(t) || 'Their AWP'
    out.push(line('awp', t.n, n, `Smoke ${place} before you cross it`, `${by} held ${place} with the AWP at 15 s in ${of(t.n, n)}.`, s, t.idx, 0.85))
  }
  out.push(...openings(s, 'ct'))
  // Rounds they are bad or good at.
  const lost = n - s.won
  if (s.buy === 'antieco' && lost >= 2 && lost * 2 >= n) {
    out.push(line('economy', lost, n, 'On your ecos, group up and take close fights on one site', `They lost ${of(lost, n)} of their anti-ecos.`, s, idxWhere(tr, (t) => !t.won), 0.8))
  } else if ((s.buy === 'eco' || s.buy === 'force') && s.won >= 2 && s.won * 5 >= n * 2) {
    out.push(line('economy', s.won, n, 'Respect it: use utility, play with trades and no wide peeks', `They won ${of(s.won, n)} of these rounds.`, s, idxWhere(tr, (t) => t.won), 0.8))
  }
  return out.sort(byScore)
}

// siteChoice picks the site to hit against a CT situation: the one they
// leave thin, backed by how the rounds went for teams that hit it.
function siteChoice(s: Situation): { site: string; line: PlanLine } | null {
  const tr = s.tracks
  const pistol = s.buy === 'pistol'
  const info = (site: 'A' | 'B') => {
    const thin: number[] = []
    const heavy: number[] = []
    const hit: number[] = []
    const beat: number[] = []
    let sum = 0
    let seen = 0
    let need = 3
    tr.forEach((t, i) => {
      if (t.hit === site) {
        hit.push(i)
        if (!t.won) beat.push(i)
      }
      const f = t.facts
      if (!f) return
      seen++
      const v = f.setup[site]
      sum += v
      const all = playersIn(f)
      if (v <= (all >= 4 ? 1 : 0)) thin.push(i)
      need = stackNeed(all)
      if (v >= need) heavy.push(i)
    })
    return { site, thin, heavy, hit, beat, avg: seen ? sum / seen : 0, seen, need }
  }
  const a = info('A')
  const b = info('B')
  const rate = (x: typeof a) => (x.hit.length ? x.beat.length / x.hit.length : -1)
  // The setup says which one is thin.
  const [lo, hi] = a.avg <= b.avg ? [a, b] : [b, a]
  const setupSays = lo.seen > 0 && hi.avg - lo.avg >= 0.8 && enough(lo.thin.length, lo.seen, pistol)
  // How it went for the teams that hit each site.
  const loRate = rate(lo)
  const hiRate = rate(hi)
  const goodLo = lo.hit.length >= 2 && loRate >= 0.6
  const goodHi = hi.hit.length >= 2 && hiRate >= 0.6 && (lo.hit.length < 2 || hiRate - loRate >= 0.3)
  const badLo = lo.hit.length >= 3 && loRate <= 0.25
  const result = (x: typeof a) => (x.hit.length ? `Teams that went ${x.site} won ${of(x.beat.length, x.hit.length)}.` : '')
  if (setupSays && !badLo) {
    const heavy = hi.heavy.length ? ` ${hi.site} had ${hi.need} or more in ${of(hi.heavy.length, hi.seen)}.` : ''
    const why = `At 15 s ${lo.site} had 1 player or less in ${of(lo.thin.length, lo.seen)}.${heavy} ${result(lo)}`.trim()
    // Teams winning on that site make it more sure.
    const weight = goodLo ? 1.3 : 1.2
    return { site: lo.site, line: line('site', lo.thin.length, lo.seen, `Hit ${lo.site}`, why, s, [...lo.thin, ...lo.hit], weight) }
  }
  const pick = goodHi ? hi : goodLo ? lo : null
  if (!pick) return null
  const other = pick === lo ? hi : lo
  const why = `${result(pick)}${other.hit.length ? ` On ${other.site} they won ${of(other.beat.length, other.hit.length)}.` : ''}`
  return { site: pick.site, line: line('site', pick.beat.length, pick.hit.length, `Hit ${pick.site}`, why, s, pick.hit, 1.1) }
}

// rotations says if fakes work against them or if a fast hit does.
function rotations(s: Situation, best: string): PlanLine[] {
  const tr = s.tracks
  const withHit: number[] = []
  const came: number[] = []
  const nobody: number[] = []
  let first = 0
  let firstN = 0
  tr.forEach((t, i) => {
    const r = t.facts?.rotate
    if (!r) return
    withHit.push(i)
    const need = playersIn(t.facts!) >= 4 ? 2 : 1
    if (r.players >= need) came.push(i)
    if (r.first < 0 || r.first > 12) nobody.push(i)
    if (r.first >= 0) {
      first += r.first
      firstN++
    }
  })
  const n = withHit.length
  if (n < 2) return []
  const avg = firstN ? first / firstN : -1
  if (enough(came.length, n) && came.length * 2 >= n && avg >= 0 && avg <= 12) {
    const go = best || 'the other site'
    const fake = best === 'A' ? 'B' : best === 'B' ? 'A' : 'one site'
    return [line('fake', came.length, n, `Fake ${fake} with utility, then go ${go}`, `Once T got to a site, 2 or more of them came over within 20 s in ${of(came.length, n)}, the first after ${sec(avg)} on average.`, s, came, 1)]
  }
  if (enough(nobody.length, n) && nobody.length * 5 >= n * 3) {
    return [line('speed', nobody.length, n, 'Hit fast and plant, their help is slow to come', `Once T got to a site, nobody came over in the first 12 s in ${of(nobody.length, n)}.`, s, nobody, 0.9)]
  }
  return []
}

// ---- Your CT side, they are T ----

function vsT(s: Situation, rushSeconds: number): PlanLine[] {
  const out: PlanLine[] = []
  const tr = s.tracks
  const n = tr.length
  if (!n) return out
  const pistol = s.buy === 'pistol'
  const rush = tr.flatMap((t, i) => (t.hit && t.hitTime >= 0 && t.hitTime <= rushSeconds ? [i] : []))
  const bySite = (list: number[]) => {
    const m = new Map<string, number[]>()
    for (const i of list) m.set(tr[i].hit, [...(m.get(tr[i].hit) ?? []), i])
    return [...m].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }
  const entryOf = (list: number[]) => {
    const t = tally(
      list.map((i) => tr[i]),
      (f) => f.entry,
      (e) => e,
    )[0]
    return t && t[1].n >= 2 && t[1].n * 2 >= list.length ? t[0] : ''
  }
  const avgTime = (list: number[]) => list.reduce((x, i) => x + tr[i].hitTime, 0) / Math.max(1, list.length)
  const rushTop = bySite(rush)[0]
  if (rushTop && enough(rush.length, n, pistol)) {
    const [site, list] = rushTop
    const t = avgTime(list)
    const via = entryOf(list)
    const util = Math.max(5, t - 8)
    const where = via ? `on ${via}` : `at the ${site} entrance`
    const avg = list.length > 1 ? ' on average' : ''
    const what = rushTop[1].length === rush.length ? `rushed ${site} in ${of(list.length, n)}` : `rushed a site in ${of(rush.length, n)}, ${site} ${list.length} times`
    out.push(line('utility', list.length, n, `Stack ${site} early and have utility ${where} by ${clock(util)}`, `They ${what}, on site after ${sec(t)}${avg}${via ? `, through ${via}` : ''}.`, s, list, 1.25))
  }
  const hits = bySite(tr.flatMap((t, i) => (t.hit ? [i] : [])))
  const top = hits[0]
  const rushed = rushTop ? rushTop[1].length : 0
  if (top && top[1].length > rushed && enough(top[1].length, n, pistol) && top[1].length * 2 >= n) {
    const [site, list] = top
    const via = entryOf(list)
    const avg = list.length > 1 ? ' on average' : ''
    out.push(line('setup', list.length, n, `Play an extra player on ${site}`, `They went ${site} in ${of(list.length, n)}, on site after ${sec(avgTime(list))}${avg}${via ? `, mostly through ${via}` : ''}.`, s, list, 1.1))
  } else if (hits.length >= 2 && hits[1][1].length >= 2 && !rush.length) {
    out.push(line('setup', hits[0][1].length + hits[1][1].length, n, 'Keep a normal setup, they mix their sites', `${hits.map(([site, l]) => `${site} ${l.length}`).join(', ')} of ${n}.`, s, [], 0.5))
  }
  const hitRounds = tr.filter((t) => t.hit).length
  if (!rush.length && hitRounds >= 3) {
    const t = tr.reduce((x, r) => x + (r.hit ? r.hitTime : 0), 0) / hitRounds
    if (t >= 45) out.push(line('speed', hitRounds, n, 'Hold your setup and save utility for the late hit', `They never rushed in ${rounds(n)} and got to a site after ${sec(t)} on average.`, s, [], 0.8))
  }
  const lurk = tally(tr, (f) => (f.lurk?.place ? f.lurk : undefined), (l) => l.place, (l) => l.player)[0]
  if (lurk && hitRounds && enough(lurk[1].n, hitRounds, pistol)) {
    const [place, t] = lurk
    const by = mostly(t) || 'One of them'
    out.push(line('lurk', t.n, hitRounds, `Watch ${place} late in the round, a lurker sits there`, `${by} was away from the rest at ${place} when they hit, in ${of(t.n, hitRounds)}.`, s, t.idx, 0.8))
  }
  const awp = tally(tr, (f) => (f.awp?.place ? f.awp : undefined), (a) => a.place, (a) => a.player)[0]
  if (awp && enough(awp[1].n, n, pistol)) {
    const [place, t] = awp
    const by = mostly(t) || 'Their AWP'
    out.push(line('awp', t.n, n, `Expect their AWP at ${place} early`, `${by} had the AWP at ${place} at 15 s in ${of(t.n, n)}.`, s, t.idx, 0.6))
  }
  out.push(...openings(s, 't'))
  if ((s.buy === 'eco' || s.buy === 'force') && s.won >= 2 && s.won * 5 >= n * 2) {
    out.push(line('economy', s.won, n, 'Play from range and with trades, no close fights', `They won ${of(s.won, n)} of these rounds.`, s, idxWhere(tr, (t) => t.won), 0.8))
  }
  return out.sort(byScore)
}

// ---- Both sides ----

// openings looks at the first duel of their rounds: where they lose it
// and where they win it. side is theirs.
function openings(s: Situation, side: 'ct' | 't'): PlanLine[] {
  const out: PlanLine[] = []
  const tr = s.tracks
  const fought = tr.filter((t) => t.facts?.opening?.place).length
  if (fought < 2) return out
  const lost = tally(tr, (f) => (f.opening && !f.opening.won && f.opening.place ? f.opening : undefined), (o) => o.place, (o) => o.player)[0]
  if (lost && enough(lost[1].n, fought)) {
    const [place, t] = lost
    const by = mostly(t)
    const what = side === 'ct' ? `Take the first fight at ${place}` : `Hold ${place} early, they lose the first fight there`
    out.push(line('fight', t.n, fought, what, `Their first death was at ${place} in ${of(t.n, fought)}${by ? `, mostly ${by}` : ''}.`, s, t.idx, 0.9))
  }
  const won = tally(tr, (f) => (f.opening?.won && f.opening.place ? f.opening : undefined), (o) => o.place, (o) => o.player)[0]
  if (won) {
    const [place, t] = won
    const at = tr.filter((x) => x.facts?.opening?.place === place).length
    if (enough(t.n, fought) && t.n * 10 >= at * 7) {
      const by = mostly(t)
      const what = side === 'ct' ? `Flash ${place} or swing it with two, never peek it alone` : `Don't challenge ${place} early, play it from further back`
      out.push(line('fight', t.n, at, what, `They won the first duel at ${place} in ${of(t.n, at)}${by ? `, mostly ${by}` : ''}.`, s, t.idx, 0.9))
    }
  }
  return out
}

// afterPistol is what they buy the round after a lost pistol on a side.
function afterPistol(scout: MapScout, side: 'ct' | 't'): PlanLine | null {
  const pistol = scout.situations.find((s) => s.side === side && s.buy === 'pistol')
  if (!pistol) return null
  const buyOf = new Map<string, BuyKind>()
  for (const s of scout.situations) if (s.side === side) for (const t of s.tracks) buyOf.set(`${t.replayId}/${t.round}`, s.buy)
  const next = { force: 0, eco: 0, other: 0 }
  let n = 0
  const idx: number[] = []
  pistol.tracks.forEach((t, i) => {
    if (t.won) return
    const b = buyOf.get(`${t.replayId}/${t.round + 1}`)
    if (!b) return
    n++
    idx.push(i)
    if (b === 'force') next.force++
    else if (b === 'eco') next.eco++
    else next.other++
  })
  if (!n) return null
  if (next.force >= next.eco && next.force >= 1) {
    return line('economy', next.force, n, 'After you win the pistol, expect a force buy: no wide peeks, play for trades', `After losing the pistol they forced the next round in ${of(next.force, n)}.`, pistol, idx, 0.9)
  }
  if (next.eco >= 1) {
    return line('economy', next.eco, n, 'After you win the pistol, expect them to save: take map control and play for picks', `After losing the pistol they saved the next round in ${of(next.eco, n)}.`, pistol, idx, 0.7)
  }
  return null
}

// plants reads their retakes (you on T) or their post plants (you on CT).
function plantLines(list: PlantScout[], yourSide: 't' | 'ct'): PlanLine[] {
  const out: PlanLine[] = []
  const known = list.filter((p) => p.rounds >= 2)
  if (!known.length) return out
  const sorted = [...known].sort((a, b) => a.won / a.rounds - b.won / b.rounds)
  // Where they play after the plant, the site itself says nothing.
  const spots = (p: PlantScout) =>
    p.places
      .filter((x) => x.share >= 0.15 && !/bombsite|^[ab] site$/i.test(x.place))
      .slice(0, 2)
      .map((x) => x.place)
  // Time spent somewhere is not a count of rounds, so these stay likely at
  // most.
  const where = (kind: PlanKind, p: PlantScout, what: string, why: string) => {
    const l = line(kind, p.rounds, p.rounds, what, why, undefined, undefined, 0.45)
    if (l.strength === 'strong') l.strength = 'likely'
    return l
  }
  if (yourSide === 't') {
    // They are CT going for the retake: plant where they fail.
    const worst = sorted[0]
    if (worst.won * 5 <= worst.rounds * 2) {
      const other = sorted[1] ? ` On ${sorted[1].site} they won ${of(sorted[1].won, sorted[1].rounds)}.` : ''
      out.push(line('plant', worst.rounds - worst.won, worst.rounds, `Plant ${worst.site} when you can and play the post plant`, `They won the retake on ${worst.site} only ${of(worst.won, worst.rounds)}.${other}`, undefined, undefined, 1))
    }
    for (const p of known) {
      const at = spots(p)
      if (at.length) out.push(where('retake', p, `After ${an(p.site)} plant, watch ${and(at)} for the retake`, `Their retakes on ${p.site} came through ${and(at)} (${rounds(p.rounds)}).`))
    }
  } else {
    // They are T after their own plant.
    const worst = sorted[0]
    const best = sorted[sorted.length - 1]
    if (worst.won * 5 <= worst.rounds * 2) {
      out.push(line('retake', worst.rounds - worst.won, worst.rounds, `Always go for the retake on ${worst.site}`, `After planting ${worst.site} they won only ${of(worst.won, worst.rounds)}.`, undefined, undefined, 0.9))
    }
    if (best !== worst || worst.won * 5 > worst.rounds * 2) {
      if (best.won * 10 >= best.rounds * 7 && best.rounds >= 3) {
        out.push(line('retake', best.won, best.rounds, `Stop the ${best.site} plant, the retake is hard`, `After planting ${best.site} they won ${of(best.won, best.rounds)}.`, undefined, undefined, 0.9))
      }
    }
    for (const p of known) {
      const at = spots(p)
      if (at.length) out.push(where('retake', p, `On the ${p.site} retake, clear ${and(at)} first`, `After ${an(p.site)} plant they held ${and(at)} (${rounds(p.rounds)}).`))
    }
  }
  return out
}

function idxWhere(tr: SituationTrack[], ok: (t: SituationTrack) => boolean): number[] {
  return tr.flatMap((t, i) => (ok(t) ? [i] : []))
}

function byScore(a: PlanLine, b: PlanLine): number {
  return b.score - a.score
}

// gamePlan builds the plan for one map.
export function gamePlan(scout: MapScout): GamePlan {
  const rushSeconds = scoutOptions(scout).rushSeconds
  const side = (yours: 'ct' | 't'): PlanSide => {
    const theirs = yours === 'ct' ? 't' : 'ct'
    const parts: PlanPart[] = []
    for (const buy of PLAN_ORDER) {
      const s = scout.situations.find((x) => x.side === theirs && x.buy === buy)
      if (!s || !s.tracks.length) continue
      const lines = theirs === 'ct' ? vsCt(s) : vsT(s, rushSeconds)
      if (buy === 'pistol') {
        const eco = afterPistol(scout, theirs)
        if (eco) lines.push(eco)
      }
      parts.push({ key: s.key, buy, title: `Their ${s.title}`, rounds: s.tracks.length, lines })
    }
    const all = plantLines(yours === 't' ? scout.retake : scout.postPlant, yours)
    if (all.length) parts.push({ key: '', buy: null, title: 'After the plant', rounds: 0, lines: all.sort(byScore) })
    for (const p of parts) for (const l of p.lines) l.side = yours
    const n = theirs === 'ct' ? scout.ctRounds : scout.tRounds
    const won = scout.won[theirs]
    return {
      side: yours,
      title: `Your ${yours.toUpperCase()} side`,
      sub: `They are ${theirs.toUpperCase()}: ${rounds(n)}, they won ${won}.`,
      parts,
    }
  }
  const t = side('t')
  const ct = side('ct')
  const key = [...t.parts, ...ct.parts]
    .flatMap((p) => p.lines)
    .filter((l) => l.strength !== 'weak')
    .sort(byScore)
    .slice(0, KEY_LINES)
  return { map: scout.map, key, t, ct }
}

// planText writes a plan as plain text, for copying into a team chat or
// for the AI write-up.
export function planText(plan: GamePlan, mapName: string, teamName: string): string {
  const out: string[] = [`Game plan against ${teamName || 'them'} on ${mapName}`]
  const mark: Record<Strength, string> = { strong: '', likely: '', weak: ' (few rounds)' }
  for (const s of [plan.t, plan.ct]) {
    out.push('', `${s.title}. ${s.sub}`)
    for (const p of s.parts) {
      if (!p.lines.length) continue
      out.push(`${p.title}${p.rounds ? ` (${rounds(p.rounds)})` : ''}:`)
      for (const l of p.lines) out.push(`- ${l.do}${mark[l.strength]}. ${l.why}`)
    }
  }
  return out.join('\n')
}
