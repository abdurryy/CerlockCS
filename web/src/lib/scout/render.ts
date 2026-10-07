// Scouting images: heat and marks over the whole map, styled like the
// radar, with the name in the top left corner and the logo in the top
// right. One canvas per image, ready to save as PNG.

import { BAD, GOOD, teamColor } from '../colors'
import { mapLabel } from '../format'
import { FLAG, type Replay } from '../replay'
import type { MapInfo } from '../types'
import { EQ } from '../weapons'
import { Binner, ScoutBuilder, fitInfo, liveStart, newGrid, replayLabels, scoutLabels, scoutMapInfo, scoutOptions, shares } from './aggregate'
import {
  BASE,
  NADE_ICON,
  assets,
  compose,
  composeSummary,
  gridOf,
  stageFor,
  type Card,
  type Context,
  type Group,
  type Hit,
  type LegendItem,
  type Stage,
  type Row,
  type Stat,
  type Summary,
} from './poster'
import type { HeatGrid, KillMark, MapScout, PlaceShare, SideHeat, UtilityMark, Vec3 } from './types'

// The kinds of images, in the order they come out.
export type ScoutKind =
  | 'summary'
  | 'team'
  | 'executes'
  | 'postplant'
  | 'retake'
  | 'utility'
  | 'openings'
  | 'pistol'
  | 'eco'
  | 'awp'
  | 'deaths'
  | 'kills'
  | 'player-early'
  | 'player'
  | 'player-kills'
  | 'player-deaths'

export const SCOUT_KINDS: ScoutKind[] = [
  'summary', 'team', 'executes', 'postplant', 'retake', 'utility', 'openings', 'pistol', 'eco', 'awp', 'deaths', 'kills',
  'player-early', 'player', 'player-kills', 'player-deaths',
]

export interface ScoutImage {
  // File name without .png, plain ascii.
  name: string
  title: string
  subtitle: string
  canvas: HTMLCanvasElement
  kind: ScoutKind
  // 2 = T, 3 = CT, 0 for both sides.
  side: number
  // The player's name on per player images.
  player?: string
}

export interface MapImageOptions {
  size?: number
  teamName?: string
  // Only these kinds, all when left out.
  kinds?: ScoutKind[]
  // The team's map pool for the summary, for example from the FACEIT
  // match finder.
  pool?: { map: string; played: number; won: number }[]
  // Unix seconds the matches were played, by replay id, for the footer.
  dates?: Record<string, number>
  // Called with every image as soon as it is drawn.
  onImage?: (img: ScoutImage, done: number, total: number) => void | Promise<void>
}

// A second floor gets its own image when it has this share of the heat.
const FLOOR_SHARE = 0.15
// Single matches have fewer samples, so they use every 2nd frame.
const MATCH_STEP = 2
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LINE_COLOR = '#c9d1d9'
// From this many grenades a side also gets split utility images.
const BUSY_UTILITY = 30

// Cyrillic letters spelled out, so Russian and Ukrainian names still give
// readable file names.
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

// slug makes a plain ascii file name part.
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (c) => CYRILLIC[c] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function percent(v: number): string {
  return `${Math.round(v * 100)}%`
}

function ratio(won: number, of: number): string {
  return of ? percent(won / of) : '-'
}

// dateText writes unix seconds like "7 Oct".
function dateText(t: number): string {
  const d = new Date(t * 1000)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// datesLine lists match dates, oldest first, with the year at the end.
export function datesLine(dates: number[]): string {
  const known = dates.filter((d) => d > 0).sort((a, b) => a - b)
  if (!known.length) return ''
  const shown = known.length > 6 ? [...known.slice(0, 2), ...known.slice(-3)] : known
  const parts = shown.map(dateText)
  if (known.length > 6) parts.splice(2, 0, '…')
  return `${parts.join(', ')} ${new Date(known[known.length - 1] * 1000).getFullYear()}`
}

function placeStats(list: PlaceShare[], max = 4): Stat[] {
  return list.slice(0, max).map((p) => ({ value: percent(p.share), label: p.place }))
}

// setupText writes a setup like the Go side: "Outside 2, Bombsite A".
export function setupText(places: string[]): string {
  const counts = new Map<string, number>()
  for (const p of places) counts.set(p, (counts.get(p) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p, n]) => (n > 1 ? `${p} ${n}` : p))
    .join(', ')
}

function levelName(info: MapInfo, level: number): string {
  const n = info.levels[level]?.name ?? ''
  return !n || n === 'default' ? 'upper' : n
}

