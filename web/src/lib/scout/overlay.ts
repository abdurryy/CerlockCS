// Situation overlay: every round of one situation, like T pistol rounds,
// drawn on top of each other on the styled map at one moment after
// freeze time. Players are dots in their own colour with a short fading
// trail, utility shows while it is up, deaths stay as an X. The same
// drawing is used by the player in the app, saved frames and videos.

import { ACCENT, BAD, BG, GOOD, TEXT, TEXT_2, teamColor } from '../colors'
import { mapLabel } from '../format'
import { drawIcon, iconBitmap, weaponIcon } from '../icons.svelte'
import { FONT, circle, flameSprite, roundRect, setSpacing, smokeSprite } from '../render/draw'
import { lerpAngle } from '../replay'
import type { MapInfo } from '../types'
import { EQ, NADE_COLOR } from '../weapons'
import { levelOf, scoutLabels, scoutOptions, type MapLabels } from './aggregate'
import { nearestPlace } from './spots'
import {
  FIRE_RADIUS,
  SMOKE_RADIUS,
  assetsAt,
  c4Mark,
  drawFloor,
  drawLabels,
  drawShape,
  fitText,
  font,
  gridLines,
  logoAt,
  logoMark,
  nadeBadge,
  sideChip,
  stageFor,
  type Rect,
  type Stage,
  type View,
} from './poster'
import type { MapScout, RoleCard, Situation, SituationTrack, TrackEvent, TrackPlayer } from './types'

// 'auto' adds a second floor when the team spends a fair share of the
// time there, a number shows that floor alone.
export type FloorMode = 'auto' | 'both' | number

// 'together' puts everyone on one map, 'players' gives every player a map
// of their own plus one with everyone, 'rounds' gives every round a map of
// its own.
export type OverlayLayout = 'together' | 'players' | 'rounds'

// A map per round shows at most this many rounds at once.
export const MAX_ROUND_MAPS = 9

export interface OverlayOptions {
  // Tracks to show, by index into situation.tracks. All when left out.
  rounds?: readonly number[] | null
  // A player's steamId. The others fade back.
  highlight?: string | null
  floors?: FloorMode
  // Seconds of trail behind each player.
  trail?: number
  // Cuts the time bar at this many seconds, for a shorter video.
  length?: number
  layout?: OverlayLayout
  // One round of a round by round video: the side column lists what
  // happens in it instead of the totals.
  story?: Story
  // How much of the round's title card covers the map, 0 to 1.
  intro?: number
  // How much of the video's summary card covers the map, 0 to 1.
  cover?: number
  // A still of every round at its end, with the whole routes: rounds do
  // not fade and there is no clock.
  sheet?: boolean
}

export interface Story {
  // The round's place in the video, 1 based, and how many there are.
  n: number
  of: number
}

const TEXT_3 = '#6e7883'
const LINE = '#242a32'
const LINE_2 = '#313841'
const SURFACE = '#12151a'
const SURFACE_2 = '#181c22'
const EDGE = 'rgba(6,8,11,0.88)'

const TRAIL = 2.5
// Trails fade in this many steps, one path per step.
const BANDS = 6
// Things on another floor than the one drawn.
const OFF_FLOOR = 0.32
// Everyone but the highlighted player.
const FADED = 0.18
// A second floor is shown with this share of the heat.
const FLOOR_SHARE = 0.15
const KILL_LINE = 1.6
const THROW_LINE = 2.5
const FLASH_POP = 0.45
const HE_POP = 0.55
const DECOY_SHOW = 2
// Half the width of a view cone, in radians.
const CONE = 0.42
// Seconds a round takes to fade out once it is over.
const ENDED_FADE = 1.5
// With this many rounds on screen, kill lines, flash pops and the dead
// are left out and trails get shorter, or the map is a mess.
const BUSY = 3
const BUSY_TRAIL = 1.2
const BUSY_AREA = 0.5
// Seconds a dead player stays on a busy map.
const DEAD_SHOW = 3
// Room above each player's map for their name.
const PANEL_LABEL = 30

// Layout units. Wide frames are laid out on 1920 x 1080, square ones on
// the posters' 1600 grid.
const WIDE_W = 1920
const WIDE_H = 1080
const SQUARE = 1600

// clockText writes seconds like the round clock does, "0:07".
export function clockText(t: number): string {
  const s = Math.max(0, Math.floor(t + 1e-6))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// shortLabel shortens a track label for a chip: "Match 2, round 13"
// becomes "M2 R13", "Round 4" becomes "R4".
export function shortLabel(label: string): string {
  const m = /^Match (\d+), round (\d+)$/.exec(label)
  if (m) return `M${m[1]} R${m[2]}`
  const r = /^Round (\d+)$/.exec(label)
  return r ? `R${r[1]}` : label
}

// floorsFor picks the floors to draw from the heat per floor: the busiest
// one, plus the next when it has a fair share or both are asked for.
// Returns floor indices, top floor first.
export function floorsFor(totals: number[], mode: FloorMode): number[] {
  const n = totals.length
  if (!n) return [0]
  if (typeof mode === 'number') return [Math.max(0, Math.min(n - 1, Math.round(mode)))]
  const order = totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b)
  const sum = totals.reduce((a, b) => a + b, 0)
  const out = [order[0]]
  const next = order[1]
  if (next !== undefined && (mode === 'both' || (sum > 0 && totals[next] >= sum * FLOOR_SHARE))) out.push(next)
  return out.sort((a, b) => a - b)
}

type Box = [number, number, number, number]

// arrange fits floor boxes (radar pixels) into an area at one scale, side
// by side or stacked, whichever is bigger. Returns a view per box.
export function arrange(boxes: Box[], area: Rect, gap: number): View[] {
  const ws = boxes.map((b) => b[2] - b[0])
  const hs = boxes.map((b) => b[3] - b[1])
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)
  const gaps = gap * Math.max(0, boxes.length - 1)
  const row = Math.min((area.w - gaps) / Math.max(1, sum(ws)), area.h / Math.max(1, ...hs))
  const col = Math.min(area.w / Math.max(1, ...ws), (area.h - gaps) / Math.max(1, sum(hs)))
  const across = row >= col
  const k = Math.max(0.01, across ? row : col)
  const total = across ? sum(ws) * k + gaps : sum(hs) * k + gaps
  let at = across ? area.x + (area.w - total) / 2 : area.y + (area.h - total) / 2
  return boxes.map((b, i) => {
    const bw = ws[i] * k
    const bh = hs[i] * k
    const x = across ? at : area.x + (area.w - bw) / 2
    const y = across ? area.y + (area.h - bh) / 2 : at
    at += (across ? bw : bh) + gap
    return { k, ox: x - b[0] * k, oy: y - b[1] * k }
  })
}

// fadeOf is 1 while a round is going and drops to 0 just after its end,
// so the rounds that are still going stand out.
function fadeOf(tr: SituationTrack, t: number): number {
  const end = tr.end
  if (!(end >= 0) || t <= end) return 1
  return Math.max(0, 1 - (t - end) / ENDED_FADE)
}

// lengthOf is how long the longest of the rounds lasted, in whole seconds.
export function lengthOf(list: readonly SituationTrack[], max: number): number {
  let longest = 0
  for (const tr of list) longest = Math.max(longest, tr.end >= 0 ? tr.end : max)
  return Math.max(1, Math.min(max, Math.ceil(longest - 1e-6)))
}

// placeAt is the callout a player is at, at t seconds, '' when the demo
// has none.
export function placeAt(tr: SituationTrack, p: TrackPlayer, step: number, t: number): string {
  if (!p.place || !tr.places) return ''
  const i = Math.max(0, Math.min(p.place.length - 1, Math.round(t / step)))
  return tr.places[p.place[i]] ?? ''
}

// gunAt is the gun a player carries at t seconds, 0 for none.
export function gunAt(p: TrackPlayer, step: number, t: number): number {
  if (!p.gun) return 0
  return p.gun[Math.max(0, Math.min(p.gun.length - 1, Math.round(t / step)))]
}

// rgba turns '#rrggbb' into a colour with alpha.
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  if (hex.length < 7 || Number.isNaN(n)) return `rgba(236,239,243,${a})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// sampleAt reads a player's position at t seconds, between two samples.
// out gets x, y, z, 1 when alive, and the yaw.
export function sampleAt(p: TrackPlayer, step: number, t: number, out: Float64Array) {
  const n = p.xs.length
  const s = Math.max(0, t / step)
  const i = Math.min(n - 1, Math.floor(s))
  const j = Math.min(n - 1, i + 1)
  const f = Math.min(1, s - i)
  if (p.alive[i] && p.alive[j] && f > 0) {
    out[0] = p.xs[i] + (p.xs[j] - p.xs[i]) * f
    out[1] = p.ys[i] + (p.ys[j] - p.ys[i]) * f
    out[2] = p.zs[i] + (p.zs[j] - p.zs[i]) * f
    out[4] = p.yaw ? lerpAngle(p.yaw[i], p.yaw[j], f) : 0
  } else {
    out[0] = p.xs[i]
    out[1] = p.ys[i]
    out[2] = p.zs[i]
    out[4] = p.yaw ? p.yaw[i] : 0
  }
  out[3] = p.alive[i]
}

interface Ev {
  e: TrackEvent
  level: number
  color: string
  // steamId of the roster player it belongs to, '' for others.
  id: string
}

interface PPlayer {
  p: TrackPlayer
  levels: Uint8Array
  // Seconds after freeze time when they died, Infinity when they lived.
  died: number
}

interface PTrack {
  // Its index in situation.tracks, the round's number on screen is one
  // more.
  index: number
  track: SituationTrack
  players: PPlayer[]
  areas: Ev[]
  pops: Ev[]
  kills: Ev[]
  deaths: Ev[]
  plants: Ev[]
}

interface Panel {
  level: number
  v: View
  // The floor's area on screen, for its label.
  box: Rect
  // What the map is for in a grid: one player, everyone, or one round
  // (an index into situation.tracks).
  player?: Legend
  all?: boolean
  round?: number
}

interface Layout {
  w: number
  h: number
  u: number
  wide: boolean
  // A map per player or per round, '' for the normal layout.
  grid: '' | 'players' | 'rounds'
  panels: Panel[]
  map: Rect
  // The clock, the time bar and where the dynamic parts go.
  clock: { x: number; y: number; size: number }
  bar: { x: number; y: number; w: number }
}

interface FeedLine {
  t: number
  color: string
  // Plain lines, like the plant.
  text?: string
  // Killfeed lines: a [icon] b, with which of them is ours.
  a?: string
  b?: string
  ours?: 'a' | 'b'
  icon?: string | null
  headshot?: boolean
  place?: string
  // Utility is drawn quieter.
  dim?: boolean
}

// feedText writes a line of the list as one sentence, for the footer of
// the square frame.
function feedText(l: FeedLine): string {
  if (l.text) return l.text
  const at = l.place ? ` at ${l.place}` : ''
  if (l.dim) return `${l.a}: ${l.icon === 'weapon/smokegrenade' ? 'smoke' : 'molotov'}${at}`
  if (l.ours === 'a') return `${l.a} killed ${l.b}${at}`
  return l.a ? `${l.b} killed by ${l.a}${at}` : `${l.b} died${at}`
}

// Cell is what one map of a grid is for.
type Cell = Pick<Panel, 'player' | 'all' | 'round'>

interface Legend {
  id: string
  name: string
  color: string
  role: string
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function easeOut(x: number): number {
  const k = Math.min(1, Math.max(0, x))
  return 1 - (1 - k) * (1 - k) * (1 - k)
}

function levelName(info: MapInfo, level: number): string {
  const n = info.levels[level]?.name ?? ''
  const name = !n || n === 'default' ? 'upper' : n
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} floor`
}

