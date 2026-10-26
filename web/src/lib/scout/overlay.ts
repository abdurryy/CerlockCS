// Situation overlay: every round of one situation, like T pistol rounds,
// drawn on top of each other on the styled map at one moment after
// freeze time. Players are dots in their own colour with a short fading
// trail, utility shows while it is up, deaths stay as an X. The same
// drawing is used by the player in the app, saved frames and videos.

import { ACCENT, BAD, BG, GOOD, TEXT, TEXT_2, teamColor } from '../colors'
import { mapLabel } from '../format'
import { drawIcon } from '../icons.svelte'
import { FONT, circle, flameSprite, roundRect, setSpacing, smokeSprite } from '../render/draw'
import type { MapInfo } from '../types'
import { EQ, NADE_COLOR } from '../weapons'
import { levelOf, scoutLabels, scoutOptions } from './aggregate'
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

export interface OverlayOptions {
  // Tracks to show, by index into situation.tracks. All when left out.
  rounds?: readonly number[] | null
  // A player's steamId. The others fade back.
  highlight?: string | null
  floors?: FloorMode
  // Seconds of trail behind each player.
  trail?: number
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

// sampleAt reads a player's position at t seconds, between two samples.
// out gets x, y, z and 1 when alive.
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
  } else {
    out[0] = p.xs[i]
    out[1] = p.ys[i]
    out[2] = p.zs[i]
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
}

interface PTrack {
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
}

