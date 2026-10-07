// Poster drawing for the scouting images: the styled map with heat and
// marks, the header with the name and the logo, the numbers and legends
// along the bottom and a footer line with the matches. Everything is laid
// out on a 1600 px grid and scaled to the size asked for.

import logoUrl from '../../assets/brand/lockup-dark.svg?url'
import { ACCENT, BAD, BG, GOOD, TEXT, TEXT_2, teamColor } from '../colors'
import { drawIcon, iconBitmap, icons, onIconLoad } from '../icons.svelte'
import { DISPLAY, FONT, circle, roundRect, setSpacing } from '../render/draw'
import { PLATE_PAD, makePlate } from '../render/plate'
import type { MapInfo } from '../types'
import { EQ, NADE_COLOR } from '../weapons'
import { Binner, GRID, levelOf, newGrid, type MapLabels } from './aggregate'
import type { HeatGrid, UtilityMark, Vec3 } from './types'

export const BASE = 1600
const RADAR = 1024
// Outer margin of the text.
const M = 72
const TEXT_3 = '#6e7883'
const LINE = '#242a32'
const SURFACE = '#12151a'
const SURFACE_2 = '#181c22'
const SHADE = 'rgba(11,13,17,0.9)'
const EDGE = 'rgba(6,8,11,0.88)'
const SMOKE_RADIUS = 144
const FIRE_RADIUS = 110
const HEAT_BOOST = 1.15
// The logo is a quiet watermark.
const LOGO_ALPHA = 0.6
const LOGO_H = 72
// The lockup's wordmark baseline, as a share of the image height.
const WORD_BASE = 362.1 / 512
const LOGO_RATIO = 1672 / 512

// Vertical grid, from the top or the bottom of the image.
const KICKER_Y = 96
const TITLE_Y = 172
const TITLE_SIZE = 76
const SUB_Y = 224
const MAP_TOP = 272
const MAP_BOTTOM = 262
const FOOT_LABEL = 214
const FOOT_VALUE = 164
const FOOT_NAME = 134
const RULE = 100
const LINE_Y = 58

// The app's heat colours (render/heatmap.ts), faint violet to pale pink.
const RAMP: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [92, 74, 196, 0.14],
  [128, 84, 212, 0.3],
  [170, 94, 216, 0.46],
  [210, 108, 204, 0.6],
  [236, 144, 206, 0.72],
  [246, 186, 224, 0.82],
]

export const NADE_ICON: Record<number, string> = {
  [EQ.smoke]: 'weapon/smokegrenade',
  [EQ.flash]: 'weapon/flashbang',
  [EQ.he]: 'weapon/hegrenade',
  [EQ.molotov]: 'weapon/molotov',
  [EQ.incendiary]: 'weapon/incgrenade',
  [EQ.decoy]: 'weapon/decoy',
}

const ICONS = [...Object.values(NADE_ICON), 'weapon/c4', 'hud/bombsite-a', 'hud/bombsite-b', 'kill/ct', 'kill/t']

export interface Stat {
  value: string
  label: string
  icon?: string
  tint?: string
}

export interface Group {
  label: string
  stats: Stat[]
}

export type Shape = 'x' | 'dot'

// Hit is a kill or death mark, with a faint line to the other player.
export interface Hit {
  at: Vec3
  to?: Vec3
  shape: Shape
  color: string
}

export type LegendItem = { label: string } & ({ shape: Shape; color: string } | { nade: number } | { c4: true } | { line: string })

export interface Card {
  name: string
  kind: string
  player?: string
  title: string
  kicker: string
  side: number
  bits: string[]
  level: number
  floor: string
  heat: Float32Array | null
  heatSize: number
  sigma: number
  heatLabel: string
  hits: Hit[]
  utility: UtilityMark[]
  // Throw lines for utility, and smoke and fire areas.
  lines: boolean
  areas: boolean
  plants: Vec3[]
  footer: Group[]
  legend: LegendItem[]
}

export interface Result {
  won: boolean | null
  score: string
}

// Context is the footer line shared by all images of a map.
export interface Context {
  line: string
  results: Result[]
}

export interface Tile {
  label: string
  value: string
  note: string
  side?: number
}

export interface Row {
  label: string
  value: string
  note: string
  share?: number
  site?: string
  side?: number
}

export interface PlayerRow {
  name: string
  cells: string[]
}

export interface Summary {
  name: string
  title: string
  kicker: string
  bits: string[]
  tiles: Tile[]
  left: { label: string; rows: Row[]; side?: number }
  right: { label: string; rows: Row[]; side?: number }
  players: { label: string; head: string[]; rows: PlayerRow[] }
  pool: { map: string; played: number; won: number; current: boolean }[]
}

function ramp(v: number): [number, number, number, number] {
  const x = Math.min(0.9999, Math.max(0, v)) * (RAMP.length - 1)
  const i = Math.floor(x)
  const t = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null
  const img = new Image()
  img.src = src
  try {
    await img.decode()
    return img
  } catch {
    return null
  }
}

// Assets: fonts, icons and the logo all have to be in before drawing.

let logoSvg: Promise<string | null> | null = null
const logos = new Map<number, Promise<HTMLImageElement | null>>()

// logoAt rasterises the lockup at the pixel height it is drawn at, so it
// stays sharp. The SVG gets an explicit size, some browsers need one.
function logoAt(h: number): Promise<HTMLImageElement | null> {
  let p = logos.get(h)
  if (!p) {
    logoSvg ??= fetch(logoUrl)
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null)
    p = logoSvg.then((svg) => {
      if (!svg) return loadImage(logoUrl)
      const w = Math.round(h * LOGO_RATIO)
      const sized = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
        const clean = attrs.replace(/\s(width|height)\s*=\s*"[^"]*"/g, '')
        return `<svg${clean} width="${w}" height="${h}">`
      })
      return loadImage(URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' })))
    })
    logos.set(h, p)
  }
  return p
}

async function fontsReady() {
  const fonts = document.fonts
  if (!fonts) return
  const faces = [`700 64px ${DISPLAY}`, `600 24px ${DISPLAY}`, `500 20px ${DISPLAY}`, `500 20px ${FONT}`, `600 20px ${FONT}`]
  await Promise.all(faces.map((f) => fonts.load(f).catch(() => [])))
  await fonts.ready
}