// glowSprite is a soft round light, tinted, drawn scaled for pops.
function glowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const S = 128
  const c = canvasOf(S, S)
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.42)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  return c
}

// fireSprite is a warm, uneven glow with a hotter core, built once.
function fireSprite(): HTMLCanvasElement {
  const S = 256
  const C = S / 2
  const c = canvasOf(S, S)
  const ctx = c.getContext('2d')!
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const blob = (x: number, y: number, r: number, a: number, hot: boolean) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, hot ? `rgba(255,214,150,${a})` : `rgba(255,138,61,${a})`)
    g.addColorStop(0.55, `rgba(240,98,44,${a * 0.5})`)
    g.addColorStop(1, 'rgba(220,70,30,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  blob(C, C, 108, 0.5, false)
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + rand() * 0.5
    const d = 40 + rand() * 26
    blob(C + Math.cos(ang) * d, C + Math.sin(ang) * d, 44 + rand() * 18, 0.22 + rand() * 0.16, false)
  }
  blob(C, C, 58, 0.42, true)
  return c
}

// Overlay draws one situation. Make it with Overlay.create, then call
// draw for every frame.
export class Overlay {
  // Seconds from freeze time to the end of the longest round.
  readonly duration: number
  readonly step: number
  // The length of the rounds on screen, for the time bar.
  private span = 0
  // Many rounds on screen this frame: draw less.
  private busy = false
  // Drawing a round sheet, where the routes are the main thing.
  private sheet = false
  // While drawing: the round being drawn, and on player maps whether it
  // goes on the player's own map or on the one with everyone.
  private cur: PTrack | null = null
  private pass: 'own' | 'all' = 'own'
  // Called when something that was loading is in, so a paused view can
  // redraw.
  onchange: (() => void) | null = null
  private tracks: PTrack[]
  private legend: Legend[]
  private smoke: HTMLCanvasElement
  private fire: HTMLCanvasElement
  private flame: HTMLCanvasElement
  private white: HTMLCanvasElement
  private orange: HTMLCanvasElement
  private logos = new Map<number, HTMLImageElement | null>()
  private bg: { key: string; canvas: HTMLCanvasElement; layout: Layout } | null = null
  // What the last frame was asked for, so a frame like the one before
  // skips the checks.
  private last = { w: 0, h: 0, rounds: null as OverlayOptions['rounds'], floors: undefined as FloorMode | undefined, hi: undefined as string | null | undefined, length: undefined as number | undefined, layout: undefined as OverlayLayout | undefined, story: undefined as Story | undefined, sheet: undefined as boolean | undefined, vis: [] as PTrack[] }
  private pt = new Float64Array(5)
  private trailX = new Float64Array(0)
  private trailY = new Float64Array(0)
  private trailL = new Int8Array(0)
  private trailA = new Float64Array(0)
  private heights: number[]

  private constructor(
    readonly scout: MapScout,
    readonly situation: Situation,
    readonly stage: Stage,
    readonly teamName: string,
    private labels: MapLabels,
  ) {
    const so = scoutOptions(scout)
    this.step = so.trackStep || 0.125
    this.duration = lengthOf(situation.tracks, so.trackSeconds || 30)
    this.span = this.duration
    const info = scout.info
    this.heights = situation.heat20.levels.map((l) => {
      let s = 0
      for (let i = 0; i < l.length; i++) s += l[i]
      return s
    })
    this.tracks = situation.tracks.map((tr, i) => prepTrack(tr, i, info, this.step))
    this.legend = legendOf(scout.roles, situation)
    this.smoke = smokeSprite()
    this.fire = fireSprite()
    this.flame = flameSprite()
    this.white = glowSprite(255, 255, 255)
    this.orange = glowSprite(255, 150, 80)
  }

  static async create(scout: MapScout, situation: Situation, opts: { teamName?: string } = {}): Promise<Overlay> {
    const labels = scoutLabels(scout) ?? { callouts: [], sites: [] }
    // The weapons of the kills, for the list of what happens.
    const guns = new Set<string>()
    for (const tr of situation.tracks) {
      for (const e of tr.events) {
        const icon = e.weapon !== undefined ? weaponIcon(e.weapon) : null
        if (icon) guns.add(icon)
      }
      // And the guns they carry, shown next to their names.
      for (const p of tr.players) {
        if (!p.gun) continue
        for (const id of new Set(p.gun)) {
          const icon = id ? weaponIcon(id) : null
          if (icon) guns.add(icon)
        }
      }
    }
    const [stage] = await Promise.all([stageFor(scout.info, labels, [situation.heat20, scout.team.ct, scout.team.t]), assetsAt(60, ['hud/dead', 'weapon/c4', 'weapon/smokegrenade', 'weapon/molotov', 'weapon/incgrenade', 'kill/headshot', ...guns])])
    return new Overlay(scout, situation, stage, opts.teamName?.trim() ?? '', labels)
  }

  // durationOf is the length of a video of these rounds, all when null.
  durationOf(rounds: readonly number[] | null | undefined): number {
    if (!rounds) return this.duration
    return lengthOf(rounds.flatMap((i) => (this.tracks[i] ? [this.tracks[i].track] : [])), this.duration)
  }

  // floorCount is how many floors the map has.
  get floorCount(): number {
    return this.scout.info.levels.length
  }

  floorName(level: number): string {
    return levelName(this.scout.info, level)
  }

  // prepare loads the logo at the size a w x h frame needs, so the first
  // frame of a video is already complete.
  async prepare(w: number, h: number): Promise<void> {
    const lh = this.logoHeight(w, h)
    if (!this.logos.get(lh)) this.logos.set(lh, await logoAt(lh))
  }

  private logoHeight(w: number, h: number): number {
    const wide = w / h >= 1.25
    const u = wide ? Math.min(w / WIDE_W, h / WIDE_H) : Math.min(w, h) / SQUARE
    return Math.max(8, Math.round((wide ? 58 : 72) * u))
  }

  private logo(w: number, h: number): HTMLImageElement | null {
    const lh = this.logoHeight(w, h)
    if (!this.logos.has(lh)) {
      this.logos.set(lh, null)
      logoAt(lh).then((img) => {
        this.logos.set(lh, img)
        this.bg = null
        this.onchange?.()
      })
    }
    const img = this.logos.get(lh)
    if (img) return img
    for (const v of this.logos.values()) if (v) return v
    return null
  }

  // visible lists the tracks to draw.
  private visible(opts: OverlayOptions): PTrack[] {
    let out: PTrack[] = this.tracks
    if (opts.rounds) {
      out = []
      for (const i of opts.rounds) if (this.tracks[i]) out.push(this.tracks[i])
    }
    return opts.layout === 'rounds' ? out.slice(0, MAX_ROUND_MAPS) : out
  }

  // draw paints the overlay at t seconds after freeze time onto the canvas
  // at its full pixel size.
  draw(target: HTMLCanvasElement | OffscreenCanvas, t: number, opts: OverlayOptions = {}) {
    const w = target.width
    const h = target.height
    if (w < 2 || h < 2) return
    const ctx = target.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return
    const last = this.last
    const same = !!this.bg && last.w === w && last.h === h && last.rounds === opts.rounds && last.floors === opts.floors && last.hi === opts.highlight && last.length === opts.length && last.layout === opts.layout && last.story === opts.story && last.sheet === opts.sheet
    const vis = same ? last.vis : this.visible(opts)
    if (!same) this.span = lengthOf(vis.map((v) => v.track), opts.length && opts.length > 0 ? Math.min(opts.length, this.duration) : this.duration)
    const bg = same ? this.bg! : this.background(w, h, opts, vis)
    last.w = w
    last.h = h
    last.rounds = opts.rounds
    last.floors = opts.floors
    last.hi = opts.highlight
    last.length = opts.length
    last.layout = opts.layout
    last.story = opts.story
    last.sheet = opts.sheet
    last.vis = vis
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(bg.canvas, 0, 0)
    const L = bg.layout
    const time = Math.max(0, Math.min(this.span, t))
    const hi = opts.highlight ?? null
    // Rounds that are over fade out and then leave the map, on a sheet
    // they stay as they ended.
    const on = opts.sheet ? vis : vis.filter((tr) => fadeOf(tr.track, time) > 0)
    // A map per round has one round on each map, so nothing is left out.
    this.busy = vis.length >= BUSY && L.grid !== 'rounds'
    this.sheet = !!opts.sheet
    // Clip to the map area so nothing runs into the side column.
    ctx.save()
    ctx.beginPath()
    ctx.rect(L.map.x, L.map.y, L.map.w, L.map.h)
    ctx.clip()
    // Player maps draw everything twice: on the player's own map and on
    // the map with everyone.
    const passes: ('own' | 'all')[] = L.grid === 'players' && L.panels.some((q) => q.all) ? ['own', 'all'] : ['own']
    for (const pass of passes) {
      this.pass = pass
      this.drawRounds(ctx, L, vis, on, time, hi, opts)
    }
    this.pass = 'own'
    this.cur = null
    if (vis.length === 1 && on.length && !L.grid) this.drawNames(ctx, L, vis[0], time, hi)
    ctx.restore()
    if (!vis.length) this.drawEmpty(ctx, L)
    if (!opts.sheet) this.drawClock(ctx, L, time)
    if (opts.story && vis.length === 1) this.drawFeed(ctx, L, vis[0], time)
    if (opts.story && opts.intro && opts.intro > 0 && vis.length === 1) this.drawIntro(ctx, L, vis[0], opts.story, opts.intro)
    if (opts.cover && opts.cover > 0) this.drawCover(ctx, L, opts.cover)
  }