interface Layout {
  w: number
  h: number
  u: number
  wide: boolean
  panels: Panel[]
  map: Rect
  // The clock, the time bar and where the dynamic parts go.
  clock: { x: number; y: number; size: number }
  bar: { x: number; y: number; w: number }
}

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
  readonly duration: number
  readonly step: number
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
  private last = { w: 0, h: 0, rounds: null as OverlayOptions['rounds'], floors: undefined as FloorMode | undefined, hi: undefined as string | null | undefined, vis: [] as PTrack[] }
  private pt = new Float64Array(4)
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
  ) {
    const so = scoutOptions(scout)
    this.step = so.trackStep || 0.125
    this.duration = so.trackSeconds || 30
    const info = scout.info
    this.heights = situation.heat20.levels.map((l) => {
      let s = 0
      for (let i = 0; i < l.length; i++) s += l[i]
      return s
    })
    this.tracks = situation.tracks.map((tr) => prepTrack(tr, info))
    this.legend = legendOf(scout.roles, situation)
    this.smoke = smokeSprite()
    this.fire = fireSprite()
    this.flame = flameSprite()
    this.white = glowSprite(255, 255, 255)
    this.orange = glowSprite(255, 150, 80)
  }

  static async create(scout: MapScout, situation: Situation, opts: { teamName?: string } = {}): Promise<Overlay> {
    const labels = scoutLabels(scout) ?? { callouts: [], sites: [] }
    const [stage] = await Promise.all([stageFor(scout.info, labels, [situation.heat20, scout.team.ct, scout.team.t]), assetsAt(60, ['hud/dead', 'weapon/c4'])])
    return new Overlay(scout, situation, stage, opts.teamName?.trim() ?? '')
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
    if (!opts.rounds) return this.tracks
    const out: PTrack[] = []
    for (const i of opts.rounds) if (this.tracks[i]) out.push(this.tracks[i])
    return out
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
    const same = !!this.bg && last.w === w && last.h === h && last.rounds === opts.rounds && last.floors === opts.floors && last.hi === opts.highlight
    const vis = same ? last.vis : this.visible(opts)
    const bg = same ? this.bg! : this.background(w, h, opts, vis)
    last.w = w
    last.h = h
    last.rounds = opts.rounds
    last.floors = opts.floors
    last.hi = opts.highlight
    last.vis = vis
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(bg.canvas, 0, 0)
    const L = bg.layout
    const time = Math.max(0, Math.min(this.duration, t))
    const hi = opts.highlight ?? null
    // Clip to the map area so nothing runs into the side column.
    ctx.save()
    ctx.beginPath()
    ctx.rect(L.map.x, L.map.y, L.map.w, L.map.h)
    ctx.clip()
    for (const tr of vis) this.drawAreas(ctx, L, tr, time, hi)
    for (const tr of vis) this.drawPops(ctx, L, tr, time, hi)
    for (const tr of vis) this.drawMarks(ctx, L, tr, time, hi)
    const trail = Math.max(0, opts.trail ?? TRAIL)
    for (const tr of vis) for (const pp of tr.players) if (!hi || pp.p.steamId !== hi) this.drawPlayer(ctx, L, pp, time, trail, hi ? FADED : 1, false)
    if (hi) for (const tr of vis) for (const pp of tr.players) if (pp.p.steamId === hi) this.drawPlayer(ctx, L, pp, time, trail, 1, true)
    if (vis.length === 1) this.drawNames(ctx, L, vis[0], time, hi)
    ctx.restore()
    if (!vis.length) this.drawEmpty(ctx, L)
    this.drawClock(ctx, L, time)
  }

  // ---- Static layer ----

  private background(w: number, h: number, opts: OverlayOptions, vis: PTrack[]): { canvas: HTMLCanvasElement; layout: Layout } {
    const floors = floorsFor(this.heights, opts.floors ?? 'auto')
    const key = [w, h, floors.join(','), opts.highlight ?? '', vis.map((v) => this.tracks.indexOf(v)).join(',')].join('|')
    if (this.bg && this.bg.key === key) return this.bg
    const layout = this.layoutFor(w, h, floors)
    const canvas = this.bg && this.bg.canvas.width === w && this.bg.canvas.height === h ? this.bg.canvas : canvasOf(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this.paintStatic(ctx, layout, opts, vis)
    this.bg = { key, canvas, layout }
    return this.bg
  }

  private layoutFor(w: number, h: number, floors: number[]): Layout {
    const wide = w / h >= 1.25
    const u = wide ? Math.min(w / WIDE_W, h / WIDE_H) : Math.min(w, h) / SQUARE
    const map: Rect = wide
      ? { x: 600 * u, y: 150 * u, w: w - 600 * u - 48 * u, h: h - 150 * u - 36 * u }
      : { x: 48 * u, y: 272 * u, w: w - 96 * u, h: h - 272 * u - 262 * u }
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
    const clock = wide ? { x: 64 * u, y: 352 * u, size: 116 * u } : { x: 72 * u, y: h - 150 * u, size: 64 * u }
    const bar = wide ? { x: 64 * u, y: 398 * u, w: 470 * u } : { x: 232 * u, y: h - 172 * u, w: 230 * u }
    return { w, h, u, wide, panels, map, clock, bar }
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
    gridLines(ctx, info, first.v, { x: L.map.x - 24 * u, y: L.map.y - 24 * u, w: L.map.w + 48 * u, h: L.map.h + 48 * u }, u, L.wide ? 'xy' : 'y')
    const split = L.panels.length > 1
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
      drawLabels(ctx, st, p.level, p.v, lu, [], [], vis.length > 3)
      if (split) {
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

  private bits(vis: PTrack[]): string[] {
    const s = this.situation
    const n = s.tracks.length
    const shown = vis.length === n ? plural(n, 'round') : `${vis.length} of ${plural(n, 'round')}`
    const matches = new Set(s.tracks.map((t) => t.replayId)).size
    return [shown, plural(matches, 'match')]
  }

  private head(ctx: CanvasRenderingContext2D, L: Layout, vis: PTrack[], y: { kicker: number; title: number; sub: number; size: number }, maxW: number, titleW: number) {
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
    ctx.fillText(fitText(ctx, this.bits(vis).join('   ·   '), x0 + maxW - x), x, y.sub + 1 * u)
    ctx.textBaseline = 'alphabetic'
    setSpacing(ctx, '0px')
  }

  private paintWide(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, vis: PTrack[]) {
    const { w, h, u } = L
    const x0 = 64 * u
    const colW = 470 * u
    const logoW = this.logoHeight(w, h) * 3.27
    this.head(ctx, L, vis, { kicker: 74 * u, title: 136 * u, sub: 186 * u, size: 64 }, colW + 40 * u, w - 128 * u - logoW - 40 * u)
    logoMark(ctx, this.logo(w, h), w - 64 * u, 136 * u, this.logoHeight(w, h))

    // Clock and time bar.
    label(ctx, 'Time after freeze', x0, 252 * u, u)
    this.paintBar(ctx, L, vis)

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
      chips(ctx, vis.map((v) => v.track), x0, y + 16 * u, colW, h - 40 * u, u)
    }
  }

  private paintSquare(ctx: CanvasRenderingContext2D, L: Layout, opts: OverlayOptions, vis: PTrack[]) {
    const { w, h, u } = L
    const logoW = this.logoHeight(w, h) * 3.27
    const room = w - 72 * u - logoW - 40 * u - 72 * u
    this.head(ctx, L, vis, { kicker: 96 * u, title: 172 * u, sub: 224 * u, size: 76 }, room, room)
    logoMark(ctx, this.logo(w, h), w - 72 * u, 172 * u, this.logoHeight(w, h))
    label(ctx, 'Time after freeze', 72 * u, h - 214 * u, u)
    this.paintBar(ctx, L, vis)
    // Numbers in the middle, players on the right.
    const right = w - 72 * u
    const legendW = this.paintLegendSquare(ctx, L, opts, right)
    const sx = 520 * u
    label(ctx, 'In these rounds', sx, h - 214 * u, u)
    statRow(ctx, this.stats(), sx, h - 164 * u, right - legendW - 60 * u - sx, u)
    // Footer: the strongest pattern, or the matches.
    ctx.fillStyle = LINE
    ctx.fillRect(72 * u, Math.round(h - 100 * u), w - 144 * u, Math.max(1, Math.round(u)))
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
    const D = this.duration
    ctx.fillStyle = SURFACE_2
    roundRect(ctx, x, y - 3 * u, w, 6 * u, 3 * u)
    ctx.fill()
    font(ctx, 600, L.wide ? 14 : 13, u, 0.08)
    ctx.fillStyle = TEXT_3
    ctx.textBaseline = 'alphabetic'
    const every = D > 40 ? 20 : 10
    for (let s = 0; s <= D + 1e-6; s += every) {
      const tx = x + (s / D) * w
      ctx.textAlign = s === 0 ? 'left' : s >= D - 1e-6 ? 'right' : 'center'
      ctx.fillText(`${s}s`, tx, y + 26 * u)
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
  private at(L: Layout, level: number): { p: Panel; a: number } | null {
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
      const where = this.at(L, ev.level)
      if (!where) continue
      const { p } = where
      const fade = hi && ev.id !== hi ? FADED * 1.6 : 1
      const age = t - e.t
      const left = stop - t
      const x = p.v.ox + e.x * p.v.k
      const y = p.v.oy + e.y * p.v.k
      if (e.kind === 'smoke') {
        const rad = (SMOKE_RADIUS / scale) * p.v.k * (0.7 + 0.3 * easeOut(age / 0.9))
        ctx.globalAlpha = Math.min(1, age / 0.4) * Math.min(1, left / 1.5) * 0.82 * where.a * fade
        ctx.drawImage(this.smoke, x - rad * 1.3, y - rad * 1.3, rad * 2.6, rad * 2.6)
        // Time left as a thin ring.
        const total = stop - e.t
        ctx.lineWidth = 1.5 * L.u
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath()
        ctx.arc(x, y, rad * 0.9, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
        ctx.stroke()
      } else {
        const rad = (FIRE_RADIUS / scale) * p.v.k * (0.6 + 0.4 * easeOut(age / 0.5))
        const a = Math.min(1, age / 0.25) * Math.min(1, left / 0.8) * where.a * fade
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
    const { u } = L
    const scale = this.scout.info.scale || 5
    ctx.lineCap = 'round'
    for (const ev of tr.pops) {
      const e = ev.e
      const age = t - e.t
      if (age < 0 || age > THROW_LINE) continue
      const where = this.at(L, ev.level)
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
      const where = this.at(L, ev.level)
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
    for (const ev of tr.deaths) line(ev, BAD)
    for (const ev of tr.kills) line(ev, ev.color)
    for (const ev of tr.plants) {
      const e = ev.e
      if (t < e.t) continue
      const where = this.at(L, ev.level)
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
      c4Mark(ctx, x, y, 11 * u, u)
    }
    // Enemies they killed, as a skull in the killer's colour.
    for (const ev of tr.kills) {
      const e = ev.e
      if (t < e.t) continue
      const where = this.at(L, ev.level)
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

  private drawPlayer(ctx: CanvasRenderingContext2D, L: Layout, pp: PPlayer, t: number, trail: number, alpha: number, focus: boolean) {
    const { u } = L
    const p = pp.p
    const step = this.step
    const n = p.xs.length
    const pt = this.pt
    sampleAt(p, step, t, pt)
    const alive = pt[3] === 1
    const headLevel = levelOf(this.scout.info, pt[2])
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
          const where = this.at(L, lv)
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
    const where = this.at(L, headLevel)
    if (!where) return
    const v = where.p.v
    const x = v.ox + pt[0] * v.k
    const y = v.oy + pt[1] * v.k
    ctx.globalAlpha = alpha * where.a
    if (!alive) {
      drawShape(ctx, 'x', x, y, p.color, u * (focus ? 0.95 : 0.78))
    } else {
      const r = (focus ? 8 : 6.5) * u
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
    }
    ctx.globalAlpha = 1
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
      const where = this.at(L, levelOf(this.scout.info, pt[2]))
      if (!where) continue
      const v = where.p.v
      const x = v.ox + pt[0] * v.k + 12 * u
      const y = v.oy + pt[1] * v.k - 1 * u
      ctx.globalAlpha = (hi && pp.p.steamId !== hi ? FADED : 1) * where.a * (pt[3] ? 1 : 0.6)
      ctx.lineWidth = 3.5 * u
      ctx.strokeStyle = 'rgba(11,13,17,0.85)'
      ctx.strokeText(pp.p.name, x, y)
      ctx.fillStyle = TEXT
      ctx.fillText(pp.p.name, x, y)
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
    const k = this.duration > 0 ? t / this.duration : 0
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
function prepTrack(tr: SituationTrack, info: MapInfo): PTrack {
  const byName = new Map<string, TrackPlayer>()
  for (const p of tr.players) byName.set(p.name, p)
  const players = tr.players.map((p) => {
    const levels = new Uint8Array(p.zs.length)
    for (let i = 0; i < p.zs.length; i++) levels[i] = levelOf(info, p.zs[i])
    return { p, levels }
  })
  const out: PTrack = { track: tr, players, areas: [], pops: [], kills: [], deaths: [], plants: [] }
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

// chips lists the rounds on screen: won or lost, and the site they went
// for.
function chips(ctx: CanvasRenderingContext2D, list: SituationTrack[], x: number, y: number, maxW: number, bottom: number, u: number) {
  const h = 30 * u
  const gap = 8 * u
  let cx = x
  let cy = y
  font(ctx, 600, 15, u, 0.04)
  for (let i = 0; i < list.length; i++) {
    const tr = list[i]
    const text = shortLabel(tr.label)
    const site = tr.hit === 'A' || tr.hit === 'B' ? tr.hit : ''
    font(ctx, 600, 15, u, 0.04)
    const tw = ctx.measureText(text).width
    const sw = site ? 24 * u : 0
    const w = 22 * u + tw + sw + 12 * u
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
    ctx.fillStyle = tr.won ? GOOD : BAD
    circle(ctx, cx + 12 * u, cy + h / 2, 3.5 * u)
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    font(ctx, 600, 15, u, 0.04)
    ctx.fillStyle = TEXT
    ctx.fillText(text, cx + 22 * u, cy + h / 2 + 1 * u)
    if (site) {
      // The site the T side went for, in the side's colour.
      const sx = cx + 22 * u + tw + 8 * u + 8 * u
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