async function iconsReady(names: string[]) {
  await icons.load()
  const deadline = performance.now() + 5000
  for (;;) {
    // Asking for a bitmap starts the download.
    const missing = names.filter((n) => icons.has(n) && !iconBitmap(n, null, 16))
    if (!missing.length || performance.now() > deadline) return
    await new Promise<void>((done) => {
      const off = onIconLoad(() => {
        off()
        done()
      })
      setTimeout(() => {
        off()
        done()
      }, 200)
    })
  }
}

export async function assets(S: number): Promise<HTMLImageElement | null> {
  const [img] = await Promise.all([logoAt(Math.round(LOGO_H * (S / BASE))), fontsReady(), iconsReady(ICONS)])
  return img
}

// The map: one plate per floor, framed on the playable area.

type Box = [number, number, number, number]

interface Floor {
  canvas: HTMLCanvasElement
  outline: Path2D
  box: Box
}

export interface Stage {
  info: MapInfo
  floors: (Floor | null)[]
  labels: MapLabels
  box: Box
}

const plates = new Map<string, Promise<Floor | null>>()

function floorFrom(img: CanvasImageSource): Floor {
  const plate = makePlate(img)
  return { canvas: plate.canvas, outline: plate.outline, box: solidBox(img) }
}

function plateFor(url: string): Promise<Floor | null> {
  let p = plates.get(url)
  if (!p) {
    p = loadImage(url).then((img) => (img ? floorFrom(img) : null))
    plates.set(url, p)
  }
  return p
}

// solidBox is the part of the radar image that is playable area.
function solidBox(img: CanvasImageSource): Box {
  const c = canvas(RADAR, RADAR)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, RADAR, RADAR)
  const d = ctx.getImageData(0, 0, RADAR, RADAR).data
  let x0 = RADAR
  let y0 = RADAR
  let x1 = -1
  let y1 = -1
  for (let y = 2; y < RADAR - 2; y++) {
    for (let x = 2; x < RADAR - 2; x++) {
      if (d[(y * RADAR + x) * 4 + 3] < 128) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < x0 ? [0, 0, RADAR, RADAR] : [x0, y0, x1 + 1, y1 + 1]
}

// walkedFloor stands in for a missing radar image: the cells anyone in
// the data walked on, slightly grown.
function walkedFloor(grids: Float32Array[], n: number): Floor | null {
  const walked = new Uint8Array(n * n)
  let any = false
  for (const g of grids) {
    for (let i = 0; i < g.length; i++) {
      if (g[i] > 0) {
        walked[i] = 1
        any = true
      }
    }
  }
  if (!any) return null
  const small = canvas(n, n)
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(n, n)
  const R = 2
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!walked[y * n + x]) continue
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= n || ny >= n || dx * dx + dy * dy > R * R + 1) continue
          const o = (ny * n + nx) * 4
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 140
          img.data[o + 3] = 255
        }
      }
    }
  }
  sctx.putImageData(img, 0, 0)
  const big = canvas(RADAR, RADAR)
  const ctx = big.getContext('2d')!
  ctx.filter = 'blur(3px)'
  ctx.drawImage(small, 0, 0, RADAR, RADAR)
  ctx.filter = 'none'
  return floorFrom(big)
}

export async function stageFor(info: MapInfo, labels: MapLabels, grids: HeatGrid[]): Promise<Stage> {
  const floors = await Promise.all(info.levels.map((l) => (l.image ? plateFor(l.image) : Promise.resolve(null))))
  for (let i = 0; i < floors.length; i++) {
    if (floors[i]) continue
    const levels = grids.map((g) => g.levels[i]).filter((g): g is Float32Array => !!g)
    floors[i] = walkedFloor(levels, grids[0]?.size ?? GRID)
  }
  let box: Box | null = null
  for (const f of floors) {
    if (!f) continue
    box = box ? [Math.min(box[0], f.box[0]), Math.min(box[1], f.box[1]), Math.max(box[2], f.box[2]), Math.max(box[3], f.box[3])] : [...f.box]
  }
  const pad = 12
  const b = box ?? [0, 0, RADAR, RADAR]
  return { info, floors, labels, box: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] }
}

// gridOf bins points into a heat grid, for heat under marks.
export function gridOf(info: MapInfo, points: Vec3[]): HeatGrid {
  const bin = new Binner(info)
  const g = newGrid(info.levels.length)
  for (const p of points) bin.add(g, p[0], p[1], p[2])
  return g
}

// Heat: the grid is blurred, scaled to a high percentile so one crowded
// spot does not wash out the rest, and coloured with the app's ramp.

function blur(src: Float32Array, n: number, sigma: number): Float32Array {
  const R = Math.max(1, Math.ceil(sigma * 2.5))
  const k = new Float32Array(R * 2 + 1)
  let sum = 0
  for (let i = -R; i <= R; i++) {
    k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma))
    sum += k[i + R]
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  const tmp = new Float32Array(n * n)
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    const row = y * n
    for (let x = 0; x < n; x++) {
      const v = src[row + x]
      if (!v) continue
      const a = Math.max(0, x - R)
      const b = Math.min(n - 1, x + R)
      for (let j = a; j <= b; j++) tmp[row + j] += v * k[j - x + R]
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = tmp[y * n + x]
      if (!v) continue
      const a = Math.max(0, y - R)
      const b = Math.min(n - 1, y + R)
      for (let j = a; j <= b; j++) out[j * n + x] += v * k[j - y + R]
    }
  }
  return out
}

function percentile(v: Float32Array, q: number): number {
  let n = 0
  for (let i = 0; i < v.length; i++) if (v[i] > 1e-6) n++
  if (!n) return 0
  const used = new Float32Array(n)
  let k = 0
  for (let i = 0; i < v.length; i++) if (v[i] > 1e-6) used[k++] = v[i]
  used.sort()
  return used[Math.min(n - 1, Math.floor(n * q))]
}