  // drawCover is the summary at the start of a round by round video: how
  // the rounds went and the strongest patterns in them.
  private drawCover(ctx: CanvasRenderingContext2D, L: Layout, a: number) {
    const { u } = L
    const m = L.map
    const s = this.situation
    ctx.globalAlpha = a
    ctx.fillStyle = 'rgba(11,13,17,0.86)'
    ctx.fillRect(m.x - 24 * u, m.y - 24 * u, m.w + 48 * u, m.h + 48 * u)
    const w = Math.min(m.w - 80 * u, 900 * u)
    const x = m.x + (m.w - w) / 2
    const notes = s.notes.slice(0, 3)
    font(ctx, 500, 22, u, 0, FONT)
    const lines = notes.map((n) => wrap(ctx, n, w - 28 * u, 3))
    const textH = lines.reduce((h, l) => h + l.length * 32 * u + 14 * u, 0)
    let y = m.y + Math.max(40 * u, (m.h - (150 * u + textH)) / 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 600, 18, u, 0.16)
    ctx.fillStyle = TEXT_3
    ctx.fillText('IN THIS VIDEO', x, y)
    y += 58 * u
    font(ctx, 700, 52, u, -0.005)
    ctx.fillStyle = TEXT
    ctx.fillText(fitText(ctx, s.title, w), x, y)
    y += 44 * u
    font(ctx, 600, 24, u, 0.01)
    const matches = new Set(s.tracks.map((t) => t.replayId)).size
    const head = `${plural(s.tracks.length, 'round')}   ·   ${plural(matches, 'match')}   ·   `
    ctx.fillStyle = TEXT_2
    ctx.fillText(head, x, y)
    ctx.fillStyle = s.won * 2 >= s.rounds ? GOOD : BAD
    ctx.fillText(`won ${s.won} of ${s.rounds}`, x + ctx.measureText(head).width, y)
    y += 48 * u
    font(ctx, 500, 22, u, 0, FONT)
    for (const l of lines) {
      ctx.fillStyle = ACCENT
      circle(ctx, x + 6 * u, y - 8 * u, 4 * u)
      ctx.fill()
      ctx.fillStyle = TEXT
      for (const ln of l) {
        ctx.fillText(ln, x + 28 * u, y)
        y += 32 * u
      }
      y += 14 * u
    }
    ctx.globalAlpha = 1
    setSpacing(ctx, '0px')
  }

  // ---- Round by round ----

  private feeds = new Map<PTrack, FeedLine[]>()

  // feedOf lists what happens in a round, for the side column: kills,
  // deaths, smokes and molotovs, the site hit and the plant, with where
  // they happened.
  private feedOf(tr: PTrack): FeedLine[] {
    let out = this.feeds.get(tr)
    if (out) return out
    out = []
    // The demo's own callout when it has one, else the nearest label.
    const placeOf = (e: TrackEvent) => e.place || nearestPlace(this.labels, e.x, e.y, levelOf(this.scout.info, e.z))
    const at = (e: TrackEvent) => {
      const place = placeOf(e)
      return place ? ` at ${place}` : ''
    }
    const ours = this.situation.side === 'ct' ? 3 : 2
    const theirs = ours === 3 ? 2 : 3
    // Kills read like the game's killfeed: killer, weapon, victim.
    for (const ev of tr.kills) {
      const e = ev.e
      out.push({ t: e.t, color: ev.color, a: e.player, b: e.other ?? 'enemy', ours: 'a', icon: e.weapon !== undefined ? weaponIcon(e.weapon, ours) : null, headshot: e.headshot, place: placeOf(e) })
    }
    for (const ev of tr.deaths) {
      if (!ev.id) continue
      const e = ev.e
      out.push({ t: e.t, color: ev.color, a: e.other ?? '', b: e.player, ours: 'b', icon: e.weapon !== undefined ? weaponIcon(e.weapon, theirs) : null, headshot: e.headshot, place: placeOf(e) })
    }
    // Smokes and molotovs shape a round, flashes are too many to list.
    for (const ev of tr.areas) {
      const e = ev.e
      if (!ev.id) continue
      out.push({ t: e.t, color: ev.color, a: e.player, ours: 'a', icon: e.kind === 'smoke' ? 'weapon/smokegrenade' : 'weapon/molotov', place: placeOf(e), dim: true })
    }
    for (const ev of tr.plants) out.push({ t: ev.e.t, color: ACCENT, text: ev.e.place ? `Bomb planted on ${ev.e.place}` : `Bomb planted${at(ev.e)}` })
    const t = tr.track
    if (t.hit && t.hitTime >= 0) out.push({ t: t.hitTime, color: TEXT_3, text: this.situation.side === 't' ? `They hit ${t.hit}` : `T side hits ${t.hit}` })
    out.sort((a, b) => a.t - b.t)
    this.feeds.set(tr, out)
    return out
  }

  // drawFeed lists what happened so far in the round, newest at the bottom.
  private drawFeed(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, t: number) {
    const { u, h } = L
    const lines = this.feedOf(tr).filter((l) => l.t <= t)
    if (!L.wide) {
      // The square frame has room for the latest line only, in the footer.
      const last = lines[lines.length - 1]
      if (!last) return
      font(ctx, 500, 19, u, 0, FONT)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = TEXT_3
      ctx.fillText(clockText(last.t), 72 * u, h - 56 * u)
      ctx.fillStyle = TEXT
      ctx.fillText(fitText(ctx, feedText(last), L.w - 220 * u), 132 * u, h - 56 * u)
      return
    }
    const x0 = 64 * u
    const colW = 470 * u
    const top = 760 * u
    const rowH = 34 * u
    const room = Math.max(1, Math.floor((h - 40 * u - top) / rowH))
    const shown = lines.slice(-room)
    if (!lines.length) {
      font(ctx, 500, 18, u, 0, FONT)
      ctx.fillStyle = TEXT_3
      ctx.textAlign = 'left'
      ctx.fillText('Nothing yet', x0, top + 20 * u)
      return
    }
    shown.forEach((l, i) => {
      const y = top + i * rowH + 20 * u
      ctx.globalAlpha = Math.min(1, (t - l.t) / 0.35 + 0.15)
      font(ctx, 600, 17, u, 0.02)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = TEXT_3
      ctx.fillText(clockText(l.t), x0, y)
      ctx.fillStyle = l.color
      circle(ctx, x0 + 64 * u, y - 6 * u, 5.5 * u)
      ctx.fill()
      const right = x0 + colW
      let x = x0 + 80 * u
      font(ctx, l.dim ? 500 : 600, l.dim ? 17 : 19, u, 0, l.dim ? FONT : undefined)
      if (l.text) {
        ctx.fillStyle = TEXT
        ctx.fillText(fitText(ctx, l.text, right - x), x, y)
      } else {
        // Ours in white, theirs in grey.
        const name = (s: string | undefined, mine: boolean) => {
          if (!s) return
          ctx.fillStyle = l.dim ? TEXT_2 : mine ? TEXT : TEXT_2
          const txt = fitText(ctx, s, 150 * u)
          ctx.fillText(txt, x, y)
          x += ctx.measureText(txt).width + 8 * u
        }
        name(l.a, l.ours === 'a')
        const ih = 15 * u
        const bm = l.icon ? iconBitmap(l.icon, null, ih) : null
        if (bm) {
          const iw = (bm.width / bm.height) * ih
          drawIcon(ctx, l.icon!, x + iw / 2, y - 6 * u, ih, l.dim ? TEXT_3 : TEXT_2)
          x += iw + 6 * u
        }
        if (l.headshot) {
          drawIcon(ctx, 'kill/headshot', x + 7 * u, y - 6 * u, 14 * u, TEXT_2)
          x += 20 * u
        }
        name(l.b, l.ours === 'b')
      }
      if (l.place && x < right - 30 * u) {
        font(ctx, 500, 16, u, 0, FONT)
        ctx.fillStyle = TEXT_3
        ctx.fillText(fitText(ctx, l.place, right - x), x, y)
      }
    })
    ctx.globalAlpha = 1
    setSpacing(ctx, '0px')
  }