// floorsOf picks the floor with the most heat, plus any other floor with
// a fair share of it.
function floorsOf(info: MapInfo, g: HeatGrid): { level: number; suffix: string; floor: string }[] {
  const totals = g.levels.map((l) => {
    let s = 0
    for (let i = 0; i < l.length; i++) s += l[i]
    return s
  })
  const total = totals.reduce((a, b) => a + b, 0)
  const order = totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b)
  const multi = info.levels.length > 1
  const label = (l: number) => (multi ? `${levelName(info, l).replace(/^./, (c) => c.toUpperCase())} floor` : '')
  const out = [{ level: order[0] ?? 0, suffix: '', floor: label(order[0] ?? 0) }]
  for (const l of order.slice(1)) {
    if (total > 0 && totals[l] >= total * FLOOR_SHARE) out.push({ level: l, suffix: `-${slug(levelName(info, l))}`, floor: label(l) })
  }
  return out
}

type Draft = Omit<Card, 'level' | 'floor' | 'heat' | 'heatSize'> & { kindOf: ScoutKind }

function draft(d: Partial<Draft> & Pick<Draft, 'name' | 'kindOf' | 'title' | 'kicker' | 'side' | 'bits'>): Draft {
  return { kind: d.kindOf, sigma: 1.2, heatLabel: 'Time spent', hits: [], utility: [], lines: false, areas: false, plants: [], footer: [], legend: [], ...d }
}

interface Planned {
  card: Card
  kind: ScoutKind
}

// heatCards makes one card per floor that has enough heat.
function heatCards(info: MapInfo, d: Draft, g: HeatGrid): Planned[] {
  if (!g.samples) return []
  return floorsOf(info, g).map((f) => ({
    kind: d.kindOf,
    card: { ...d, name: d.name + f.suffix, level: f.level, floor: f.floor, heat: g.levels[f.level] ?? null, heatSize: g.size },
  }))
}

// markCards is the same for cards that show marks, with or without heat
// built from the marks underneath.
function markCards(info: MapInfo, d: Draft, points: Vec3[], heat: boolean): Planned[] {
  if (!points.length) return []
  const g = gridOf(info, points)
  return floorsOf(info, g).map((f) => ({
    kind: d.kindOf,
    card: { ...d, name: d.name + f.suffix, level: f.level, floor: f.floor, heat: heat ? (g.levels[f.level] ?? null) : null, heatSize: g.size },
  }))
}

function sideName(side: number): string {
  return side === 3 ? 'CT' : 'T'
}

function subtitleOf(c: Card, map: string): string {
  const side = c.side === 3 ? 'CT side' : c.side === 2 ? 'T side' : ''
  return [side, ...c.bits, map, c.floor].filter(Boolean).join(' · ')
}

function nadeStats(list: UtilityMark[]): Stat[] {
  const count = (types: number[]) => list.filter((g) => types.includes(g.type)).length
  return [
    { value: `${count([EQ.smoke])}`, label: 'Smokes', icon: NADE_ICON[EQ.smoke] },
    { value: `${count([EQ.flash])}`, label: 'Flashes', icon: NADE_ICON[EQ.flash] },
    { value: `${count([EQ.molotov, EQ.incendiary])}`, label: 'Molotovs', icon: NADE_ICON[EQ.molotov] },
    { value: `${count([EQ.he])}`, label: 'HE', icon: NADE_ICON[EQ.he] },
  ].filter((s) => s.value !== '0')
}

function topNames(names: string[], max = 3): Stat[] {
  const m = new Map<string, number>()
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1)
  return [...m]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([label, n]) => ({ value: `${n}`, label }))
}

function placesOf(names: string[]): PlaceShare[] {
  const m = new Map<string, number>()
  for (const n of names) if (n) m.set(n, (m.get(n) ?? 0) + 1)
  return shares(m)
}

function killHits(list: KillMark[], deaths: boolean): Hit[] {
  return list.map((k) => ({
    at: deaths ? k.victim : k.killer,
    to: deaths ? k.killer : k.victim,
    shape: deaths ? 'x' : 'dot',
    color: teamColor(k.side).base,
  }))
}

function killLegend(deaths: boolean): LegendItem[] {
  const shape = deaths ? 'x' : 'dot'
  const what = deaths ? 'death' : 'kill'
  return [
    { shape, color: teamColor(3).base, label: `CT side ${what}` },
    { shape, color: teamColor(2).base, label: `T side ${what}` },
  ]
}

function killFooter(list: KillMark[], deaths: boolean): Group[] {
  const ct = list.filter((k) => k.side === 3).length
  const t = list.filter((k) => k.side === 2).length
  const stats: Stat[] = [
    { value: `${ct}`, label: 'CT side', tint: teamColor(3).light },
    { value: `${t}`, label: 'T side', tint: teamColor(2).light },
    { value: `${list.filter((k) => k.opening).length}`, label: deaths ? 'Opening deaths' : 'Opening kills' },
  ]
  if (!deaths && list.length) stats.push({ value: percent(list.filter((k) => k.headshot).length / list.length), label: 'Headshots' })
  return [
    { label: deaths ? 'Deaths' : 'Kills', stats },
    { label: deaths ? 'Where they die' : 'Where they kill from', stats: placeStats(placesOf(list.map((k) => k.place)), 3) },
  ]
}

interface Ctx {
  scout: MapScout
  info: MapInfo
  map: string
  short: string
  team: string
  matches: string
  early: number
  earlyT: number
}