function heatImage(grid: Float32Array, n: number, sigma: number, soft: boolean): HTMLCanvasElement | null {
  const v = blur(grid, n, sigma)
  // Sparse marks have no crowded spots to tame, scale them to the peak.
  const max = percentile(v, soft ? 0.999 : 0.985)
  if (!(max > 0)) return null
  const c = canvas(n, n)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(n, n)
  const cap = soft ? 0.62 : 0.92
  for (let i = 0; i < v.length; i++) {
    if (v[i] <= 1e-6) continue
    const [r, g, b, a] = ramp(Math.sqrt(Math.min(1, v[i] / max)))
    const o = i * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    // A still image can carry a little more colour than the live radar.
    img.data[o + 3] = Math.min(cap, a * HEAT_BOOST) * 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

let scratch: HTMLCanvasElement | null = null

function scratchCanvas(S: number): CanvasRenderingContext2D {
  if (!scratch || scratch.width !== S) scratch = canvas(S, S)
  const ctx = scratch.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, S, S)
  return ctx
}

// View maps radar pixels to image pixels.
interface View {
  k: number
  ox: number
  oy: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function font(ctx: CanvasRenderingContext2D, weight: number, size: number, u: number, spacing = 0, family = DISPLAY) {
  ctx.font = `${weight} ${Math.round(size * u)}px ${family}`
  setSpacing(ctx, spacing ? `${(spacing * size * u).toFixed(2)}px` : '0px')
}

function drawBackground(ctx: CanvasRenderingContext2D, S: number) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, S, S)
  // A soft light behind the map lifts it off the page.
  const g = ctx.createRadialGradient(S / 2, S * 0.52, S * 0.05, S / 2, S * 0.52, S * 0.62)
  g.addColorStop(0, 'rgba(36,42,52,0.42)')
  g.addColorStop(1, 'rgba(11,13,17,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
}

function drawGrid(ctx: CanvasRenderingContext2D, info: MapInfo, v: View, S: number, u: number) {
  const scale = info.scale || 5
  const step = (512 / scale) * v.k
  if (step < 8) return
  // World x = 0 and y = 0, so lines sit on round world coordinates.
  const ox = v.ox + (-info.posX / scale) * v.k
  const oy = v.oy + (info.posY / scale) * v.k
  const top = (MAP_TOP - 24) * u
  const bottom = S - (MAP_BOTTOM - 20) * u
  const minor = new Path2D()
  const major = new Path2D()
  for (let i = Math.ceil(-ox / step); ox + i * step <= S; i++) {
    const x = Math.round(ox + i * step) + 0.5
    const p = i % 4 === 0 ? major : minor
    p.moveTo(x, top)
    p.lineTo(x, bottom)
  }
  for (let i = Math.ceil((top - oy) / step); oy + i * step <= bottom; i++) {
    const y = Math.round(oy + i * step) + 0.5
    const p = i % 4 === 0 ? major : minor
    p.moveTo(0, y)
    p.lineTo(S, y)
  }
  // The grid fades out towards the header and the footer.
  const h = scratchCanvas(S)
  h.lineWidth = Math.max(1, u)
  h.strokeStyle = 'rgba(150,170,196,0.05)'
  h.stroke(minor)
  h.strokeStyle = 'rgba(150,170,196,0.09)'
  h.stroke(major)
  h.globalCompositeOperation = 'destination-in'
  const fade = h.createLinearGradient(0, top, 0, bottom)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(0.12, 'rgba(0,0,0,1)')
  fade.addColorStop(0.88, 'rgba(0,0,0,1)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  h.fillStyle = fade
  h.fillRect(0, 0, S, S)
  ctx.drawImage(h.canvas, 0, 0)
}

function drawFloor(ctx: CanvasRenderingContext2D, floor: Floor, v: View, u: number) {
  ctx.save()
  ctx.setTransform(v.k, 0, 0, v.k, v.ox, v.oy)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(floor.canvas, -PLATE_PAD, -PLATE_PAD)
  ctx.strokeStyle = 'rgba(196,210,228,0.62)'
  ctx.lineWidth = (1.4 * u) / v.k
  ctx.lineJoin = 'round'
  ctx.stroke(floor.outline)
  ctx.restore()
}

function drawHeat(ctx: CanvasRenderingContext2D, c: Card, floor: Floor | null, v: View, S: number) {
  if (!c.heat) return
  const img = heatImage(c.heat, c.heatSize, c.sigma, c.hits.length > 0)
  if (!img) return
  const h = scratchCanvas(S)
  h.setTransform(v.k, 0, 0, v.k, v.ox, v.oy)
  h.imageSmoothingEnabled = true
  h.imageSmoothingQuality = 'high'
  h.drawImage(img, 0, 0, RADAR, RADAR)
  // Keep the heat inside the playable area.
  if (floor) {
    h.globalCompositeOperation = 'destination-in'
    h.fill(floor.outline, 'evenodd')
    h.globalCompositeOperation = 'source-over'
  }
  ctx.drawImage(h.canvas, 0, 0)
}

// drawLabels draws the bombsite badges and the callouts that fit around
// what is already taken. Sites covered by plant marks skip their badge.
function drawLabels(ctx: CanvasRenderingContext2D, st: Stage, level: number, v: View, u: number, taken: Rect[], plants: Rect[], quiet: boolean) {
  const placed: Rect[] = [...taken]
  const R = 18 * u
  for (const s of st.labels.sites) {
    if (s.level !== level) continue
    const x = v.ox + s.x * v.k
    const y = v.oy + s.y * v.k
    const badge = { x: x - R, y: y - R, w: R * 2, h: R * 2 }
    if (plants.some((b) => overlaps(badge, b))) continue
    ctx.fillStyle = 'rgba(6,8,11,0.4)'
    circle(ctx, x, y + 1.5 * u, R + 2.5 * u)
    ctx.fill()
    ctx.fillStyle = 'rgba(11,13,17,0.94)'
    circle(ctx, x, y, R)
    ctx.fill()
    if (!drawIcon(ctx, `hud/bombsite-${s.name.toLowerCase()}`, x, y, R * 1.7, TEXT)) {
      ctx.fillStyle = TEXT
      font(ctx, 700, 22, u)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.name, x, y)
    }
    placed.push({ x: x - R - 4 * u, y: y - R - 4 * u, w: (R + 4 * u) * 2, h: (R + 4 * u) * 2 })
  }
  font(ctx, 600, 14, u, 0.07)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const c of st.labels.callouts) {
    if (c.level !== level) continue
    const text = c.name.toUpperCase()
    const x = v.ox + c.x * v.k
    const y = v.oy + c.y * v.k
    const w = ctx.measureText(text).width + 8 * u
    const box = { x: x - w / 2, y: y - 10 * u, w, h: 20 * u }
    if (placed.some((b) => overlaps(box, b))) continue
    placed.push(box)
    ctx.lineWidth = 3.5 * u
    ctx.strokeStyle = 'rgba(11,13,17,0.72)'
    ctx.strokeText(text, x, y)
    ctx.fillStyle = quiet ? 'rgba(170,179,190,0.7)' : 'rgba(190,198,208,0.92)'
    ctx.fillText(text, x, y)
  }
  setSpacing(ctx, '0px')
}