  // drawIntro is the round's title card over the map.
  private drawIntro(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, story: Story, a: number) {
    const { u } = L
    const m = L.map
    const t = tr.track
    ctx.globalAlpha = a
    ctx.fillStyle = 'rgba(11,13,17,0.78)'
    ctx.fillRect(m.x - 24 * u, m.y - 24 * u, m.w + 48 * u, m.h + 48 * u)
    const cx = m.x + m.w / 2
    const cy = m.y + m.h / 2
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 600, 22, u, 0.16)
    ctx.fillStyle = TEXT_3
    ctx.fillText(`ROUND ${story.n} OF ${story.of}`, cx, cy - 54 * u)
    font(ctx, 700, 64, u, -0.005)
    ctx.fillStyle = TEXT
    ctx.fillText(t.label, cx, cy + 14 * u)
    font(ctx, 600, 26, u, 0.01)
    const res = t.won ? 'Won' : 'Lost'
    const hit = t.hit && t.hitTime >= 0 ? `   ·   ${this.situation.side === 't' ? 'They hit' : 'T side hits'} ${t.hit} at ${clockText(t.hitTime)}` : ''
    const rw = ctx.measureText(res).width
    const hw = ctx.measureText(hit).width
    const x = cx - (rw + hw) / 2
    ctx.textAlign = 'left'
    ctx.fillStyle = t.won ? GOOD : BAD
    ctx.fillText(res, x, cy + 62 * u)
    ctx.fillStyle = TEXT_2
    ctx.fillText(hit, x + rw, cy + 62 * u)
    ctx.globalAlpha = 1
    setSpacing(ctx, '0px')
  }

  private drawRounds(ctx: CanvasRenderingContext2D, L: Layout, vis: PTrack[], on: PTrack[], time: number, hi: string | null, opts: OverlayOptions) {
    // On a sheet every round is shown at its own end.
    const at = (tr: PTrack) => (opts.sheet ? Math.min(time, tr.track.end) : time)
    const fade = (tr: PTrack) => (opts.sheet ? 1 : fadeOf(tr.track, time))
    for (const tr of on) {
      this.cur = tr
      this.drawAreas(ctx, L, tr, at(tr), hi)
    }
    for (const tr of on) {
      this.cur = tr
      this.drawPops(ctx, L, tr, at(tr), hi)
    }
    for (const tr of on) {
      this.cur = tr
      this.drawMarks(ctx, L, tr, at(tr), hi)
    }
    const trail = Math.min(this.busy ? BUSY_TRAIL : Infinity, Math.max(0, opts.trail ?? TRAIL))
    // View cones only when they stay readable: one round on a map, or the
    // highlighted player.
    const cones = vis.length === 1 || L.grid === 'rounds'
    // With several rounds on a map every dot carries its round's number.
    const numbered = vis.length > 1 && L.grid !== 'rounds'
    // With one round on a map their routes stay on it.
    const paths = vis.length === 1 || L.grid === 'rounds'
    for (const tr of on) {
      this.cur = tr
      const num = numbered ? tr.index + 1 : 0
      for (const pp of tr.players) if (!hi || pp.p.steamId !== hi) this.drawPlayer(ctx, L, pp, at(tr), trail, (hi ? FADED : 1) * fade(tr), false, cones && !hi, num, paths)
    }
    if (hi) {
      for (const tr of on) {
        this.cur = tr
        const num = numbered ? tr.index + 1 : 0
        for (const pp of tr.players) if (pp.p.steamId === hi) this.drawPlayer(ctx, L, pp, at(tr), trail, fade(tr), true, true, num, paths)
      }
    }
  }

  // ---- Static layer ----

  private background(w: number, h: number, opts: OverlayOptions, vis: PTrack[]): { canvas: HTMLCanvasElement; layout: Layout } {
    const floors = floorsFor(this.heights, opts.floors ?? 'auto')
    const grid = opts.layout === 'players' && this.legend.length > 1 ? 'players' : opts.layout === 'rounds' && vis.length > 1 ? 'rounds' : ''
    const key = [w, h, floors.join(','), opts.highlight ?? '', this.span, grid, opts.story ? `${opts.story.n}/${opts.story.of}` : '', opts.sheet ? 'sheet' : '', vis.map((v) => v.index).join(',')].join('|')
    if (this.bg && this.bg.key === key) return this.bg
    const cells: Cell[] =
      grid === 'players' ? [...this.legend.map((player) => ({ player })), { all: true }] : grid === 'rounds' ? vis.map((v) => ({ round: v.index })) : []
    const layout = grid ? this.gridLayout(w, h, floors[0], grid, cells) : this.layoutFor(w, h, floors)
    const canvas = this.bg && this.bg.canvas.width === w && this.bg.canvas.height === h ? this.bg.canvas : canvasOf(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this.paintStatic(ctx, layout, opts, vis)
    this.bg = { key, canvas, layout }
    return this.bg
  }

  private layoutFor(w: number, h: number, floors: number[]): Layout {
    const { u, wide, map } = this.frame(w, h)
    const pad = 12
    const boxes: Box[] = floors.map((l) => {
      if (floors.length === 1) return this.stage.box
      const f = this.stage.floors[l]
      if (!f) return this.stage.box
      return [f.box[0] - pad, f.box[1] - pad, f.box[2] + pad, f.box[3] + pad]
    })
    const views = arrange(boxes, map, (floors.length > 1 ? 56 : 0) * u)
    const panels = floors.map((level, i) => {
      const v = views[i]
      const b = boxes[i]
      return { level, v, box: { x: v.ox + b[0] * v.k, y: v.oy + b[1] * v.k, w: (b[2] - b[0]) * v.k, h: (b[3] - b[1]) * v.k } }
    })
    return { w, h, u, wide, grid: '', panels, map, ...this.clockAt(h, u, wide) }
  }

  private frame(w: number, h: number): { u: number; wide: boolean; map: Rect } {
    const wide = w / h >= 1.25
    const u = wide ? Math.min(w / WIDE_W, h / WIDE_H) : Math.min(w, h) / SQUARE
    const map: Rect = wide
      ? { x: 600 * u, y: 150 * u, w: w - 600 * u - 48 * u, h: h - 150 * u - 36 * u }
      : { x: 48 * u, y: 272 * u, w: w - 96 * u, h: h - 272 * u - 262 * u }
    return { u, wide, map }
  }

  private clockAt(h: number, u: number, wide: boolean): Pick<Layout, 'clock' | 'bar'> {
    const clock = wide ? { x: 64 * u, y: 352 * u, size: 116 * u } : { x: 72 * u, y: h - 150 * u, size: 64 * u }
    const bar = wide ? { x: 64 * u, y: 398 * u, w: 470 * u } : { x: 232 * u, y: h - 172 * u, w: 230 * u }
    return { clock, bar }
  }

  // gridLayout gives every player or every round its own map of one
  // floor, in a grid with the most room for each.
  private gridLayout(w: number, h: number, level: number, grid: 'players' | 'rounds', cells: Cell[]): Layout {
    const { u, wide, map } = this.frame(w, h)
    const pad = 12
    const f = this.stage.floors.length > 1 ? this.stage.floors[level] : null
    const b: Box = f ? [f.box[0] - pad, f.box[1] - pad, f.box[2] + pad, f.box[3] + pad] : this.stage.box
    const n = cells.length
    const gap = 18 * u
    const top = PANEL_LABEL * u
    const bw = b[2] - b[0]
    const bh = b[3] - b[1]
    let best = { cols: 1, k: 0 }
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols)
      const k = Math.min((map.w - gap * (cols - 1)) / (cols * bw), (map.h - gap * (rows - 1) - top * rows) / (rows * bh))
      if (k > best.k) best = { cols, k }
    }
    const { cols, k } = best
    const rows = Math.ceil(n / cols)
    const cw = bw * k
    const ch = bh * k + top
    const x0 = map.x + (map.w - (cols * cw + gap * (cols - 1))) / 2
    const y0 = map.y + (map.h - (rows * ch + gap * (rows - 1))) / 2
    const panels: Panel[] = cells.map((cell, i) => {
      const r = Math.floor(i / cols)
      // The last row is centred when it is not full.
      const inRow = r === rows - 1 ? n - r * cols : cols
      const c = i - r * cols
      const rx = x0 + ((cols - inRow) * (cw + gap)) / 2
      const x = rx + c * (cw + gap)
      const y = y0 + r * (ch + gap) + top
      const v: View = { k, ox: x - b[0] * k, oy: y - b[1] * k }
      return { level, v, box: { x, y, w: cw, h: bh * k }, ...cell }
    })
    return { w, h, u, wide, grid, panels, map, ...this.clockAt(h, u, wide) }
  }

  private paintStatic(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, vis: PTrack[]) {
    const { w, h, u } = L
    const st = this.stage
    const info = this.scout.info
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    // A soft light behind the map lifts it off the page.
    const mx = L.map.x + L.map.w / 2
    const my = L.map.y + L.map.h / 2
    const glow = ctx.createRadialGradient(mx, my, Math.min(L.map.w, L.map.h) * 0.05, mx, my, Math.max(L.map.w, L.map.h) * 0.62)
    glow.addColorStop(0, 'rgba(36,42,52,0.42)')
    glow.addColorStop(1, 'rgba(11,13,17,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    const first = L.panels[0]
    if (!L.grid) gridLines(ctx, info, first.v, { x: L.map.x - 24 * u, y: L.map.y - 24 * u, w: L.map.w + 48 * u, h: L.map.h + 48 * u }, u, L.wide ? 'xy' : 'y')
    // Side by side floors. Player maps each show the whole radar.
    const split = L.panels.length > 1 && !L.grid
    const lu = u * (L.wide ? 0.92 : 1)
    for (const p of L.panels) {
      const floor = st.floors[p.level] ?? st.floors[0] ?? null
      if (floor && split) {
        // Radars show the other floor faintly. Side by side only the floor
        // itself is kept, with its shadow drawn again.
        const sc = this.scratch(w, h)
        drawFloor(sc, floor, p.v, u)
        sc.globalCompositeOperation = 'destination-in'
        sc.setTransform(p.v.k, 0, 0, p.v.k, p.v.ox, p.v.oy)
        sc.fill(floor.outline, 'evenodd')
        // The mask cuts the outline in half, draw it again on top.
        sc.globalCompositeOperation = 'source-over'
        sc.strokeStyle = 'rgba(196,210,228,0.62)'
        sc.lineWidth = (1.4 * u) / p.v.k
        sc.lineJoin = 'round'
        sc.stroke(floor.outline)
        sc.setTransform(1, 0, 0, 1, 0, 0)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = 26 * u
        ctx.shadowOffsetY = 9 * u
        ctx.drawImage(sc.canvas, 0, 0)
        ctx.restore()
      } else if (floor) drawFloor(ctx, floor, p.v, u)
      drawLabels(ctx, st, p.level, p.v, L.grid ? lu * Math.min(1, Math.max(0.7, p.v.k * 1.4)) : lu, [], [], !!L.grid || vis.length > 3)
      if (p.round !== undefined) this.roundTitle(ctx, p, u)
      else if (p.all) {
        font(ctx, 700, 19, u, 0.01)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = TEXT_2
        ctx.fillText('All players', p.box.x, p.box.y - 9 * u)
        setSpacing(ctx, '0px')
      }
      if (p.player) {
        // The player's name over their map, in their colour.
        const x = p.box.x
        const y = p.box.y - 9 * u
        ctx.fillStyle = p.player.color
        circle(ctx, x + 6 * u, y - 6 * u, 5 * u)
        ctx.fill()
        font(ctx, 700, 19, u, 0.01)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = TEXT
        const name = fitText(ctx, p.player.name, p.box.w * 0.6)
        ctx.fillText(name, x + 18 * u, y)
        if (p.player.role) {
          const nw = ctx.measureText(name).width
          font(ctx, 600, 15, u, 0.02)
          ctx.fillStyle = TEXT_3
          ctx.fillText(fitText(ctx, p.player.role, p.box.w - nw - 32 * u), x + 30 * u + nw, y)
        }
        setSpacing(ctx, '0px')
      } else if (split) {
        font(ctx, 600, 15, u, 0.14)
        ctx.fillStyle = TEXT_3
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(this.floorName(p.level).toUpperCase(), p.box.x + p.box.w / 2, Math.max(L.map.y + 14 * u, p.box.y - 6 * u))
        setSpacing(ctx, '0px')
      }
    }
    if (L.wide) this.paintWide(ctx, L, opts, vis)
    else this.paintSquare(ctx, L, opts, vis)
  }

  private kicker(): string {
    const map = mapLabel(this.scout.map)
    return this.teamName ? `${map} · ${this.teamName}` : map
  }

  private bits(vis: PTrack[], story?: Story): string[] {
    if (story && vis.length === 1) return [`Round ${story.n} of ${story.of}`, vis[0].track.label, vis[0].track.won ? 'won' : 'lost']
    const s = this.situation
    const n = s.tracks.length
    const shown = vis.length === n ? plural(n, 'round') : `${vis.length} of ${plural(n, 'round')}`
    const matches = new Set(s.tracks.map((t) => t.replayId)).size
    return [shown, plural(matches, 'match')]
  }

  private head(ctx: CanvasRenderingContext2D, L: Layout, vis: PTrack[], y: { kicker: number; title: number; sub: number; size: number }, maxW: number, titleW: number, story?: Story) {
    const { u } = L
    const x0 = (L.wide ? 64 : 72) * u
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 600, 17, u, 0.16)
    const [head, ...rest] = this.kicker().toUpperCase().split(' · ')
    ctx.fillStyle = TEXT_3
    ctx.fillText(rest.length ? `${head}  ·` : head, x0, y.kicker)
    if (rest.length) {
      const sep = `${head}  ·  `
      const sw = ctx.measureText(sep).width
      ctx.fillStyle = TEXT_2
      ctx.fillText(fitText(ctx, rest.join(' · '), maxW - sw), x0 + sw, y.kicker)
    }
    font(ctx, 700, y.size, u, -0.005)
    ctx.fillStyle = TEXT
    ctx.fillText(fitText(ctx, this.situation.title, titleW), x0 - 3 * u, y.title)
    const side = this.situation.side === 'ct' ? 3 : 2
    let x = x0 + sideChip(ctx, side, x0, y.sub, u) + 18 * u
    font(ctx, 600, 22, u, 0.01)
    ctx.fillStyle = TEXT_2
    ctx.textBaseline = 'middle'
    ctx.fillText(fitText(ctx, this.bits(vis, story).join('   ·   '), x0 + maxW - x), x, y.sub + 1 * u)
    ctx.textBaseline = 'alphabetic'
    setSpacing(ctx, '0px')
  }

  private paintWide(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, vis: PTrack[]) {
    const { w, h, u } = L
    const x0 = 64 * u
    const colW = 470 * u
    const logoW = this.logoHeight(w, h) * 3.27
    this.head(ctx, L, vis, { kicker: 74 * u, title: 136 * u, sub: 186 * u, size: 64 }, colW + 40 * u, w - 128 * u - logoW - 40 * u, opts.story)
    logoMark(ctx, this.logo(w, h), w - 64 * u, 136 * u, this.logoHeight(w, h))

    // Clock and time bar, or on a sheet what it shows.
    if (opts.sheet) {
      label(ctx, 'Round sheet', x0, 252 * u, u)
      font(ctx, 500, 21, u, 0, FONT)
      ctx.fillStyle = TEXT_2
      ctx.textAlign = 'left'
      const lines = wrap(ctx, 'Every round from freeze time to its end: the routes they walked, crosses where they died and skulls where they got kills.', colW, 4)
      lines.forEach((ln, i) => ctx.fillText(ln, x0, 292 * u + i * 29 * u))
    } else {
      label(ctx, 'Time after freeze', x0, 252 * u, u)
      this.paintBar(ctx, L, vis)
    }

    // Players.
    let y = 470 * u
    label(ctx, 'Players', x0, y, u)
    const rowH = Math.min(38, 220 / Math.max(1, this.legend.length)) * u
    y += 18 * u
    const side = this.situation.side
    for (const p of this.legend) {
      const on = !opts.highlight || opts.highlight === p.id
      const me = opts.highlight === p.id
      if (me) {
        ctx.fillStyle = SURFACE_2
        roundRect(ctx, x0 - 10 * u, y, colW + 20 * u, rowH, 4 * u)
        ctx.fill()
      }
      const cy = y + rowH / 2
      ctx.globalAlpha = on ? 1 : 0.4
      ctx.fillStyle = EDGE
      circle(ctx, x0 + 8 * u, cy, 9 * u)
      ctx.fill()
      ctx.fillStyle = p.color
      circle(ctx, x0 + 8 * u, cy, 6.5 * u)
      ctx.fill()
      font(ctx, 500, 17, u, 0, FONT)
      const roleW = p.role ? ctx.measureText(p.role).width + 16 * u : 0
      font(ctx, me ? 700 : 600, 22, u)
      ctx.fillStyle = TEXT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(fitText(ctx, p.name, colW - 28 * u - roleW), x0 + 28 * u, cy + 1 * u)
      if (p.role) {
        font(ctx, 500, 17, u, 0, FONT)
        ctx.fillStyle = TEXT_2
        ctx.textAlign = 'right'
        ctx.fillText(p.role, x0 + colW, cy + 1 * u)
      }
      ctx.globalAlpha = 1
      y += rowH
    }
    ctx.textBaseline = 'alphabetic'
    if (this.legend.length && side) {
      font(ctx, 500, 14, u, 0, FONT)
      ctx.fillStyle = TEXT_3
      ctx.textAlign = 'right'
      ctx.fillText(`Role on ${side.toUpperCase()}, from all their rounds`, x0 + colW, 470 * u)
    }

    // Round by round, the rest of the column lists what happens.
    if (opts.story) {
      label(ctx, 'What happens', x0, Math.max(y + 46 * u, 726 * u), u)
      return
    }

    // The numbers behind the situation.
    y = Math.max(y + 46 * u, 726 * u)
    label(ctx, 'In these rounds', x0, y, u)
    statRow(ctx, this.stats(), x0, y + 48 * u, colW, u)

    // The strongest pattern in plain words.
    y += 104 * u
    const note = this.situation.notes[0]
    if (note) {
      font(ctx, 500, 20, u, 0, FONT)
      ctx.fillStyle = TEXT_2
      ctx.textAlign = 'left'
      const lines = wrap(ctx, note, colW, 3)
      lines.forEach((ln, i) => ctx.fillText(ln, x0, y + 8 * u + i * 27 * u))
      y += 8 * u + lines.length * 27 * u + 18 * u
    }

    // The rounds on screen.
    y = Math.max(y + 10 * u, 930 * u)
    if (y < h - 80 * u) {
      label(ctx, vis.length === this.tracks.length ? 'Rounds' : 'Rounds shown', x0, y, u)
      chips(ctx, vis, x0, y + 16 * u, colW, h - 40 * u, u)
    }
  }

  private paintSquare(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, vis: PTrack[]) {
    const { w, h, u } = L
    const logoW = this.logoHeight(w, h) * 3.27
    const room = w - 72 * u - logoW - 40 * u - 72 * u
    this.head(ctx, L, vis, { kicker: 96 * u, title: 172 * u, sub: 224 * u, size: 76 }, room, room, opts.story)
    logoMark(ctx, this.logo(w, h), w - 72 * u, 172 * u, this.logoHeight(w, h))
    if (opts.sheet) {
      label(ctx, 'Round sheet', 72 * u, h - 214 * u, u)
      font(ctx, 500, 17, u, 0, FONT)
      ctx.fillStyle = TEXT_2
      ctx.textAlign = 'left'
      wrap(ctx, 'Routes from freeze time to the end, crosses are deaths.', 400 * u, 3).forEach((ln, i) => ctx.fillText(ln, 72 * u, h - 176 * u + i * 24 * u))
    } else {
      label(ctx, 'Time after freeze', 72 * u, h - 214 * u, u)
      this.paintBar(ctx, L, vis)
    }
    // Numbers in the middle, players on the right.
    const right = w - 72 * u
    const legendW = this.paintLegendSquare(ctx, L, opts, right)
    const sx = 520 * u
    label(ctx, 'In these rounds', sx, h - 214 * u, u)
    statRow(ctx, this.stats(), sx, h - 164 * u, right - legendW - 60 * u - sx, u)
    // Footer: the strongest pattern, or the matches.
    ctx.fillStyle = LINE
    ctx.fillRect(72 * u, Math.round(h - 100 * u), w - 144 * u, Math.max(1, Math.round(u)))
    // Round by round the footer shows the latest thing that happened.
    if (opts.story) return
    const note = this.situation.notes[0] || roundsLine(vis.map((v) => v.track))
    font(ctx, 500, 19, u, 0, FONT)
    ctx.fillStyle = TEXT_2
    ctx.textAlign = 'left'
    ctx.fillText(fitText(ctx, note, w - 144 * u), 72 * u, h - 56 * u)
  }

  private paintLegendSquare(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, right: number): number {
    const { h, u } = L
    const rows = [h - 172 * u, h - 136 * u]
    font(ctx, 600, 17, u, 0.02)
    const items = this.legend.map((p) => ({ p, w: 26 * u + ctx.measureText(p.name).width }))
    const cols: (typeof items)[] = []
    for (let i = 0; i < items.length; i += 2) cols.push(items.slice(i, i + 2))
    let x = right
    for (let k = cols.length - 1; k >= 0; k--) {
      const col = cols[k]
      const cw = Math.min(220 * u, Math.max(...col.map((c) => c.w)))
      const left = x - cw
      col.forEach(({ p }, r) => {
        const y = rows[r]
        ctx.globalAlpha = !opts.highlight || opts.highlight === p.id ? 1 : 0.4
        ctx.fillStyle = EDGE
        circle(ctx, left + 8 * u, y, 9 * u)
        ctx.fill()
        ctx.fillStyle = p.color
        circle(ctx, left + 8 * u, y, 6.5 * u)
        ctx.fill()
        font(ctx, opts.highlight === p.id ? 700 : 600, 17, u, 0.02)
        ctx.fillStyle = TEXT
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(fitText(ctx, p.name, cw - 26 * u), left + 24 * u, y + 1 * u)
        ctx.globalAlpha = 1
      })
      x = left - 26 * u
    }
    ctx.textBaseline = 'alphabetic'
    setSpacing(ctx, '0px')
    label(ctx, 'Players', x + 26 * u, h - 214 * u, u)
    return right - x - 26 * u
  }

  // paintBar draws the time bar with ticks and the moments each round hit
  // its site.
  private paintBar(ctx: CanvasRenderingContext2D, L: Layout, vis: PTrack[]) {
    const { u } = L
    const { x, y, w } = L.bar
    const D = this.span
    ctx.fillStyle = SURFACE_2
    roundRect(ctx, x, y - 3 * u, w, 6 * u, 3 * u)
    ctx.fill()
    font(ctx, 600, L.wide ? 14 : 13, u, 0.08)
    ctx.fillStyle = TEXT_3
    ctx.textBaseline = 'alphabetic'
    // Long rounds read better as a clock: 0:30, 1:00.
    const every = D > 100 ? 30 : D > 40 ? 20 : 10
    for (let s = 0; s <= D + 1e-6; s += every) {
      const tx = x + (s / D) * w
      ctx.textAlign = s === 0 ? 'left' : s >= D - 1e-6 ? 'right' : 'center'
      ctx.fillText(D > 60 ? clockText(s) : `${s}s`, tx, y + 26 * u)
      ctx.fillStyle = LINE_2
      ctx.fillRect(Math.round(tx - 0.5 * u), y - 7 * u, Math.max(1, u), 14 * u)
      ctx.fillStyle = TEXT_3
    }
    // Site hits inside the window, as small site badges above the bar.
    // Hits on one site close together share a badge with a count.
    for (const m of hitMarks(vis.map((v) => v.track), D, 22 * u, w)) {
      const hx = x + (m.time / D) * w
      const hy = y - 22 * u
      ctx.fillStyle = 'rgba(11,13,17,0.94)'
      circle(ctx, hx, hy, 10 * u)
      ctx.fill()
      ctx.lineWidth = 1.5 * u
      ctx.strokeStyle = this.situation.side === 't' ? teamColor(2).base : teamColor(3).base
      ctx.stroke()
      if (!drawIcon(ctx, `hud/bombsite-${m.site.toLowerCase()}`, hx, hy, 17 * u, TEXT)) {
        font(ctx, 700, 13, u)
        ctx.fillStyle = TEXT
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(m.site, hx, hy + 0.5 * u)
        ctx.textBaseline = 'alphabetic'
      }
      if (m.n > 1) countBadge(ctx, hx + 9 * u, hy - 9 * u, m.n, u)
    }
    setSpacing(ctx, '0px')
  }

  private stats(): { value: string; label: string; tint?: string }[] {
    const s = this.situation
    const n = s.rounds
    const out: { value: string; label: string; tint?: string }[] = [{ value: `${s.won}/${n}`, label: 'Won' }]
    if (s.side === 't') {
      out.push({ value: `${s.rushes}/${n}`, label: `Rushed, under ${Math.round(scoutOptions(this.scout).rushSeconds)}s` })
      for (const hit of s.hits.slice(0, 2)) out.push({ value: `${hit.rounds}`, label: `Hit ${hit.site}, ${Math.round(hit.avgTime)}s avg` })
      if (s.noHit) out.push({ value: `${s.noHit}`, label: 'No hit' })
    } else {
      const top = s.stacks[0]
      out.push({ value: `${top ? top.rounds : 0}/${n}`, label: top ? `Stacked ${top.site}` : 'Stacked a site' })
      out.push({ value: `${s.pushes}/${n}`, label: 'Pushed early' })
    }
    if (s.saves) out.push({ value: `${s.saves}`, label: 'Saved' })
    return out
  }

  // ---- Dynamic layer ----

  // at maps a radar position on a floor to the panel it is drawn on and
  // its alpha there.
  // at is the map a thing on this floor goes on, with how strongly to
  // draw it. On player maps, things go on the map of the player id.
  private at(L: Layout, level: number, id = ''): { p: Panel; a: number } | null {
    if (L.grid) {
      const cur = this.cur
      const p =
        L.grid === 'rounds'
          ? L.panels.find((q) => q.round === cur?.index)
          : this.pass === 'all'
            ? L.panels.find((q) => q.all)
            : L.panels.find((q) => q.player?.id === id)
      return p ? { p, a: level === p.level ? 1 : OFF_FLOOR } : null
    }
    if (L.panels.length === 1) return { p: L.panels[0], a: level === L.panels[0].level ? 1 : OFF_FLOOR }
    for (const p of L.panels) if (p.level === level) return { p, a: 1 }
    return { p: L.panels[0], a: OFF_FLOOR }
  }

  private drawAreas(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, t: number, hi: string | null) {
    const scale = this.scout.info.scale || 5
    for (const ev of tr.areas) {
      const e = ev.e
      if (t < e.t) continue
      const stop = e.until ?? e.t + (e.kind === 'smoke' ? 18 : 7)
      if (t >= stop) continue
      const where = this.at(L, ev.level, ev.id)
      if (!where) continue
      const { p } = where
      const fade = hi && ev.id !== hi ? FADED * 1.6 : 1
      const age = t - e.t
      const left = stop - t
      const x = p.v.ox + e.x * p.v.k
      const y = p.v.oy + e.y * p.v.k
      const busy = this.busy ? BUSY_AREA : 1
      if (e.kind === 'smoke') {
        const rad = (SMOKE_RADIUS / scale) * p.v.k * (0.7 + 0.3 * easeOut(age / 0.9))
        ctx.globalAlpha = Math.min(1, age / 0.4) * Math.min(1, left / 1.5) * 0.82 * where.a * fade * busy
        ctx.drawImage(this.smoke, x - rad * 1.3, y - rad * 1.3, rad * 2.6, rad * 2.6)
        if (this.busy) continue
        // Time left as a thin ring.
        const total = stop - e.t
        ctx.lineWidth = 1.5 * L.u
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath()
        ctx.arc(x, y, rad * 0.9, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
        ctx.stroke()
      } else {
        const rad = (FIRE_RADIUS / scale) * p.v.k * (0.6 + 0.4 * easeOut(age / 0.5))
        const a = Math.min(1, age / 0.25) * Math.min(1, left / 0.8) * where.a * fade * busy
        ctx.globalAlpha = a * 0.95
        ctx.drawImage(this.fire, x - rad * 1.25, y - rad * 1.25, rad * 2.5, rad * 2.5)
        // Flames flicker along the edge, each on its own beat.
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2 + e.x * 0.01
          const beat = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7 + e.y * 0.03)
          const fx = x + Math.cos(ang) * rad * 0.62
          const fy = y + Math.sin(ang) * rad * 0.62
          const size = rad * (0.42 + 0.18 * beat)
          ctx.globalAlpha = a * (0.25 + 0.35 * beat)
          ctx.drawImage(this.flame, fx - size, fy - size, size * 2, size * 2)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  private drawPops(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, t: number, hi: string | null) {
    // Flash pops and throw lines from many rounds are only noise.
    if (this.busy) return
    const { u } = L
    const scale = this.scout.info.scale || 5
    ctx.lineCap = 'round'
    for (const ev of tr.pops) {
      const e = ev.e
      const age = t - e.t
      if (age < 0 || age > THROW_LINE) continue
      const where = this.at(L, ev.level, ev.id)
      if (!where) continue
      const { p } = where
      const fade = (hi && ev.id !== hi ? FADED : 1) * where.a
      const x = p.v.ox + e.x * p.v.k
      const y = p.v.oy + e.y * p.v.k
      const type = e.kind === 'smoke' ? EQ.smoke : e.kind === 'flash' ? EQ.flash : e.kind === 'he' ? EQ.he : e.kind === 'fire' ? EQ.molotov : EQ.decoy
      // A faint line back to where it was thrown from.
      if (e.from) {
        const fx = p.v.ox + e.from[0] * p.v.k
        const fy = p.v.oy + e.from[1] * p.v.k
        const col = NADE_COLOR[type] ?? TEXT_2
        ctx.globalAlpha = fade * 0.5 * (1 - age / THROW_LINE)
        ctx.strokeStyle = col
        ctx.lineWidth = 1.5 * u
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.fillStyle = EDGE
        circle(ctx, fx, fy, 3.6 * u)
        ctx.fill()
        ctx.fillStyle = col
        circle(ctx, fx, fy, 2.2 * u)
        ctx.fill()
      }
      if (e.kind === 'flash' && age < FLASH_POP) {
        const k = age / FLASH_POP
        const rad = ((40 + 240 * easeOut(k)) / scale) * p.v.k
        ctx.globalAlpha = fade * (1 - k) * 0.9
        ctx.drawImage(this.white, x - rad, y - rad, rad * 2, rad * 2)
        ctx.globalAlpha = fade * (1 - k) * 0.8
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.25 * u
        circle(ctx, x, y, rad * 0.8)
        ctx.stroke()
      } else if (e.kind === 'he' && age < HE_POP) {
        const k = age / HE_POP
        const rad = (350 / scale) * p.v.k * (0.12 + 0.88 * easeOut(k))
        ctx.globalAlpha = fade * (1 - k) * 0.85
        ctx.drawImage(this.orange, x - rad, y - rad, rad * 2, rad * 2)
        ctx.globalAlpha = fade * (1 - k)
        ctx.strokeStyle = '#ffc89a'
        ctx.lineWidth = 2 * u
        circle(ctx, x, y, rad * 0.8)
        ctx.stroke()
      } else if (e.kind === 'decoy' && age < DECOY_SHOW) {
        ctx.globalAlpha = fade * Math.min(1, (DECOY_SHOW - age) / 0.4)
        nadeBadge(ctx, x, y, EQ.decoy, 10 * u, u)
      }
    }
    ctx.globalAlpha = 1
  }

  // drawMarks draws kills, deaths and plants: lines from the killer for a
  // moment, then marks that stay.
  private drawMarks(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, t: number, hi: string | null) {
    const { u } = L
    ctx.lineCap = 'round'
    const line = (ev: Ev, color: string) => {
      const e = ev.e
      const age = t - e.t
      if (!e.from || age < 0 || age > KILL_LINE) return
      const where = this.at(L, ev.level, ev.id)
      if (!where) return
      const { p } = where
      ctx.globalAlpha = (hi && ev.id !== hi ? FADED : 1) * where.a * 0.85 * (1 - age / KILL_LINE)
      ctx.strokeStyle = color
      ctx.lineWidth = 2 * u
      ctx.beginPath()
      ctx.moveTo(p.v.ox + e.from[0] * p.v.k, p.v.oy + e.from[1] * p.v.k)
      ctx.lineTo(p.v.ox + e.x * p.v.k, p.v.oy + e.y * p.v.k)
      ctx.stroke()
    }
    // On a busy map only the plants stay, the dead leave and kills are
    // too many to read.
    if (!this.busy) {
      for (const ev of tr.deaths) line(ev, BAD)
      for (const ev of tr.kills) line(ev, ev.color)
    }
    for (const ev of tr.plants) {
      const e = ev.e
      if (t < e.t) continue
      // The bomb matters to everyone, so it goes on every player's map.
      const spots =
        L.grid === 'players' && this.pass === 'own'
          ? L.panels.filter((p) => !p.all).map((p) => ({ p, a: p.level === ev.level ? 1 : OFF_FLOOR }))
          : [this.at(L, ev.level, ev.id)]
      for (const where of spots) {
        if (!where) continue
        const { p } = where
        const x = p.v.ox + e.x * p.v.k
        const y = p.v.oy + e.y * p.v.k
        const age = t - e.t
        if (age < 1.2) {
          ctx.globalAlpha = where.a * (1 - age / 1.2)
          ctx.strokeStyle = ACCENT
          ctx.lineWidth = 2 * u
          circle(ctx, x, y, (12 + 26 * easeOut(age / 1.2)) * u)
          ctx.stroke()
        }
        ctx.globalAlpha = where.a
        c4Mark(ctx, x, y, (L.grid ? 8 : 11) * u, u)
      }
    }
    // Enemies they killed, as a skull in the killer's colour.
    if (this.busy) {
      ctx.globalAlpha = 1
      return
    }
    for (const ev of tr.kills) {
      const e = ev.e
      if (t < e.t) continue
      const where = this.at(L, ev.level, ev.id)
      if (!where) continue
      const { p } = where
      const x = p.v.ox + e.x * p.v.k
      const y = p.v.oy + e.y * p.v.k
      const age = t - e.t
      const a = (hi && ev.id !== hi ? FADED : 1) * where.a
      if (age < 0.5) {
        ctx.globalAlpha = a * (1 - age / 0.5)
        ctx.strokeStyle = ev.color
        ctx.lineWidth = 2 * u
        circle(ctx, x, y, (9 + 14 * easeOut(age / 0.5)) * u)
        ctx.stroke()
      }
      ctx.globalAlpha = a
      killMark(ctx, x, y, ev.color, u)
    }
    ctx.globalAlpha = 1
  }

  private scratchCanvas: HTMLCanvasElement | null = null

  private scratch(w: number, h: number): CanvasRenderingContext2D {
    if (!this.scratchCanvas || this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) this.scratchCanvas = canvasOf(w, h)
    const ctx = this.scratchCanvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    return ctx
  }

  private ensureTrail(n: number) {
    if (this.trailX.length >= n) return
    this.trailX = new Float64Array(n)
    this.trailY = new Float64Array(n)
    this.trailL = new Int8Array(n)
    this.trailA = new Float64Array(n)
  }

  // num is the round's number to write in the dot, 0 for none. With path
  // the whole way they walked since freeze time is drawn faintly.
  private drawPlayer(ctx: CanvasRenderingContext2D, L: Layout, pp: PPlayer, t: number, trail: number, alpha: number, focus: boolean, cone: boolean, num = 0, path = false) {
    const { u } = L
    const p = pp.p
    const step = this.step
    const n = p.xs.length
    const pt = this.pt
    sampleAt(p, step, t, pt)
    const alive = pt[3] === 1
    // On a busy map the dead fade out after a moment instead of piling up.
    if (!alive && this.busy) {
      const since = t - pp.died
      if (since > DEAD_SHOW) return
      alpha *= Math.min(1, (DEAD_SHOW - since) / 1)
    }
    const headLevel = levelOf(this.scout.info, pt[2])
    if (path) this.drawPath(ctx, L, pp, t, alpha)
    // The trail: samples from t - trail up to now, then the current spot.
    if (trail > 0) {
      const from = Math.max(0, Math.ceil((t - trail) / step - 1e-6))
      const to = Math.min(n - 1, Math.floor(t / step + 1e-6))
      const count = Math.max(0, to - from + 1) + 1
      this.ensureTrail(count)
      const X = this.trailX
      const Y = this.trailY
      const LV = this.trailL
      const AG = this.trailA
      let m = 0
      for (let i = from; i <= to; i++) {
        if (!p.alive[i] && (i === 0 || !p.alive[i - 1])) break
        X[m] = p.xs[i]
        Y[m] = p.ys[i]
        LV[m] = pp.levels[i]
        AG[m] = t - i * step
        m++
        if (!p.alive[i]) break
      }
      if (alive && m > 0) {
        X[m] = pt[0]
        Y[m] = pt[1]
        LV[m] = headLevel
        AG[m] = 0
        m++
      }
      if (m > 1) {
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = p.color
        ctx.lineWidth = (focus ? 3.4 : 2.6) * u
        let k = 0
        while (k < m - 1) {
          const band = Math.min(BANDS - 1, Math.floor((AG[k] / trail) * BANDS))
          const lv = LV[k]
          const where = this.at(L, lv, p.steamId)
          if (!where) break
          const v = where.p.v
          ctx.globalAlpha = alpha * where.a * 0.85 * Math.pow(1 - (band + 0.5) / BANDS, 1.4)
          ctx.beginPath()
          ctx.moveTo(v.ox + X[k] * v.k, v.oy + Y[k] * v.k)
          let drew = false
          while (k < m - 1) {
            const nb = Math.min(BANDS - 1, Math.floor((AG[k] / trail) * BANDS))
            if (nb !== band || LV[k] !== lv) break
            if (LV[k + 1] !== lv) {
              // A floor change: the line stops here.
              k++
              break
            }
            ctx.lineTo(v.ox + X[k + 1] * v.k, v.oy + Y[k + 1] * v.k)
            drew = true
            k++
          }
          if (drew) ctx.stroke()
        }
      }
    }
    const where = this.at(L, headLevel, p.steamId)
    if (!where) return
    const v = where.p.v
    const x = v.ox + pt[0] * v.k
    const y = v.oy + pt[1] * v.k
    ctx.globalAlpha = alpha * where.a
    if (!alive) {
      drawShape(ctx, 'x', x, y, p.color, u * (focus ? 0.95 : 0.78))
    } else {
      // A dot with a number is a bit bigger, so the digits fit.
      const r = (num ? (focus ? 10 : 9) : focus ? 8 : 6.5) * u
      // Radar y runs down, so the angle flips.
      const a = (-pt[4] * Math.PI) / 180
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      if (cone) {
        const len = (focus ? 56 : 40) * u
        const g = ctx.createRadialGradient(x, y, r, x, y, len)
        g.addColorStop(0, rgba(p.color, 0.42))
        g.addColorStop(1, rgba(p.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, len, a - CONE, a + CONE)
        ctx.closePath()
        ctx.fill()
      }
      // A small pointer for where they look.
      const tip = r + 6 * u
      const side = 0.62
      ctx.fillStyle = EDGE
      ctx.beginPath()
      ctx.moveTo(x + ca * (tip + 1.6 * u), y + sa * (tip + 1.6 * u))
      ctx.lineTo(x + Math.cos(a - side) * (r + 1 * u), y + Math.sin(a - side) * (r + 1 * u))
      ctx.lineTo(x + Math.cos(a + side) * (r + 1 * u), y + Math.sin(a + side) * (r + 1 * u))
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = TEXT
      ctx.beginPath()
      ctx.moveTo(x + ca * tip, y + sa * tip)
      ctx.lineTo(x + Math.cos(a - side * 0.8) * r, y + Math.sin(a - side * 0.8) * r)
      ctx.lineTo(x + Math.cos(a + side * 0.8) * r, y + Math.sin(a + side * 0.8) * r)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = EDGE
      circle(ctx, x, y, r + 2.2 * u)
      ctx.fill()
      ctx.fillStyle = p.color
      circle(ctx, x, y, r)
      ctx.fill()
      if (focus) {
        ctx.lineWidth = 2 * u
        ctx.strokeStyle = TEXT
        circle(ctx, x, y, r + 3.4 * u)
        ctx.stroke()
      }
      if (num) {
        font(ctx, 700, num >= 10 ? 10 : 12, u)
        ctx.fillStyle = BG
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${num}`, x, y + 0.75 * u)
        ctx.textBaseline = 'alphabetic'
      }
    }
    ctx.globalAlpha = 1
  }

  // drawPath is the way a player walked from freeze time up to t, one thin
  // faint line per stretch on a floor, so their route stays readable.
  private drawPath(ctx: CanvasRenderingContext2D, L: Layout, pp: PPlayer, t: number, alpha: number) {
    const p = pp.p
    const to = Math.min(p.xs.length - 1, Math.floor(t / this.step))
    if (to < 1) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = p.color
    ctx.lineWidth = (this.sheet ? 2.6 : 2) * L.u
    const strength = this.sheet ? 0.78 : 0.32
    let lv = -1
    let open = false
    let v: View | null = null
    for (let i = 0; i <= to; i++) {
      if (i > 0 && !p.alive[i - 1]) break
      if (pp.levels[i] !== lv) {
        if (open) ctx.stroke()
        open = false
        lv = pp.levels[i]
        const where = this.at(L, lv, p.steamId)
        if (!where) continue
        v = where.p.v
        ctx.globalAlpha = alpha * where.a * strength
        ctx.beginPath()
        ctx.moveTo(v.ox + p.xs[i] * v.k, v.oy + p.ys[i] * v.k)
        open = true
        continue
      }
      if (open && v) ctx.lineTo(v.ox + p.xs[i] * v.k, v.oy + p.ys[i] * v.k)
    }
    if (open) ctx.stroke()
    ctx.globalAlpha = alpha
  }

  // roundTitle names a round's map: its number, the round, won or lost
  // and the site they went for.
  private roundTitle(ctx: CanvasRenderingContext2D, p: Panel, u: number) {
    const tr = this.situation.tracks[p.round ?? -1]
    if (!tr) return
    const y = p.box.y - 10 * u
    let x = p.box.x
    x += numBadge(ctx, (p.round ?? 0) + 1, tr.won, x, y - 7 * u, u) + 8 * u
    font(ctx, 700, 17, u, 0.01)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = TEXT
    const name = fitText(ctx, shortLabel(tr.label), p.box.w * 0.5)
    ctx.fillText(name, x, y)
    x += ctx.measureText(name).width + 10 * u
    font(ctx, 600, 15, u, 0.02)
    const hit = tr.hit && tr.hitTime >= 0 ? ` · ${tr.hit} at ${clockText(tr.hitTime)}` : ''
    ctx.fillStyle = tr.won ? GOOD : BAD
    const res = tr.won ? 'Won' : 'Lost'
    ctx.fillText(res, x, y)
    if (hit) {
      ctx.fillStyle = TEXT_3
      ctx.fillText(fitText(ctx, hit, p.box.x + p.box.w - x - ctx.measureText(res).width), x + ctx.measureText(res).width, y)
    }
    setSpacing(ctx, '0px')
  }

  // drawNames puts the names next to the dots when a single round is on
  // screen.
  private drawNames(ctx: CanvasRenderingContext2D, L: Layout, tr: PTrack, t: number, hi: string | null) {
    const { u } = L
    const pt = this.pt
    font(ctx, 600, 15, u, 0.02)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const pp of tr.players) {
      sampleAt(pp.p, this.step, t, pt)
      const where = this.at(L, levelOf(this.scout.info, pt[2]), pp.p.steamId)
      if (!where) continue
      const v = where.p.v
      const x = v.ox + pt[0] * v.k + 12 * u
      const y = v.oy + pt[1] * v.k - 1 * u
      ctx.globalAlpha = (hi && pp.p.steamId !== hi ? FADED : 1) * where.a * (pt[3] ? 1 : 0.6)
      ctx.lineWidth = 3.5 * u
      ctx.strokeStyle = 'rgba(11,13,17,0.85)'
      font(ctx, 600, 15, u, 0.02)
      ctx.strokeText(pp.p.name, x, y)
      ctx.fillStyle = TEXT
      ctx.fillText(pp.p.name, x, y)
      let nx = x + ctx.measureText(pp.p.name).width + 6 * u
      // Their gun and where they are, from the demo, while they are alive.
      const gun = pt[3] ? gunAt(pp.p, this.step, t) : 0
      const icon = gun ? weaponIcon(gun, this.situation.side === 'ct' ? 3 : 2) : null
      const ih = 11 * u
      const bm = icon ? iconBitmap(icon, null, ih) : null
      if (bm) {
        const iw = (bm.width / bm.height) * ih
        drawIcon(ctx, icon, nx + iw / 2, y, ih, TEXT_2)
        nx += iw + 6 * u
      }
      const place = pt[3] ? placeAt(tr.track, pp.p, this.step, t) : ''
      if (place) {
        font(ctx, 500, 13, u, 0.02)
        ctx.strokeText(place, nx, y + 0.5 * u)
        ctx.fillStyle = TEXT_2
        ctx.fillText(place, nx, y + 0.5 * u)
        font(ctx, 600, 15, u, 0.02)
      }
    }
    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
    setSpacing(ctx, '0px')
  }

  private drawEmpty(ctx: CanvasRenderingContext2D, L: Layout) {
    const { u } = L
    font(ctx, 600, 24, u)
    ctx.fillStyle = TEXT_2
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No rounds picked', L.map.x + L.map.w / 2, L.map.y + L.map.h / 2)
    ctx.textBaseline = 'alphabetic'
  }

  private drawClock(ctx: CanvasRenderingContext2D, L: Layout, t: number) {
    const { u } = L
    const { x, y, w } = L.bar
    const k = this.span > 0 ? Math.min(1, t / this.span) : 0
    ctx.fillStyle = ACCENT
    roundRect(ctx, x, y - 3 * u, Math.max(6 * u, w * k), 6 * u, 3 * u)
    ctx.fill()
    ctx.fillStyle = TEXT
    circle(ctx, x + w * k, y, 7 * u)
    ctx.fill()
    ctx.fillStyle = ACCENT
    circle(ctx, x + w * k, y, 3.5 * u)
    ctx.fill()
    font(ctx, 700, L.clock.size / u, u)
    ctx.fillStyle = TEXT
    fixedDigits(ctx, clockText(t), L.clock.x - 4 * u, L.clock.y)
    setSpacing(ctx, '0px')
  }
}

// roundsLine says which rounds are on screen, for when there is no note.
export function roundsLine(list: SituationTrack[]): string {
  if (!list.length) return ''
  if (list.length === 1) {
    const t = list[0]
    const hit = t.hit && t.hitTime >= 0 ? `, the T side hit ${t.hit} after ${Math.round(t.hitTime)} s` : ''
    return `${t.label}, ${t.won ? 'won' : 'lost'}${hit}.`
  }
  const won = list.filter((t) => t.won).length
  return `${list.map((t) => t.label).join(', ')}. ${won} of ${list.length} won.`
}

// fixedDigits writes digits in cells of one width, so the clock does not
// jump as they change.
function fixedDigits(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  const cell = ctx.measureText('0').width
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let cx = x
  for (const ch of text) {
    const w = ch >= '0' && ch <= '9' ? cell : ctx.measureText(ch).width
    ctx.fillText(ch, cx + w / 2, y)
    cx += w
  }
  ctx.textAlign = 'left'
}

// prepTrack works out the floor of every sample and event once.
function prepTrack(tr: SituationTrack, index: number, info: MapInfo, step: number): PTrack {
  const byName = new Map<string, TrackPlayer>()
  for (const p of tr.players) byName.set(p.name, p)
  const players = tr.players.map((p) => {
    const levels = new Uint8Array(p.zs.length)
    for (let i = 0; i < p.zs.length; i++) levels[i] = levelOf(info, p.zs[i])
    const dead = p.alive.indexOf(0)
    return { p, levels, died: dead < 0 ? Infinity : dead * step }
  })
  const out: PTrack = { index, track: tr, players, areas: [], pops: [], kills: [], deaths: [], plants: [] }
  for (const e of tr.events) {
    const who = byName.get(e.player)
    const ev: Ev = { e, level: levelOf(info, e.z), color: who?.color ?? TEXT_2, id: who?.steamId ?? '' }
    switch (e.kind) {
      case 'smoke':
      case 'fire':
        out.areas.push(ev)
        out.pops.push(ev)
        break
      case 'flash':
      case 'he':
      case 'decoy':
        out.pops.push(ev)
        break
      case 'kill':
        out.kills.push(ev)
        break
      case 'death':
        out.deaths.push(ev)
        break
      case 'plant':
        out.plants.push(ev)
        break
    }
  }
  return out
}

// legendOf lists the players in the tracks in roster order, with the role
// they play on this side.
function legendOf(roles: RoleCard[], s: Situation): Legend[] {
  const seen = new Map<string, Legend>()
  for (const tr of s.tracks) {
    for (const p of tr.players) {
      if (seen.has(p.steamId)) continue
      const rc = roles.find((r) => r.steamId === p.steamId)
      const role = rc ? (s.side === 'ct' ? rc.ct.label : rc.t.label) : ''
      seen.set(p.steamId, { id: p.steamId, name: p.name, color: p.color, role })
    }
  }
  const order = (id: string) => {
    const i = roles.findIndex((r) => r.steamId === id)
    return i < 0 ? 1e9 : i
  }
  return [...seen.values()].sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name))
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, u: number) {
  font(ctx, 600, 15, u, 0.14)
  ctx.fillStyle = TEXT_3
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text.toUpperCase(), x, y)
  setSpacing(ctx, '0px')
}

// statRow writes values with a small label under each, as many as fit.
function statRow(ctx: CanvasRenderingContext2D, stats: { value: string; label: string; tint?: string }[], x: number, y: number, maxW: number, u: number) {
  let cx = x
  const gap = 30 * u
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const s of stats) {
    font(ctx, 700, 38, u)
    const vw = ctx.measureText(s.value).width
    font(ctx, 600, 13, u, 0.08)
    const lw = Math.min(ctx.measureText(s.label.toUpperCase()).width, 190 * u)
    const w = Math.max(vw, lw)
    if (cx + w > x + maxW) break
    font(ctx, 700, 38, u)
    ctx.fillStyle = s.tint ?? TEXT
    ctx.fillText(s.value, cx, y)
    font(ctx, 600, 13, u, 0.08)
    ctx.fillStyle = TEXT_2
    ctx.fillText(fitText(ctx, s.label.toUpperCase(), 190 * u), cx, y + 24 * u)
    cx += w + gap
  }
  setSpacing(ctx, '0px')
}

// wrap breaks text into lines that fit, the last one shortened.
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= maxW || !cur) {
      cur = next
      continue
    }
    lines.push(cur)
    cur = words[i]
    if (lines.length === maxLines - 1) {
      cur = words.slice(i).join(' ')
      break
    }
  }
  if (cur) lines.push(fitText(ctx, cur, maxW))
  return lines
}

// numBadge draws a round's number on green when it was won, red when
// lost, with its middle left at (x, y). Returns its width.
function numBadge(ctx: CanvasRenderingContext2D, n: number, won: boolean, x: number, y: number, u: number): number {
  const text = `${n}`
  font(ctx, 700, 13, u)
  const w = Math.max(20 * u, ctx.measureText(text).width + 10 * u)
  const h = 20 * u
  ctx.fillStyle = won ? GOOD : BAD
  roundRect(ctx, x, y - h / 2, w, h, 4 * u)
  ctx.fill()
  ctx.fillStyle = BG
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + 0.75 * u)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return w
}

// chips lists the rounds on screen with the number their dots carry, won
// or lost, and the site they went for.
function chips(ctx: CanvasRenderingContext2D, list: PTrack[], x: number, y: number, maxW: number, bottom: number, u: number) {
  const h = 30 * u
  const gap = 8 * u
  let cx = x
  let cy = y
  font(ctx, 600, 15, u, 0.04)
  for (let i = 0; i < list.length; i++) {
    const tr = list[i].track
    const n = list[i].index + 1
    const text = shortLabel(tr.label)
    const site = tr.hit === 'A' || tr.hit === 'B' ? tr.hit : ''
    font(ctx, 700, 13, u)
    const nw = Math.max(20 * u, ctx.measureText(`${n}`).width + 10 * u)
    font(ctx, 600, 15, u, 0.04)
    const tw = ctx.measureText(text).width
    const sw = site ? 24 * u : 0
    const w = 5 * u + nw + 8 * u + tw + sw + 12 * u
    if (cx + w > x + maxW) {
      cx = x
      cy += h + gap
    }
    if (cy + h > bottom) {
      const more = `+${list.length - i}`
      font(ctx, 600, 15, u, 0.04)
      ctx.fillStyle = TEXT_3
      ctx.textBaseline = 'middle'
      ctx.fillText(more, cx, cy - h / 2 - gap + 1 * u)
      ctx.textBaseline = 'alphabetic'
      break
    }
    ctx.fillStyle = SURFACE
    roundRect(ctx, cx, cy, w, h, 4 * u)
    ctx.fill()
    ctx.lineWidth = Math.max(1, u)
    ctx.strokeStyle = LINE_2
    roundRect(ctx, cx + 0.5 * u, cy + 0.5 * u, w - u, h - u, 3.5 * u)
    ctx.stroke()
    numBadge(ctx, n, tr.won, cx + 5 * u, cy + h / 2, u)
    const tx = cx + 5 * u + nw + 8 * u
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    font(ctx, 600, 15, u, 0.04)
    ctx.fillStyle = TEXT
    ctx.fillText(text, tx, cy + h / 2 + 1 * u)
    if (site) {
      // The site the T side went for, in the side's colour.
      const sx = tx + tw + 8 * u + 8 * u
      if (!drawIcon(ctx, `hud/bombsite-${site.toLowerCase()}`, sx, cy + h / 2, 16 * u, teamColor(2).light)) {
        font(ctx, 700, 14, u)
        ctx.fillStyle = teamColor(2).light
        ctx.textAlign = 'center'
        ctx.fillText(site, sx, cy + h / 2 + 1 * u)
        ctx.textAlign = 'left'
      }
    }
    ctx.textBaseline = 'alphabetic'
    cx += w + gap
  }
  setSpacing(ctx, '0px')
}

// hitMarks groups the site hits of the tracks for the time bar: hits on
// one site closer than gap pixels on a bar w pixels long share a mark.
export function hitMarks(list: SituationTrack[], duration: number, gap: number, w: number): { site: string; time: number; n: number }[] {
  const hits = list
    .filter((t) => t.hit && t.hitTime >= 0 && t.hitTime <= duration)
    .map((t) => ({ site: t.hit, time: t.hitTime }))
    .sort((a, b) => a.time - b.time)
  const out: { site: string; time: number; n: number }[] = []
  const span = duration > 0 ? (gap / w) * duration : 0
  for (const h of hits) {
    const near = out.find((m) => m.site === h.site && Math.abs(m.time - h.time) < span)
    if (near) {
      near.time += (h.time - near.time) / (near.n + 1)
      near.n++
    } else out.push({ ...h, n: 1 })
  }
  return out
}

function countBadge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, u: number) {
  const text = `${n}`
  font(ctx, 700, 12, u)
  const w = Math.max(16 * u, ctx.measureText(text).width + 8 * u)
  const h = 15 * u
  ctx.fillStyle = TEXT
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = BG
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5 * u)
  ctx.textBaseline = 'alphabetic'
}

// killMark is an enemy they killed: a skull on a dark disc, in the
// killer's colour.
function killMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, u: number) {
  ctx.fillStyle = EDGE
  circle(ctx, x, y, 8.5 * u)
  ctx.fill()
  ctx.lineWidth = 1.6 * u
  ctx.strokeStyle = color
  ctx.stroke()
  if (!drawIcon(ctx, 'hud/dead', x, y, 11 * u, color)) {
    ctx.fillStyle = color
    circle(ctx, x, y, 3 * u)
    ctx.fill()
  }
}