// heading puts the team name in the title and the image kind above it.
// Without a team name the kind becomes the title.
function heading(cx: Ctx, kind: string): { title: string; kicker: string } {
  return cx.team ? { title: cx.team, kicker: `${cx.map} · ${kind}` } : { title: kind, kicker: cx.map }
}

function sideHeatCards(cx: Ctx, kind: ScoutKind, label: string, h: SideHeat, side: number, extra: Partial<Draft>): Planned[] {
  if (!h.rounds || !h.heat.samples) return []
  const s = sideName(side).toLowerCase()
  return heatCards(
    cx.info,
    draft({
      name: `${cx.short}-${s}-${kind}`,
      kindOf: kind,
      ...heading(cx, label),
      side,
      bits: ['Whole round', plural(h.rounds, 'round'), cx.matches],
      footer: [
        { label: 'Record', stats: [{ value: ratio(h.won, h.rounds), label: `${h.won} of ${plural(h.rounds, 'round')} won` }] },
        { label: 'Most time', stats: placeStats(h.places, 3) },
      ],
      ...extra,
    }),
    h.heat,
  )
}

// ctFooter shows the setups that came back more than once, or else how
// many players stand on each spot at the early CT moment.
function ctFooter(scout: MapScout, early: number): Group {
  const repeated = scout.ctSetups.filter((s) => s.count > 1)
  if (repeated.length && scout.ctRounds) {
    return {
      label: `Most common setups ${early}s in`,
      stats: repeated.slice(0, 2).map((s) => ({ value: percent(s.count / scout.ctRounds), label: setupText(s.places) })),
    }
  }
  return { label: `Players per spot ${early}s in`, stats: spots(scout).slice(0, 5).map(([place, n]) => ({ value: n.toFixed(1), label: place })) }
}