// Marks: grenades, plants and kill marks in image pixels.

interface Mark {
  type: number
  x: number
  y: number
  on: boolean
  fx: number
  fy: number
  from: boolean
}

interface Cluster {
  type: number
  x: number
  y: number
  n: number
  on: boolean
}

// cluster merges marks of one kind that landed close together, so a smoke
// thrown to the same spot every round shows as one badge with a count.
function cluster(marks: Mark[], d: number): Cluster[] {
  const out: Cluster[] = []
  for (const m of marks) {
    const hit = out.find((c) => c.type === m.type && c.on === m.on && (c.x - m.x) ** 2 + (c.y - m.y) ** 2 < d * d)
    if (hit) {
      hit.x += (m.x - hit.x) / (hit.n + 1)
      hit.y += (m.y - hit.y) / (hit.n + 1)
      hit.n++
    } else {
      out.push({ type: m.type, x: m.x, y: m.y, on: m.on, n: 1 })
    }
  }
  return out
}

function nadeType(t: number): number {
  return t === EQ.incendiary ? EQ.molotov : t
}

interface Layout {
  marks: Mark[]
  clusters: Cluster[]
  plants: Cluster[]
  hits: { x: number; y: number; tx: number; ty: number; to: boolean; on: boolean; shape: Shape; color: string }[]
  R: number
  P: number
}

function layoutMarks(c: Card, info: MapInfo, v: View, u: number): Layout {
  const scale = info.scale || 5
  const px = (p: Vec3) => v.ox + ((p[0] - info.posX) / scale) * v.k
  const py = (p: Vec3) => v.oy + ((info.posY - p[1]) / scale) * v.k
  const on = (p: Vec3) => levelOf(info, p[2]) === c.level
  // Busy maps get smaller badges that merge more.
  const busy = c.utility.length > 50
  const R = (busy ? 11 : 13) * u
  const marks: Mark[] = c.utility.map((g) => ({
    type: nadeType(g.type),
    x: px(g.pos),
    y: py(g.pos),
    on: on(g.pos),
    fx: g.from ? px(g.from) : 0,
    fy: g.from ? py(g.from) : 0,
    from: !!g.from,
  }))
  return {
    marks,
    clusters: cluster(marks, R * (busy ? 2.4 : 1.7)),
    plants: cluster(
      c.plants.map((p) => ({ type: EQ.bomb, x: px(p), y: py(p), on: on(p), fx: 0, fy: 0, from: false })),
      14 * u,
    ),
    hits: c.hits.map((h) => ({
      x: px(h.at),
      y: py(h.at),
      tx: h.to ? px(h.to) : 0,
      ty: h.to ? py(h.to) : 0,
      to: !!h.to,
      on: on(h.at),
      shape: h.shape,
      color: h.color,
    })),
    R,
    P: 10 * u,
  }
}

function markRects(l: Layout): { taken: Rect[]; plants: Rect[] } {
  const box = (m: { x: number; y: number }, r: number) => ({ x: m.x - r, y: m.y - r, w: r * 2, h: r * 2 })
  const plants = l.plants.filter((p) => p.on).map((p) => box(p, l.P))
  return { taken: [...l.clusters.map((c) => box(c, l.R + 3)), ...plants, ...l.hits.filter((h) => h.on).map((h) => box(h, 9))], plants }
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x - r, y - r)
  ctx.lineTo(x + r, y + r)
  ctx.moveTo(x + r, y - r)
  ctx.lineTo(x - r, y + r)
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, color: string, u: number) {
  ctx.lineCap = 'round'
  if (shape === 'x') {
    const r = 6.5 * u
    ctx.strokeStyle = EDGE
    ctx.lineWidth = 6.5 * u
    cross(ctx, x, y, r)
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 3 * u
    cross(ctx, x, y, r)
    ctx.stroke()
    return
  }
  ctx.fillStyle = EDGE
  circle(ctx, x, y, 7.5 * u)
  ctx.fill()
  ctx.fillStyle = color
  circle(ctx, x, y, 5.2 * u)
  ctx.fill()
}

function drawHits(ctx: CanvasRenderingContext2D, l: Layout, u: number) {
  if (!l.hits.length) return
  // Lines to the other player first, faint, so the marks sit on top.
  const many = l.hits.length > 60
  ctx.lineCap = 'round'
  for (const h of l.hits) {
    if (!h.to) continue
    ctx.globalAlpha = (h.on ? 1 : 0.4) * (many ? 0.16 : 0.26)
    ctx.strokeStyle = h.color
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.moveTo(h.x, h.y)
    ctx.lineTo(h.tx, h.ty)
    ctx.stroke()
  }
  for (const h of l.hits) {
    ctx.globalAlpha = h.on ? 1 : 0.35
    drawShape(ctx, h.shape, h.x, h.y, h.color, u)
  }
  ctx.globalAlpha = 1
}

export function nadeBadge(ctx: CanvasRenderingContext2D, x: number, y: number, type: number, R: number, u: number) {
  ctx.fillStyle = 'rgba(6,8,11,0.45)'
  circle(ctx, x, y + 1.5 * u, R + 1.5 * u)
  ctx.fill()
  ctx.fillStyle = SHADE
  circle(ctx, x, y, R)
  ctx.fill()
  ctx.lineWidth = 2 * u
  ctx.strokeStyle = NADE_COLOR[type] ?? TEXT_2
  ctx.stroke()
  drawIcon(ctx, NADE_ICON[type] ?? null, x, y, R * 1.25, TEXT)
}

export function c4Mark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, u: number) {
  ctx.fillStyle = SHADE
  circle(ctx, x, y, r)
  ctx.fill()
  ctx.lineWidth = 1.5 * u
  ctx.strokeStyle = ACCENT
  ctx.stroke()
  if (!drawIcon(ctx, 'weapon/c4', x, y, r * 1.05, TEXT)) {
    ctx.fillStyle = ACCENT
    circle(ctx, x, y, 3 * u)
    ctx.fill()
  }
}

function drawUtility(ctx: CanvasRenderingContext2D, c: Card, l: Layout, info: MapInfo, v: View, u: number) {
  const scale = info.scale || 5
  if (c.areas) {
    // Smoke and fire areas first, they stack up where the same spot is
    // used every round.
    for (const m of l.marks) {
      const smoke = m.type === EQ.smoke
      if (!smoke && m.type !== EQ.molotov) continue
      const r = ((smoke ? SMOKE_RADIUS : FIRE_RADIUS) / scale) * v.k
      ctx.globalAlpha = m.on ? 1 : 0.4
      ctx.fillStyle = smoke ? 'rgba(201,209,217,0.07)' : 'rgba(255,138,61,0.08)'
      circle(ctx, m.x, m.y, r)
      ctx.fill()
      ctx.lineWidth = 1.25 * u
      ctx.strokeStyle = smoke ? 'rgba(201,209,217,0.3)' : 'rgba(255,138,61,0.36)'
      ctx.stroke()
    }
  }
  if (c.lines) {
    // Where each grenade was thrown from, so lineups show.
    ctx.lineCap = 'round'
    for (const m of l.marks) {
      if (!m.from) continue
      const col = NADE_COLOR[m.type] ?? TEXT_2
      ctx.globalAlpha = (m.on ? 1 : 0.4) * 0.34
      ctx.strokeStyle = col
      ctx.lineWidth = 1.4 * u
      ctx.beginPath()
      ctx.moveTo(m.fx, m.fy)
      ctx.lineTo(m.x, m.y)
      ctx.stroke()
      ctx.globalAlpha = (m.on ? 1 : 0.4) * 0.8
      ctx.fillStyle = EDGE
      circle(ctx, m.fx, m.fy, 3.6 * u)
      ctx.fill()
      ctx.fillStyle = col
      circle(ctx, m.fx, m.fy, 2.2 * u)
      ctx.fill()
    }
  }
  for (const p of l.plants) {
    ctx.globalAlpha = p.on ? 1 : 0.4
    c4Mark(ctx, p.x, p.y, l.P, u)
    if (p.n > 1) countBubble(ctx, p.x + l.P * 0.8, p.y - l.P, p.n, u)
  }
  const R = l.R
  for (const cl of l.clusters) {
    ctx.globalAlpha = cl.on ? 1 : 0.45
    nadeBadge(ctx, cl.x, cl.y, cl.type, R, u)
    if (cl.n > 1) countBubble(ctx, cl.x + R * 0.75, cl.y - R * 0.95, cl.n, u)
  }
  ctx.globalAlpha = 1
}

// countBubble is the small white count on a merged badge.
function countBubble(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, u: number) {
  const text = `${n}`
  font(ctx, 700, 13, u)
  const w = Math.max(18 * u, ctx.measureText(text).width + 10 * u)
  const h = 17 * u
  ctx.fillStyle = TEXT
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = BG
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5 * u)
}

// Header and footer.

interface Head {
  title: string
  kicker: string
  side: number
  bits: string[]
}

function drawLogo(ctx: CanvasRenderingContext2D, S: number, u: number, logoImg: HTMLImageElement | null) {
  if (!logoImg) return
  const h = Math.round(LOGO_H * u)
  const w = h * LOGO_RATIO
  // The wordmark's baseline sits on the title baseline and its top on
  // the title's cap height, the figure's feet hang below like a
  // descender.
  const y = TITLE_Y * u - WORD_BASE * h
  ctx.globalAlpha = LOGO_ALPHA
  ctx.drawImage(logoImg, Math.round(S - M * u - w), Math.round(y), Math.round(w), h)
  ctx.globalAlpha = 1
}

// logoLeft is where the logo starts, text keeps clear of it.
function logoLeft(S: number, u: number): number {
  return S - M * u - LOGO_H * u * LOGO_RATIO - 40 * u
}

function sideChip(ctx: CanvasRenderingContext2D, side: number, x: number, y: number, u: number): number {
  const tc = teamColor(side)
  const text = side === 3 ? 'CT SIDE' : 'T SIDE'
  font(ctx, 700, 16, u, 0.1)
  const icon = 26 * u
  const w = ctx.measureText(text).width + icon + 30 * u
  const h = 36 * u
  ctx.fillStyle = `rgba(${tc.rgb},0.14)`
  roundRect(ctx, x, y - h / 2, w, h, 4 * u)
  ctx.fill()
  ctx.lineWidth = Math.max(1, u)
  ctx.strokeStyle = `rgba(${tc.rgb},0.5)`
  roundRect(ctx, x + 0.5 * u, y - h / 2 + 0.5 * u, w - u, h - u, 3.5 * u)
  ctx.stroke()
  const drawn = drawIcon(ctx, side === 3 ? 'kill/ct' : 'kill/t', x + 6 * u + icon / 2, y, icon, null)
  ctx.fillStyle = tc.light
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + (drawn ? icon + 14 * u : 12 * u), y + 1 * u)
  return drawn ? w : w - icon - 2 * u
}

function drawHeader(ctx: CanvasRenderingContext2D, c: Head, S: number, u: number, logoImg: HTMLImageElement | null) {
  const x0 = M * u
  const max = logoLeft(S, u) - x0
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // The map in grey, what the image shows in a brighter tone.
  font(ctx, 600, 17, u, 0.16)
  const [head, ...rest] = c.kicker.toUpperCase().split(' · ')
  ctx.fillStyle = TEXT_3
  ctx.fillText(rest.length ? `${head}  ·` : head, x0, KICKER_Y * u)
  if (rest.length) {
    const sep = `${head}  ·  `
    const w = ctx.measureText(sep).width
    ctx.fillStyle = TEXT_2
    ctx.fillText(fitText(ctx, rest.join(' · '), max - w), x0 + w, KICKER_Y * u)
  }

  font(ctx, 700, TITLE_SIZE, u, -0.005)
  ctx.fillStyle = TEXT
  ctx.fillText(fitText(ctx, c.title, max), x0 - 3 * u, TITLE_Y * u)

  let x = x0
  const y = SUB_Y * u
  if (c.side === 2 || c.side === 3) x += sideChip(ctx, c.side, x, y, u) + 18 * u
  font(ctx, 600, 23, u, 0.01)
  ctx.fillStyle = TEXT_2
  ctx.textBaseline = 'middle'
  ctx.fillText(fitText(ctx, c.bits.filter(Boolean).join('   ·   '), S - M * u - x), x, y + 1 * u)
  setSpacing(ctx, '0px')
  ctx.textBaseline = 'alphabetic'
  drawLogo(ctx, S, u, logoImg)
}