function spots(scout: MapScout): [string, number][] {
  const m = new Map<string, number>()
  for (const p of scout.players) {
    for (const ps of p.ctPlaces) m.set(ps.place, (m.get(ps.place) ?? 0) + ps.share * p.ctRounds)
  }
  return [...m].map(([k, v]) => [k, v / Math.max(1, scout.ctRounds)] as [string, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function planCards(cx: Ctx, want: Set<ScoutKind>): Planned[] {
  const { scout, info, short, matches, early, earlyT } = cx
  const so = scoutOptions(scout)
  const out: Planned[] = []
  const add = (kind: ScoutKind, make: () => Planned[]) => {
    if (want.has(kind)) out.push(...make())
  }

  add('team', () => [
    ...heatCards(
      info,
      draft({
        name: `${short}-ct-team`,
        kindOf: 'team',
        ...heading(cx, 'Whole team'),
        side: 3,
        bits: ['Whole round', plural(scout.ctRounds, 'round'), matches],
        footer: [{ label: 'Record', stats: [{ value: ratio(scout.won.ct, scout.ctRounds), label: `${scout.won.ct} of ${plural(scout.ctRounds, 'round')} won` }] }, ctFooter(scout, early)],
      }),
      scout.team.ct,
    ),
    ...heatCards(
      info,
      draft({
        name: `${short}-t-team`,
        kindOf: 'team',
        ...heading(cx, 'Whole team'),
        side: 2,
        bits: ['Whole round', plural(scout.tRounds, 'round'), matches],
        footer: [
          { label: 'Record', stats: [{ value: ratio(scout.won.t, scout.tRounds), label: `${scout.won.t} of ${plural(scout.tRounds, 'round')} won` }] },
          {
            label: 'Sites hit',
            stats: [
              ...scout.executes.map((e) => ({ value: percent(e.share), label: `${e.site} site, ${plural(e.rounds, 'round')}` })),
              ...(scout.noHit && scout.tRounds ? [{ value: percent(scout.noHit / scout.tRounds), label: 'No hit' }] : []),
            ],
          },
        ],
      }),
      scout.team.t,
    ),
  ])

  add('executes', () =>
    scout.executes.flatMap((ex) =>
      heatCards(
        info,
        draft({
          name: `${short}-t-execute-${slug(ex.site) || 'site'}`,
          kindOf: 'executes',
          ...heading(cx, `${ex.site} execute`),
          side: 2,
          bits: [`${Math.round(so.preHitSeconds)}s before the hit`, `${ex.rounds} of ${plural(scout.tRounds, 'round')}`, matches],
          sigma: 1.5,
          utility: ex.utility,
          lines: true,
          areas: true,
          plants: ex.plants,
          footer: [
            {
              label: 'Execute',
              stats: [
                { value: percent(ex.share), label: 'of T rounds' },
                { value: `${Math.round(ex.avgHitTime)}s`, label: 'Avg hit time' },
                ...(ex.plants.length ? [{ value: `${ex.plants.length}`, label: 'Plants' }] : []),
              ],
            },
            { label: `Utility from ${Math.round(so.utilitySeconds)}s before`, stats: nadeStats(ex.utility) },
          ],
          legend: [
            { line: LINE_COLOR, label: 'Thrown from' },
            ...(ex.plants.length ? [{ c4: true as const, label: 'Plant' }] : []),
          ],
        }),
        ex.positions,
      ),
    ),
  )

  const plantCards = (kind: 'postplant' | 'retake') => {
    const list = kind === 'postplant' ? scout.postPlant : scout.retake
    const side = kind === 'postplant' ? 2 : 3
    return list.flatMap((pl) =>
      heatCards(
        info,
        draft({
          name: `${short}-${sideName(side).toLowerCase()}-${kind}-${slug(pl.site) || 'site'}`,
          kindOf: kind,
          ...heading(cx, kind === 'postplant' ? `${pl.site} post plant` : `${pl.site} retake`),
          side,
          bits: ['After the plant', plural(pl.rounds, 'round'), matches],
          sigma: 1.3,
          heatLabel: 'Time after the plant',
          plants: pl.plants,
          footer: [
            { label: 'Record', stats: [{ value: ratio(pl.won, pl.rounds), label: `${pl.won} of ${plural(pl.rounds, 'round')} won` }] },
            { label: kind === 'postplant' ? 'Where they play it' : 'Where they retake from', stats: placeStats(pl.places, 3) },
          ],
          legend: [{ c4: true, label: 'Plant' }],
        }),
        pl.heat,
      ),
    )
  }
  add('postplant', () => plantCards('postplant'))
  add('retake', () => plantCards('retake'))

  // Utility per side, and when a side throws a lot, the same split in
  // smokes with molotovs and flashes with HE so lineups stay readable.
  const utilityCards = (side: 2 | 3, list: UtilityMark[], suffix: string, label: string) => {
    const rounds = side === 3 ? scout.ctRounds : scout.tRounds
    const top = topNames(list.map((g) => g.player), 2)
    return markCards(
      info,
      draft({
        name: `${short}-${sideName(side).toLowerCase()}-utility${suffix}`,
        kindOf: 'utility',
        ...heading(cx, label),
        side,
        bits: ['Whole round', plural(list.length, 'grenade'), plural(rounds, 'round'), matches],
        utility: list,
        lines: true,
        footer: [
          { label: 'Thrown', stats: nadeStats(list) },
          { label: 'Most utility', stats: [{ value: rounds ? (list.length / rounds).toFixed(1) : '-', label: 'Per round' }, ...top] },
        ],
        legend: [{ line: LINE_COLOR, label: 'Thrown from' }],
      }),
      list.map((g) => g.pos),
      false,
    )
  }
  add('utility', () =>
    ([3, 2] as const).flatMap((side) => {
      const list = side === 3 ? scout.utility.ct : scout.utility.t
      const name = sideName(side)
      const out = utilityCards(side, list, '', `${name} utility`)
      if (list.length >= BUSY_UTILITY) {
        const smokes = list.filter((g) => g.type === EQ.smoke || g.type === EQ.molotov || g.type === EQ.incendiary)
        const flashes = list.filter((g) => g.type === EQ.flash || g.type === EQ.he)
        out.push(...utilityCards(side, smokes, '-smokes', `${name} smokes and molotovs`))
        out.push(...utilityCards(side, flashes, '-flashes', `${name} flashes and HE`))
      }
      return out
    }),
  )

  add('openings', () =>
    ([3, 2] as const).flatMap((side) => {
      const list = scout.openings.filter((o) => o.side === side)
      const won = list.filter((o) => o.won)
      return markCards(
        info,
        draft({
          name: `${short}-${sideName(side).toLowerCase()}-openings`,
          kindOf: 'openings',
          ...heading(cx, 'Opening duels'),
          side,
          bits: ['First kill of the round', plural(list.length, 'round'), matches],
          sigma: 2.6,
          heatLabel: 'Opening duels',
          hits: list.map((o) => ({ at: o.won ? o.killer : o.victim, to: o.won ? o.victim : o.killer, shape: o.won ? 'dot' : 'x', color: o.won ? GOOD : BAD })),
          footer: [
            { label: 'Opening duels', stats: [{ value: ratio(won.length, list.length), label: `${won.length} of ${list.length} won` }] },
            { label: 'Opening kills', stats: topNames(won.map((o) => o.player), 2) },
            { label: 'Where', stats: placeStats(placesOf(list.map((o) => o.place)), 2) },
          ],
          legend: [
            { shape: 'dot', color: GOOD, label: 'Opening kill' },
            { shape: 'x', color: BAD, label: 'Opening death' },
          ],
        }),
        list.map((o) => (o.won ? o.killer : o.victim)),
        true,
      )
    }),
  )

  add('pistol', () => [
    ...sideHeatCards(cx, 'pistol', 'Pistol rounds', scout.pistol.ct, 3, {}),
    ...sideHeatCards(cx, 'pistol', 'Pistol rounds', scout.pistol.t, 2, {}),
  ])

  const ecoCards = (h: SideHeat, side: number) =>
    sideHeatCards(cx, 'eco', 'Eco and force rounds', h, side, {
      footer: [
        { label: 'Record', stats: h.splits.map((sp) => ({ value: `${sp.won} of ${sp.rounds}`, label: `${sp.label} rounds won` })) },
        { label: 'Most time', stats: placeStats(h.places, 3) },
      ],
    })
  add('eco', () => [...ecoCards(scout.eco.ct, 3), ...ecoCards(scout.eco.t, 2)])

  const awpCards = (h: SideHeat, side: 2 | 3) => {
    const key = side === 3 ? 'ct' : 't'
    const total = scout.players.reduce((n, p) => n + p.awp[key], 0)
    const awpers = scout.players
      .filter((p) => p.awp[key] > 0)
      .sort((a, b) => b.awp[key] - a.awp[key])
      .slice(0, 2)
      .map((p) => ({ value: percent(p.awp[key] / Math.max(1e-9, total)), label: p.name }))
    return heatCards(
      cx.info,
      draft({
        name: `${short}-${key}-awp`,
        kindOf: 'awp',
        ...heading(cx, 'AWP'),
        side,
        bits: ['While holding the AWP', `${h.rounds} of ${plural(side === 3 ? scout.ctRounds : scout.tRounds, 'round')}`, matches],
        heatLabel: 'Time with the AWP',
        footer: [
          { label: 'Who holds it', stats: awpers },
          { label: 'Most held', stats: placeStats(h.places, 3) },
        ],
      }),
      h.heat,
    )
  }
  add('awp', () => [...awpCards(scout.awp.ct, 3), ...awpCards(scout.awp.t, 2)])

  const rounds = scout.ctRounds + scout.tRounds
  const killCards = (deaths: boolean, list: KillMark[], name: string, title: { title: string; kicker: string }, kind: ScoutKind, player?: string): Planned[] =>
    markCards(
      info,
      draft({
        name,
        kindOf: kind,
        player,
        ...title,
        side: 0,
        bits: [plural(list.length, deaths ? 'death' : 'kill'), plural(rounds, 'round'), matches],
        sigma: 2.4,
        heatLabel: deaths ? 'Deaths' : 'Kills',
        hits: killHits(list, deaths),
        footer: killFooter(list, deaths),
        legend: killLegend(deaths),
      }),
      list.map((k) => (deaths ? k.victim : k.killer)),
      true,
    )
  add('deaths', () => killCards(true, scout.players.flatMap((p) => p.deaths), `${short}-team-deaths`, heading(cx, 'Deaths'), 'deaths'))
  add('kills', () => killCards(false, scout.players.flatMap((p) => p.kills), `${short}-team-kills`, heading(cx, 'Kills'), 'kills'))

  scout.players.forEach((p, i) => {
    const ps = slug(p.name) || `player-${i + 1}`
    const base = `${short}-player-${ps}`
    const kicker = cx.team ? `${cx.map} · ${cx.team}` : cx.map
    const who = { title: p.name, kicker, player: p.name }
    add('player-early', () => [
      ...heatCards(
        info,
        draft({
          name: `${base}-ct-early`,
          kindOf: 'player-early',
          ...who,
          side: 3,
          bits: [`First ${early}s`, plural(p.ctRounds, 'round'), matches],
          footer: [{ label: `Where they are ${early}s in`, stats: placeStats(p.ctPlaces) }],
        }),
        p.ctEarly,
      ),
      ...heatCards(
        info,
        draft({
          name: `${base}-t-early`,
          kindOf: 'player-early',
          ...who,
          side: 2,
          bits: [`First ${earlyT}s`, plural(p.tRounds, 'round'), matches],
          footer: [{ label: `Where they are ${earlyT}s in`, stats: placeStats(p.tEarlyPlaces) }],
        }),
        p.tEarly,
      ),
    ])
    add('player', () => [
      ...heatCards(
        info,
        draft({
          name: `${base}-ct`,
          kindOf: 'player',
          ...who,
          side: 3,
          bits: ['Whole round', plural(p.ctRounds, 'round'), matches],
          footer: [{ label: `Where they are ${early}s in`, stats: placeStats(p.ctPlaces) }],
        }),
        p.ct,
      ),
      ...heatCards(
        info,
        draft({
          name: `${base}-t`,
          kindOf: 'player',
          ...who,
          side: 2,
          bits: ['Whole round', plural(p.tRounds, 'round'), matches],
          footer: [{ label: 'Where they are when the site is hit', stats: placeStats(p.tPlaces) }],
        }),
        p.t,
      ),
    ])
    add('player-kills', () => killCards(false, p.kills, `${base}-kills`, who, 'player-kills', p.name))
    add('player-deaths', () => killCards(true, p.deaths, `${base}-deaths`, who, 'player-deaths', p.name))
  })
  return out
}

function summaryOf(cx: Ctx, pool: MapImageOptions['pool']): Summary {
  const { scout, early } = cx
  const n = scout.replays.length
  const w = scout.replays.filter((r) => r.won === true).length
  const l = scout.replays.filter((r) => r.won === false).length
  const d = n - w - l
  const rounds = scout.ctRounds + scout.tRounds
  const pistols = [scout.pistol.ct, scout.pistol.t]
  const pistolWon = pistols.reduce((s, h) => s + h.won, 0)
  const pistolRounds = pistols.reduce((s, h) => s + h.rounds, 0)
  const openWon = scout.openings.filter((o) => o.won).length
  const sites: Row[] = scout.executes.map((e) => ({
    label: `${e.site} site`,
    value: percent(e.share),
    note: `${plural(e.rounds, 'round')} · hit after ${Math.round(e.avgHitTime)}s · ${plural(e.plants.length, 'plant')}`,
    share: e.share,
    site: e.site,
    side: 2,
  }))
  if (scout.noHit && scout.tRounds) {
    sites.push({ label: 'No site hit', value: percent(scout.noHit / scout.tRounds), note: `${plural(scout.noHit, 'round')} · saves, picks or time`, share: scout.noHit / scout.tRounds, side: 2 })
  }
  for (const pl of scout.postPlant) {
    sites.push({ label: `${pl.site} post plant`, value: ratio(pl.won, pl.rounds), note: `${pl.won} of ${plural(pl.rounds, 'plant')} held${pl.places[0] ? ` · mostly ${pl.places[0].place}` : ''}`, share: pl.rounds ? pl.won / pl.rounds : 0, side: 2 })
  }
  const repeated = scout.ctSetups.filter((s) => s.count > 1)
  const setups: Row[] = repeated.length
    ? repeated.slice(0, 3).map((s) => ({ label: setupText(s.places), value: percent(s.count / Math.max(1, scout.ctRounds)), note: `Setup ${early}s in · ${s.count} of ${plural(scout.ctRounds, 'round')}`, share: s.count / Math.max(1, scout.ctRounds), side: 3 }))
    : spots(scout).slice(0, 3).map(([place, v]) => ({ label: place, value: v.toFixed(1), note: `Players there ${early}s in, on average`, share: Math.min(1, v / 5), side: 3 }))
  for (const pl of scout.retake) {
    setups.push({ label: `${pl.site} retake`, value: ratio(pl.won, pl.rounds), note: `${pl.won} of ${plural(pl.rounds, 'plant')} won back${pl.places[0] ? ` · mostly from ${pl.places[0].place}` : ''}`, share: pl.rounds ? pl.won / pl.rounds : 0, side: 3 })
  }
  const awpTotal = scout.players.reduce((s, p) => s + p.awp.ct + p.awp.t, 0)
  const main = (list: PlaceShare[]) => (list[0] ? `${list[0].place} ${percent(list[0].share)}` : '-')
  const ct = scout.won.ct
  const t = scout.won.t
  return {
    name: `${cx.short}-summary`,
    title: cx.team || 'Scouting summary',
    kicker: cx.team ? `${cx.map} · Scouting summary` : cx.map,
    bits: [plural(n, 'match'), plural(rounds, 'round'), datesLine(scout.replays.map((r) => r.date))],
    tiles: [
      { label: 'Matches', value: d ? `${w}-${l}-${d}` : `${w}-${l}`, note: `${w} won, ${l} lost on ${cx.map}` },
      { label: 'CT side', value: ratio(ct, scout.ctRounds), note: `${ct} of ${plural(scout.ctRounds, 'round')} won`, side: 3 },
      { label: 'T side', value: ratio(t, scout.tRounds), note: `${t} of ${plural(scout.tRounds, 'round')} won`, side: 2 },
      { label: 'Pistol rounds', value: `${pistolWon} of ${pistolRounds}`, note: `${ratio(pistolWon, pistolRounds)} won` },
      { label: 'Opening duels', value: ratio(openWon, scout.openings.length), note: `${openWon} of ${scout.openings.length} won` },
    ],
    left: { label: 'T side', rows: sites.slice(0, 5), side: 2 },
    right: { label: 'CT side', rows: setups.slice(0, 5), side: 3 },
    players: {
      label: 'Players',
      head: [`CT, ${early}s in`, 'T, at the hit', 'Kills - deaths', 'AWP'],
      rows: scout.players.map((p) => ({
        name: p.name,
        cells: [
          main(p.ctPlaces),
          main(p.tPlaces),
          `${p.kills.length} - ${p.deaths.length}`,
          awpTotal > 0 && p.awp.ct + p.awp.t > 0 ? percent((p.awp.ct + p.awp.t) / awpTotal) : '-',
        ],
      })),
    },
    pool: (pool ?? []).map((m) => ({ ...m, current: m.map === scout.map })),
  }
}

function contextOf(cx: Ctx): Context {
  const line = [cx.map, cx.matches, datesLine(cx.scout.replays.map((r) => r.date))].filter(Boolean).join(' · ')
  return { line, results: [...cx.scout.replays].sort((a, b) => a.date - b.date).map((r) => ({ won: r.won, score: r.score })) }
}

function names(): (base: string) => string {
  const used = new Set<string>()
  return (base) => {
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`
    used.add(name)
    return name
  }
}

function allGrids(scout: MapScout): HeatGrid[] {
  return [
    scout.team.ct,
    scout.team.t,
    ...scout.players.flatMap((p) => [p.ct, p.t]),
  ]
}

async function draw(planned: Planned[], context: Context, map: string, st: Stage, S: number, opts: MapImageOptions, summary: Summary | null): Promise<ScoutImage[]> {
  const logo = await assets(S)
  const out: ScoutImage[] = []
  const unique = names()
  const total = planned.length + (summary ? 1 : 0)
  const emit = async (img: ScoutImage) => {
    out.push(img)
    await opts.onImage?.(img, out.length, total)
    // Let the page breathe between images.
    await new Promise((r) => setTimeout(r, 0))
  }
  if (summary) {
    const canvas = composeSummary(summary, context, S, logo)
    await emit({ name: unique(summary.name), title: summary.title, subtitle: summary.bits.filter(Boolean).join(' · '), canvas, kind: 'summary', side: 0 })
  }
  for (const { card, kind } of planned) {
    const canvas = compose(card, context, st, S, logo)
    await emit({ name: unique(card.name), title: card.title, subtitle: subtitleOf(card, map), canvas, kind, side: card.side, player: card.player })
  }
  return out
}

function ctxOf(scout: MapScout, team: string, dates?: Record<string, number>): Ctx {
  const so = scoutOptions(scout)
  if (dates) {
    for (const r of scout.replays) if (!r.date && dates[r.id]) r.date = dates[r.id]
  }
  const map = mapLabel(scout.map)
  return {
    scout,
    info: scout.info,
    map,
    short: slug(map) || 'map',
    team,
    matches: plural(scout.replays.length, 'match'),
    early: Math.round(so.earlyCtSeconds),
    earlyT: Math.round(so.earlyTSeconds ?? 25),
  }
}

// renderMapImages draws the scouting images of one map: a summary, the
// team on each side, executes, post plants and retakes, utility, opening
// duels, pistol, eco and AWP rounds, kill and death maps, and every
// player's early round, whole round, kills and deaths.
export async function renderMapImages(scout: MapScout, opts: MapImageOptions = {}): Promise<ScoutImage[]> {
  const S = Math.max(400, Math.round(opts.size ?? BASE))
  const cx = ctxOf(scout, opts.teamName?.trim() ?? '', opts.dates)
  const want = new Set<ScoutKind>(opts.kinds?.length ? opts.kinds : SCOUT_KINDS)
  const planned = planCards(cx, want)
  const st = await stageFor(scout.info, scoutLabels(scout) ?? { callouts: [], sites: [] }, allGrids(scout))
  return draw(planned, contextOf(cx), cx.map, st, S, opts, want.has('summary') ? summaryOf(cx, opts.pool) : null)
}

// renderMapPngs renders the images of a map one at a time and keeps only
// the PNG bytes, which keeps memory low for a full export.
export async function renderMapPngs(
  scout: MapScout,
  opts: Omit<MapImageOptions, 'onImage'> = {},
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ name: string; data: Uint8Array }[]> {
  const files: { name: string; data: Uint8Array }[] = []
  await renderMapImages(scout, {
    ...opts,
    onImage: async (img, done, total) => {
      files.push({ name: `${img.name}.png`, data: await canvasToPng(img.canvas) })
      img.canvas.width = 0
      img.canvas.height = 0
      onProgress?.(done, total, img.name)
    },
  })
  return files
}

// renderMatchPlayers draws one image per player of a team in a single
// match, plus one for the whole team. With kinds it draws those kinds of
// the map images instead, from this match alone, limited to side when
// one is given.
export async function renderMatchPlayers(
  replay: Replay,
  team: number,
  opts: { side: 0 | 2 | 3; window: 'round' | 'early'; earlySeconds?: number; size?: number; kinds?: ScoutKind[]; onImage?: MapImageOptions['onImage'] },
): Promise<ScoutImage[]> {
  const S = Math.max(400, Math.round(opts.size ?? BASE))
  const r = replay
  const info = fitInfo(r, await scoutMapInfo(r.match.map))
  const early = Math.max(1, Math.round(opts.earlySeconds ?? 20))
  if (opts.kinds?.length) {
    const roster = r.match.players.filter((p) => p.team === team && p.steamId && p.steamId !== '0').map((p) => ({ steamId: p.steamId, name: p.name }))
    const b = new ScoutBuilder(roster, { earlyCtSeconds: early, earlyTSeconds: early })
    b.add(r, '', r.teamName(team), info)
    const [scout] = b.result()
    if (!scout) return []
    const cx = ctxOf(scout, r.teamName(team))
    cx.matches = `vs ${r.teamName(1 - team)}`
    const want = new Set(opts.kinds)
    const planned = planCards(cx, want).filter((p) => !opts.side || !p.card.side || p.card.side === opts.side)
    const st = await stageFor(info, replayLabels(r, info), allGrids(scout))
    return draw(planned, contextOf(cx), cx.map, st, S, { onImage: opts.onImage }, want.has('summary') ? summaryOf(cx, []) : null)
  }
  return matchHeat(r, team, info, S, early, opts)
}

// matchHeat is the plain single match export: where each player of the
// team spent their time on one side or both, over the whole round or the
// first seconds.
async function matchHeat(
  r: Replay,
  team: number,
  info: MapInfo,
  S: number,
  early: number,
  opts: { side: 0 | 2 | 3; window: 'round' | 'early'; onImage?: MapImageOptions['onImage'] },
): Promise<ScoutImage[]> {
  const L = info.levels.length
  const bin = new Binner(info)
  const members = r.teamPlayers[team] ?? []
  const isEarly = opts.window === 'early'
  const grids = members.map(() => newGrid(L))
  const all = newGrid(L)
  const placeCount = members.map(() => new Uint32Array(Math.max(1, r.places.length)))
  const F = r.frames
  let rounds = 0
  let won = 0
  for (const rd of r.match.rounds) {
    const s = rd.sideOf?.[team]
    if ((s !== 2 && s !== 3) || rd.endTick <= rd.freezeEndTick) continue
    if (opts.side && s !== opts.side) continue
    rounds++
    if (rd.winnerTeam === team) won++
    const live = liveStart(r, rd)
    const a = r.frameIndex(live)
    const b = r.frameIndex(rd.endTick)
    const end = isEarly ? Math.min(b, r.frameIndex(live + early * r.rate)) : b
    members.forEach((p, k) => {
      const base = p * F
      for (let f = a; f <= end; f += MATCH_STEP) {
        const j = base + f
        if (!(r.pflags[j] & FLAG.alive)) continue
        const ps = r.pside[j]
        if ((ps !== 2 && ps !== 3) || (opts.side && ps !== opts.side)) continue
        const c = bin.cell(r.px[j], r.py[j], r.pz[j])
        if (c < 0) continue
        bin.put(grids[k], c)
        bin.put(all, c)
        if (r.pplace.length) placeCount[k][r.pplace[j]]++
      }
    })
  }
  const timeShares = (counts: Uint32Array[]): PlaceShare[] => {
    const m = new Map<string, number>()
    for (const c of counts) {
      c.forEach((n, i) => {
        const name = n ? r.placeName(i) : ''
        if (name) m.set(name, (m.get(name) ?? 0) + n)
      })
    }
    return shares(m)
  }

  const st = await stageFor(info, replayLabels(r, info), [all, ...grids])
  const map = mapLabel(r.match.map)
  const short = slug(map) || 'map'
  const sideSlug = opts.side === 3 ? 'ct' : opts.side === 2 ? 't' : 'both'
  const suffix = `${sideSlug}${isEarly ? '-early' : ''}`
  const teamName = r.teamName(team)
  const other = r.teamName(1 - team)
  const ours = r.match.teams?.[team]?.score ?? 0
  const theirs = r.match.teams?.[1 - team]?.score ?? 0
  const bits = [isEarly ? `First ${early}s` : 'Whole round', plural(rounds, 'round'), `vs ${other}`]
  const where = isEarly ? `Most time in the first ${early}s` : 'Most time'
  const kind: ScoutKind = isEarly ? 'player-early' : 'player'

  const planned: Planned[] = [
    ...heatCards(
      info,
      draft({
        name: `${short}-team-${suffix}`,
        kindOf: kind,
        title: teamName,
        kicker: `${map} · Whole team`,
        side: opts.side,
        bits,
        footer: [
          { label: 'Record', stats: [{ value: ratio(won, rounds), label: `${won} of ${plural(rounds, 'round')} won` }] },
          { label: where, stats: placeStats(timeShares(placeCount), 3) },
        ],
      }),
      all,
    ),
  ]
  members.forEach((p, k) => {
    const name = r.playerName(p)
    planned.push(
      ...heatCards(
        info,
        draft({
          name: `${short}-player-${slug(name) || `player-${k + 1}`}-${suffix}`,
          kindOf: kind,
          player: name,
          title: name,
          kicker: `${map} · ${teamName}`,
          side: opts.side,
          bits,
          footer: [{ label: where, stats: placeStats(timeShares([placeCount[k]])) }],
        }),
        grids[k],
      ),
    )
  })
  const context: Context = {
    line: `${map} · ${teamName} vs ${other}`,
    results: [{ won: ours > theirs ? true : ours < theirs ? false : null, score: `${ours}-${theirs}` }],
  }
  return draw(planned, context, map, st, S, { onImage: opts.onImage }, null)
}

export function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => {
      if (!blob) {
        reject(new Error('could not save the image'))
        return
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    }, 'image/png')
  })
}