function drawFooterLine(ctx: CanvasRenderingContext2D, cx: Context, S: number, u: number) {
  const y = S - RULE * u
  ctx.fillStyle = LINE
  ctx.fillRect(M * u, Math.round(y), S - 2 * M * u, Math.max(1, Math.round(u)))
  const ty = S - LINE_Y * u
  font(ctx, 600, 15, u, 0.12)
  ctx.textBaseline = 'alphabetic'
  // Results on the right: W 13-6, L 9-13.
  let right = S - M * u
  ctx.textAlign = 'right'
  const shown = cx.results.slice(0, 8)
  for (let i = shown.length - 1; i >= 0; i--) {
    const r = shown[i]
    ctx.fillStyle = TEXT_2
    ctx.fillText(r.score, right, ty)
    right -= ctx.measureText(r.score).width + 7 * u
    const tag = r.won === true ? 'W' : r.won === false ? 'L' : 'D'
    ctx.fillStyle = r.won === true ? GOOD : r.won === false ? BAD : TEXT_3
    ctx.fillText(tag, right, ty)
    right -= ctx.measureText(tag).width + 24 * u
  }
  if (cx.results.length > shown.length) {
    ctx.fillStyle = TEXT_3
    const more = `+${cx.results.length - shown.length}`
    ctx.fillText(more, right, ty)
    right -= ctx.measureText(more).width + 24 * u
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_3
  ctx.fillText(fitText(ctx, cx.line.toUpperCase(), right - M * u - 20 * u), M * u, ty)
  setSpacing(ctx, '0px')
}

// Legend, right aligned in the footer band. Returns its left edge.
function drawLegend(ctx: CanvasRenderingContext2D, c: Card, S: number, u: number): number {
  let right = S - M * u
  const labelY = S - FOOT_LABEL * u
  const midY = S - FOOT_VALUE * u - 12 * u
  const nameY = S - FOOT_NAME * u
  if (c.heat) {
    const w = 210 * u
    const bx = right - w
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 600, 15, u, 0.14)
    ctx.fillStyle = TEXT_3
    ctx.fillText(c.heatLabel.toUpperCase(), right, labelY)
    const bh = 10 * u
    ctx.fillStyle = SURFACE_2
    roundRect(ctx, bx, midY - bh / 2, w, bh, 2 * u)
    ctx.fill()
    const g = ctx.createLinearGradient(bx, 0, bx + w, 0)
    RAMP.forEach(([r, gg, b, a], i) => g.addColorStop(i / (RAMP.length - 1), `rgba(${r},${gg},${b},${Math.min(1, a * 1.2)})`))
    ctx.fillStyle = g
    roundRect(ctx, bx, midY - bh / 2, w, bh, 2 * u)
    ctx.fill()
    font(ctx, 600, 13, u, 0.12)
    ctx.fillStyle = TEXT_3
    ctx.textAlign = 'left'
    ctx.fillText('LESS', bx, nameY)
    ctx.textAlign = 'right'
    ctx.fillText('MORE', right, nameY)
    right = bx - 52 * u
  }
  if (!c.legend.length) return right + 52 * u
  // Mark legend: two rows, filled column by column from the right.
  font(ctx, 600, 14, u, 0.08)
  const rows = [midY, nameY - 5 * u]
  const sym = 24 * u
  const items = c.legend.map((it) => ({ it, w: sym + 10 * u + ctx.measureText(it.label.toUpperCase()).width }))
  const cols: (typeof items)[] = []
  for (let i = 0; i < items.length; i += 2) cols.push(items.slice(i, i + 2))
  let x = right
  for (let k = cols.length - 1; k >= 0; k--) {
    const col = cols[k]
    const cw = Math.max(...col.map((c) => c.w))
    const left = x - cw
    col.forEach(({ it }, r) => {
      const y = rows[r]
      const cxs = left + sym / 2
      legendSymbol(ctx, it, cxs, y, sym, u)
      font(ctx, 600, 14, u, 0.08)
      ctx.fillStyle = TEXT_2
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(it.label.toUpperCase(), left + sym + 10 * u, y + 1 * u)
    })
    x = left - 30 * u
  }
  ctx.textBaseline = 'alphabetic'
  setSpacing(ctx, '0px')
  font(ctx, 600, 15, u, 0.14)
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_3
  ctx.fillText('ON THE MAP', x + 30 * u, labelY)
  setSpacing(ctx, '0px')
  return x + 30 * u
}

function legendSymbol(ctx: CanvasRenderingContext2D, it: LegendItem, x: number, y: number, sym: number, u: number) {
  if ('shape' in it) drawShape(ctx, it.shape, x, y, it.color, u)
  else if ('nade' in it) nadeBadge(ctx, x, y, it.nade, 11 * u, u)
  else if ('c4' in it) c4Mark(ctx, x, y, 10 * u, u)
  else {
    ctx.strokeStyle = it.line
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.6 * u
    ctx.beginPath()
    ctx.moveTo(x - sym / 2, y + 5 * u)
    ctx.lineTo(x + sym / 2, y - 5 * u)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = EDGE
    circle(ctx, x - sym / 2, y + 5 * u, 3.6 * u)
    ctx.fill()
    ctx.fillStyle = it.line
    circle(ctx, x - sym / 2, y + 5 * u, 2.2 * u)
    ctx.fill()
  }
}

// drawStats writes the numbers along the bottom, left to right, as far
// as they fit before the legend.
function drawStats(ctx: CanvasRenderingContext2D, groups: Group[], S: number, u: number, right: number) {
  const labelY = S - FOOT_LABEL * u
  const valueY = S - FOOT_VALUE * u
  const nameY = S - FOOT_NAME * u
  const gap = 38 * u
  let x = M * u
  for (const group of groups) {
    if (!group.stats.length) continue
    const start = x
    const drawn: { stat: Stat; x: number }[] = []
    let end = x
    for (const s of group.stats) {
      font(ctx, 700, 40, u)
      const iconW = s.icon ? 30 * u * icons.aspect(s.icon) + 8 * u : 0
      const vw = ctx.measureText(s.value).width + iconW
      font(ctx, 600, 14, u, 0.08)
      const lw = Math.min(ctx.measureText(s.label.toUpperCase()).width, 300 * u)
      const w = Math.max(vw, lw)
      if (x + w > right) break
      drawn.push({ stat: s, x })
      end = x + w
      x += w + gap
    }
    if (!drawn.length) break
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 600, 15, u, 0.14)
    ctx.fillStyle = TEXT_3
    ctx.fillText(fitText(ctx, group.label.toUpperCase(), Math.max(end - start, right - start)), start, labelY)
    for (const { stat, x: sx } of drawn) {
      let vx = sx
      if (stat.icon) {
        const ih = 30 * u
        const w = drawIcon(ctx, stat.icon, sx + (ih * icons.aspect(stat.icon)) / 2, valueY - 14 * u, ih, stat.tint ?? TEXT)
        if (w) vx += w + 8 * u
      }
      font(ctx, 700, 40, u)
      ctx.fillStyle = stat.tint && !stat.icon ? stat.tint : TEXT
      ctx.fillText(stat.value, vx, valueY)
      font(ctx, 600, 14, u, 0.08)
      ctx.fillStyle = TEXT_2
      ctx.fillText(fitText(ctx, stat.label.toUpperCase(), 300 * u), sx, nameY)
    }
    x += 32 * u
  }
  setSpacing(ctx, '0px')
}

export function compose(c: Card, cx: Context, st: Stage, S: number, logoImg: HTMLImageElement | null): HTMLCanvasElement {
  const out = canvas(S, S)
  const ctx = out.getContext('2d')!
  const u = S / BASE
  drawBackground(ctx, S)

  // The map fills the room between the header and the footer band.
  const top = MAP_TOP * u
  const bottom = S - MAP_BOTTOM * u
  const left = (M - 24) * u
  const width = S - 2 * left
  const [x0, y0, x1, y1] = st.box
  const k = Math.min(width / (x1 - x0), (bottom - top) / (y1 - y0))
  const v: View = {
    k,
    ox: left + (width - (x1 - x0) * k) / 2 - x0 * k,
    oy: top + (bottom - top - (y1 - y0) * k) / 2 - y0 * k,
  }
  drawGrid(ctx, st.info, v, S, u)
  const floor = st.floors[c.level] ?? st.floors[0] ?? null
  if (floor) drawFloor(ctx, floor, v, u)
  drawHeat(ctx, c, floor, v, S)
  const l = layoutMarks(c, st.info, v, u)
  const rects = markRects(l)
  drawLabels(ctx, st, c.level, v, u, rects.taken, rects.plants, l.hits.length + l.marks.length > 40)
  drawUtility(ctx, c, l, st.info, v, u)
  drawHits(ctx, l, u)
  drawHeader(ctx, c, S, u, logoImg)
  const legendLeft = drawLegend(ctx, c, S, u)
  drawStats(ctx, c.footer, S, u, legendLeft - 48 * u)
  drawFooterLine(ctx, cx, S, u)
  return out
}

// The summary poster: no map, just the numbers.

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number) {
  ctx.fillStyle = SURFACE
  roundRect(ctx, x, y, w, h, 6 * u)
  ctx.fill()
  ctx.lineWidth = Math.max(1, u)
  ctx.strokeStyle = LINE
  roundRect(ctx, x + 0.5 * u, y + 0.5 * u, w - u, h - u, 5.5 * u)
  ctx.stroke()
}

function panelLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, u: number) {
  font(ctx, 600, 15, u, 0.14)
  ctx.fillStyle = TEXT_3
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text.toUpperCase(), x, y)
  setSpacing(ctx, '0px')
}

function drawTile(ctx: CanvasRenderingContext2D, t: Tile, x: number, y: number, w: number, h: number, u: number) {
  panel(ctx, x, y, w, h, u)
  const pad = 28 * u
  if (t.side === 2 || t.side === 3) {
    const tc = teamColor(t.side)
    ctx.fillStyle = tc.base
    ctx.fillRect(x + pad, y, 44 * u, 3 * u)
    drawIcon(ctx, t.side === 3 ? 'kill/ct' : 'kill/t', x + w - pad - 14 * u, y + 40 * u, 28 * u, null)
  }
  panelLabel(ctx, t.label, x + pad, y + 46 * u, u)
  font(ctx, 700, 64, u, -0.01)
  ctx.fillStyle = TEXT
  ctx.fillText(t.value, x + pad - 2 * u, y + 122 * u)
  font(ctx, 500, 19, u, 0, FONT)
  ctx.fillStyle = TEXT_2
  ctx.fillText(fitText(ctx, t.note, w - 2 * pad), x + pad, y + 156 * u)
}

function drawRows(ctx: CanvasRenderingContext2D, block: { label: string; rows: Row[]; side?: number }, x: number, y: number, w: number, h: number, u: number) {
  panel(ctx, x, y, w, h, u)
  const pad = 28 * u
  panelLabel(ctx, block.label, x + pad, y + 46 * u, u)
  if (block.side === 2 || block.side === 3) {
    ctx.fillStyle = teamColor(block.side).base
    ctx.fillRect(x + pad, y, 44 * u, 3 * u)
    drawIcon(ctx, block.side === 3 ? 'kill/ct' : 'kill/t', x + w - pad - 14 * u, y + 40 * u, 28 * u, null)
  }
  let ry = y + 78 * u
  const rowH = 74 * u
  // Rows line up with the ones that carry a site badge.
  const indent = block.rows.some((r) => r.site) ? 52 * u : 0
  for (const row of block.rows) {
    if (ry + rowH > y + h - 12 * u) break
    let tx = x + pad
    if (!row.site) tx += indent
    if (row.site) {
      const R = 17 * u
      ctx.fillStyle = 'rgba(11,13,17,0.94)'
      circle(ctx, tx + R, ry + rowH / 2 - 4 * u, R)
      ctx.fill()
      if (!drawIcon(ctx, `hud/bombsite-${row.site.toLowerCase()}`, tx + R, ry + rowH / 2 - 4 * u, R * 1.7, TEXT)) {
        font(ctx, 700, 22, u)
        ctx.fillStyle = TEXT
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(row.site, tx + R, ry + rowH / 2 - 4 * u)
      }
      tx += R * 2 + 18 * u
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    font(ctx, 700, 34, u)
    ctx.fillStyle = TEXT
    ctx.fillText(row.value, tx, ry + 36 * u)
    const vw = Math.max(ctx.measureText(row.value).width, 78 * u)
    font(ctx, 600, 20, u, 0.01)
    ctx.fillStyle = TEXT
    const lx = tx + vw + 18 * u
    ctx.fillText(fitText(ctx, row.label, x + w - pad - lx), lx, ry + 24 * u)
    font(ctx, 500, 17, u, 0, FONT)
    ctx.fillStyle = TEXT_2
    ctx.fillText(fitText(ctx, row.note, x + w - pad - lx), lx, ry + 48 * u)
    if (row.share !== undefined) {
      const bw = x + w - pad - tx
      const by = ry + rowH - 16 * u
      ctx.fillStyle = SURFACE_2
      ctx.fillRect(tx, by, bw, 4 * u)
      ctx.fillStyle = row.side ? teamColor(row.side).base : TEXT_2
      ctx.fillRect(tx, by, bw * Math.max(0, Math.min(1, row.share)), 4 * u)
    }
    ry += rowH
  }
  if (!block.rows.length) {
    font(ctx, 500, 19, u, 0, FONT)
    ctx.fillStyle = TEXT_3
    ctx.textAlign = 'left'
    ctx.fillText('Not enough rounds yet.', x + pad, y + 100 * u)
  }
}

function drawPlayers(ctx: CanvasRenderingContext2D, p: Summary['players'], x: number, y: number, w: number, h: number, u: number) {
  panel(ctx, x, y, w, h, u)
  const pad = 28 * u
  panelLabel(ctx, p.label, x + pad, y + 46 * u, u)
  // Name column, then equal columns.
  const nameW = 300 * u
  const colW = (w - 2 * pad - nameW) / Math.max(1, p.head.length)
  font(ctx, 600, 14, u, 0.12)
  ctx.fillStyle = TEXT_3
  ctx.textAlign = 'left'
  p.head.forEach((hd, i) => ctx.fillText(hd.toUpperCase(), x + pad + nameW + i * colW, y + 92 * u))
  setSpacing(ctx, '0px')
  const rowH = Math.min(62 * u, (h - 120 * u) / Math.max(1, p.rows.length))
  let ry = y + 110 * u
  for (const row of p.rows) {
    ctx.fillStyle = LINE
    ctx.fillRect(x + pad, Math.round(ry), w - 2 * pad, Math.max(1, Math.round(u)))
    const by = ry + rowH / 2 + 8 * u
    font(ctx, 700, 26, u)
    ctx.fillStyle = TEXT
    ctx.fillText(fitText(ctx, row.name, nameW - 20 * u), x + pad, by)
    font(ctx, 500, 19, u, 0, FONT)
    ctx.fillStyle = TEXT_2
    row.cells.forEach((cell, i) => ctx.fillText(fitText(ctx, cell, colW - 16 * u), x + pad + nameW + i * colW, by))
    ry += rowH
  }
}

function drawPool(ctx: CanvasRenderingContext2D, pool: Summary['pool'], x: number, y: number, w: number, u: number) {
  panelLabel(ctx, 'Map pool', x, y, u)
  let cx = x + 150 * u
  const cy = y - 8 * u
  for (const m of pool) {
    const name = m.map.replace(/^(de|cs|ar)_/, '')
    const label = `${name.charAt(0).toUpperCase()}${name.slice(1)}`
    const note = `${m.played} played · ${m.won} won`
    font(ctx, 700, 20, u)
    const lw = ctx.measureText(label).width
    font(ctx, 500, 16, u, 0, FONT)
    const nw = ctx.measureText(note).width
    const cw = lw + nw + 44 * u
    if (cx + cw > x + w) break
    const ch = 40 * u
    ctx.fillStyle = m.current ? 'rgba(236,239,243,0.1)' : SURFACE
    roundRect(ctx, cx, cy - ch / 2, cw, ch, 4 * u)
    ctx.fill()
    ctx.lineWidth = Math.max(1, u)
    ctx.strokeStyle = m.current ? 'rgba(236,239,243,0.35)' : LINE
    roundRect(ctx, cx + 0.5 * u, cy - ch / 2 + 0.5 * u, cw - u, ch - u, 3.5 * u)
    ctx.stroke()
    ctx.textBaseline = 'middle'
    font(ctx, 700, 20, u)
    ctx.fillStyle = TEXT
    ctx.fillText(label, cx + 16 * u, cy + 1 * u)
    font(ctx, 500, 16, u, 0, FONT)
    ctx.fillStyle = TEXT_2
    ctx.fillText(note, cx + 28 * u + lw, cy + 1 * u)
    ctx.textBaseline = 'alphabetic'
    cx += cw + 12 * u
  }
}

export function composeSummary(s: Summary, cx: Context, S: number, logoImg: HTMLImageElement | null): HTMLCanvasElement {
  const out = canvas(S, S)
  const ctx = out.getContext('2d')!
  const u = S / BASE
  drawBackground(ctx, S)
  drawHeader(ctx, { title: s.title, kicker: s.kicker, side: 0, bits: s.bits }, S, u, logoImg)
  const x = M * u
  const w = S - 2 * x
  const gap = 24 * u
  let y = 282 * u
  // Tiles.
  const n = Math.max(1, s.tiles.length)
  const tw = (w - gap * (n - 1)) / n
  const th = 186 * u
  s.tiles.forEach((t, i) => drawTile(ctx, t, x + i * (tw + gap), y, tw, th, u))
  y += th + gap
  // Two blocks side by side.
  const bh = 466 * u
  const bw = (w - gap) / 2
  drawRows(ctx, s.left, x, y, bw, bh, u)
  drawRows(ctx, s.right, x + bw + gap, y, bw, bh, u)
  y += bh + gap
  // Players, down to the map pool line.
  const poolH = s.pool.length ? 70 * u : 0
  const ph = S - RULE * u - 36 * u - poolH - y
  drawPlayers(ctx, s.players, x, y, w, ph, u)
  if (s.pool.length) drawPool(ctx, s.pool, x, S - RULE * u - 46 * u, w, u)
  drawFooterLine(ctx, cx, S, u)
  return out
}
