import { ACCENT, BAD, BG, EVIDENCE, GOOD, TEXT, teamColor, type TeamColors } from '../colors'
import { drawIcon, icons, weaponIcon } from '../icons.svelte'
import { PLATE_PAD, type MapView } from '../mapview'
import { BOMB, FLAG, emptyState, type PlayerState, type Replay } from '../replay'
import type { BombEvent } from '../types'
import { EQ } from '../weapons'
import { Camera } from './camera'
import { DISPLAY, EDGE, FONT, SHADE, centreText, circle, flameSprite, mix, pill, roundRect, setSpacing, smokeSprite } from './draw'

// Other components still import these from here.
export { teamColor, SLOT_COLORS } from '../colors'

export interface ViewOptions {
  follow: number
  rotate: boolean
  teamVision: boolean
  names: boolean
  cones: 'all' | 'follow' | 'none'
  shots: boolean
  paths: boolean
  callouts: boolean
  evidence: boolean
  layer: number
  ghosts: number
  heat: HTMLCanvasElement | null
  focus: number[]
}

const SMOKE_RADIUS = 144
const FIRE_RADIUS = 60
const HE_RADIUS = 280
const CONE_LENGTH = 650
const FOV = (90 * Math.PI) / 180
const WARN = '#f59a3c'
const PLANT_TIME = 3.2
const CHIP_H = 16

const NADE_ICON: Record<number, string> = {
  [EQ.smoke]: 'weapon/smokegrenade',
  [EQ.flash]: 'weapon/flashbang',
  [EQ.he]: 'weapon/hegrenade',
  [EQ.molotov]: 'weapon/molotov',
  [EQ.incendiary]: 'weapon/incgrenade',
  [EQ.decoy]: 'weapon/decoy',
}

export interface Hit {
  kind: 'player' | 'blunder'
  id: number
  x: number
  y: number
  r: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

// Frame collects what is on screen this frame so text can keep clear of it.
interface Frame {
  tokens: Box[]
  // Badges, pills, the bomb and evidence. Name tags keep clear of these.
  solid: Box[]
  // Grenades in flight, only callouts make room for them.
  soft: Box[]
  tags: Box[]
}

// Person is a live player placed on screen.
interface Person {
  p: number
  s: PlayerState
  x: number
  y: number
  r: number
  a: number
  alpha: number
  hidden: boolean
}

interface Label {
  text: string
  x: number
  y: number
  r: number
  alpha: number
  followed: boolean
  rank: number
}

// Chip is a group of evidence markers on the same spot.
interface Chip {
  x: number
  y: number
  sy: number
  w: number
  spots: [number, number][]
  items: { id: number; n: number; w: number }[]
}

// Shading for a team's tokens, worked out once.
interface Tint {
  top: string
  bottom: string
}

const tints = new Map<number, Tint>()

function tint(side: number): Tint {
  let t = tints.get(side)
  if (!t) {
    const c = teamColor(side)
    t = { top: mix(c.base, c.light, 0.28), bottom: mix(c.base, c.deep, 0.32) }
    tints.set(side, t)
  }
  return t
}

export class Renderer {
  readonly cam = new Camera()
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private states: PlayerState[]
  private ghost = emptyState()
  private hits: Hit[] = []
  private smoke: HTMLCanvasElement
  private flame: HTMLCanvasElement
  private framed = false
  private widths = new Map<string, number>()
  // What covered the map last frame, and how visible each callout is.
  private covers: Box[] = []
  private calloutAlpha = new Float32Array(0)
  hover: Hit | null = null
  level = 0
  // Space taken by the score bar at the top and the toolbar at the bottom.
  insets = { top: 0, bottom: 0 }

  constructor(
    private canvas: HTMLCanvasElement,
    private r: Replay,
    private map: MapView,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.states = Array.from({ length: r.players }, () => emptyState())
    this.smoke = smokeSprite()
    this.flame = flameSprite()
    // Canvas text does not always start a font download on its own.
    for (const f of [`600 11px ${FONT}`, `600 10px ${DISPLAY}`, `700 12px ${DISPLAY}`]) document.fonts?.load(f).catch(() => {})
  }

  resize(w: number, h: number) {
    this.dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.cam.resize(w, h)
    if (!this.framed && w > 1 && h > 1) {
      this.framed = true
      this.home()
    }
  }

  // home frames the part of the map that was played on, radar images have
  // a lot of empty space around them. The frame sits between the score bar
  // and the toolbar, with room for tokens and name tags at the edges.
  home() {
    const [x0, y0, x1, y1] = this.map.bounds
    const cam = this.cam
    const { top, bottom } = this.insets
    const w = Math.max(120, cam.w - 2 * 20)
    const h = Math.max(120, cam.h - top - bottom - 2 * 22)
    const bw = (x1 - x0) * 1.03
    const bh = (y1 - y0) * 1.03
    const base = Math.min(cam.w, cam.h) / 1024
    cam.rot = 0
    cam.zoom = Math.max(0.6, Math.min(w / bw, h / bh) / base)
    cam.cx = (x0 + x1) / 2
    cam.cy = (y0 + y1) / 2 - (top - bottom) / 2 / cam.scale
  }

  hitTest(sx: number, sy: number): Hit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if ((sx - h.x) ** 2 + (sy - h.y) ** 2 <= (h.r + 3) ** 2) return h
    }
    return null
  }

  draw(tick: number, o: ViewOptions, dt: number) {
    const { ctx, r, map, cam } = this
    const round = r.roundIndex(tick)
    const rd = r.round(round)
    for (let p = 0; p < r.players; p++) r.state(p, tick, this.states[p])

    const fs = o.follow >= 0 ? this.states[o.follow] : null
    if (fs && fs.present) {
      const [px, py] = map.toRadar(fs.x, fs.y)
      cam.follow(px, py, dt)
      cam.easeRotation(o.rotate ? ((fs.yaw - 90) * Math.PI) / 180 : 0, dt)
    } else if (!o.rotate && cam.rot !== 0) {
      cam.easeRotation(0, dt)
    }
    this.level = o.layer >= 0 ? o.layer : fs && fs.present ? map.levelOf(fs.z) : 0
    this.level = Math.min(this.level, map.layers.length - 1)

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, cam.w, cam.h)

    // World layers in radar space.
    cam.apply(ctx, this.dpr)
    this.drawGrid()
    const layer = map.layers[this.level]
    if (layer?.plate) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(layer.plate, -PLATE_PAD, -PLATE_PAD)
    }
    if (layer?.outline) {
      ctx.strokeStyle = 'rgba(196,210,228,0.62)'
      ctx.lineWidth = 1.15 / cam.scale
      ctx.lineJoin = 'round'
      ctx.stroke(layer.outline)
    }
    if (o.heat) ctx.drawImage(o.heat, 0, 0, 1024, 1024)
    this.drawInfernos(round, tick)
    this.drawSmokes(round, tick)

    // Everything else in screen space so sizes stay constant and text
    // stays upright. Things are placed before text so text can keep clear.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.hits = []
    const f: Frame = { tokens: [], solid: [], soft: [], tags: [] }
    const people = this.layoutPlayers(o, f)
    if (o.callouts) this.drawCallouts(dt)
    this.drawSites(tick, f)
    this.drawUtilityMarks(round, tick, f)
    if (o.paths) this.drawProjectiles(round, tick, f)
    this.drawExplosions(round, tick, f)
    this.drawKillLines(round, tick, f)
    if (o.shots) this.drawShots(tick, o)
    this.drawFlashLines(round, tick, f)
    this.drawBomb(round, tick, f)
    this.drawDeaths(round, tick, f)
    if (o.ghosts >= 0) this.drawGhosts(round, rd.freezeEndTick, tick, o.ghosts)
    const labels = this.drawPlayers(o, round, tick, people)
    const chips = o.evidence ? this.layoutEvidence(round, tick, f) : []
    this.drawLabels(labels, f)
    this.drawEvidence(chips)
    ctx.globalAlpha = 1
    // Tokens also cover the pointer around them.
    this.covers = [...f.tokens.map((b) => grow(b, 4)), ...f.solid, ...f.soft, ...f.tags]
  }

  private screen(x: number, y: number): [number, number] {
    const [px, py] = this.map.toRadar(x, y)
    return this.cam.toScreen(px, py)
  }

  private onLevel(z: number): boolean {
    return !this.map.multiLevel || this.map.levelOf(z) === this.level
  }

  // drawGrid draws a faint grid every 512 world units, with a stronger
  // line every 2048, over the visible part of the stage.
  private drawGrid() {
    const { ctx, map, cam } = this
    const step = map.units(512)
    const corners = [cam.toRadar(0, 0), cam.toRadar(cam.w, 0), cam.toRadar(0, cam.h), cam.toRadar(cam.w, cam.h)]
    const x0 = Math.min(...corners.map((c) => c[0]))
    const x1 = Math.max(...corners.map((c) => c[0]))
    const y0 = Math.min(...corners.map((c) => c[1]))
    const y1 = Math.max(...corners.map((c) => c[1]))
    // World x = 0 and y = 0 in radar pixels, so lines sit on round world
    // coordinates.
    const [ox, oy] = map.toRadar(0, 0)
    const minor = new Path2D()
    const major = new Path2D()
    for (let i = Math.ceil((x0 - ox) / step); ox + i * step <= x1; i++) {
      const v = ox + i * step
      const p = i % 4 === 0 ? major : minor
      p.moveTo(v, y0)
      p.lineTo(v, y1)
    }
    for (let i = Math.ceil((y0 - oy) / step); oy + i * step <= y1; i++) {
      const v = oy + i * step
      const p = i % 4 === 0 ? major : minor
      p.moveTo(x0, v)
      p.lineTo(x1, v)
    }
    ctx.lineWidth = 1 / cam.scale
    ctx.strokeStyle = 'rgba(150,170,196,0.045)'
    ctx.stroke(minor)
    ctx.strokeStyle = 'rgba(150,170,196,0.085)'
    ctx.stroke(major)
  }

  private textWidth(text: string): number {
    const key = `${this.ctx.font}|${text}`
    let w = this.widths.get(key)
    if (w === undefined) {
      w = this.ctx.measureText(text).width
      if (document.fonts?.status === 'loaded') this.widths.set(key, w)
    }
    return w
  }

  // spot returns the first candidate centre where a w by h box keeps clear
  // of tokens and everything placed so far. When none is clear it looks
  // around the first one, further out each time.
  private spot(cands: [number, number][], w: number, h: number, f: Frame): [number, number] {
    const clear = ([x, y]: [number, number]) => {
      const b = { x: x - w / 2 - 2, y: y - h / 2 - 2, w: w + 4, h: h + 4 }
      return !f.tokens.some((t) => overlaps(b, t)) && !f.solid.some((t) => overlaps(b, t))
    }
    const found = cands.find(clear)
    if (found) return found
    const [x0, y0] = cands[0]
    for (const d of [1, 1.8, 2.6]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 - Math.PI / 2
        const c: [number, number] = [x0 + Math.cos(a) * (w / 2 + 6) * d, y0 + Math.sin(a) * (h / 2 + 6) * d]
        if (clear(c)) return c
      }
    }
    return cands[0]
  }

  // layoutPlayers places every live token before anything is drawn, so
  // labels, pills and callouts can make room for them.
  private layoutPlayers(o: ViewOptions, f: Frame): Person[] {
    const { r, cam } = this
    const radius = Math.max(7, Math.min(12, 7.6 * Math.sqrt(cam.zoom)))
    const viewerTeam = o.follow >= 0 ? r.match.players[o.follow].team : -1
    let teamMask = 0
    if (o.teamVision && viewerTeam >= 0) {
      for (const p of r.teamPlayers[viewerTeam]) if (p < 32) teamMask |= 1 << p
    }
    const weight = (p: number) => (p === o.follow ? 2 : o.focus.includes(p) ? 1 : 0)
    const order = [...Array(r.players).keys()].sort((a, b) => weight(a) - weight(b))
    const out: Person[] = []
    for (const p of order) {
      const s = this.states[p]
      if (!s.present || !s.alive) continue
      const [x, y] = this.screen(s.x, s.y)
      const enemy = viewerTeam >= 0 && r.match.players[p].team !== viewerTeam
      const hidden = o.teamVision && enemy && (s.spotted & teamMask) === 0
      let alpha = this.onLevel(s.z) ? 1 : 0.35
      if (hidden) alpha *= 0.6
      if (o.focus.length && !o.focus.includes(p) && p !== o.follow) alpha *= 0.45
      out.push({ p, s, x, y, r: radius, a: -(s.yaw * Math.PI) / 180 + cam.rot, alpha, hidden })
      f.tokens.push({ x: x - radius - 2, y: y - radius - 2, w: radius * 2 + 4, h: radius * 2 + 4 })
    }
    return out
  }

  // Callouts are quiet map notes. They fade out when zoomed far out, and
  // under anything that covered them last frame, so they never show as
  // clipped fragments.
  private drawCallouts(dt: number) {
    const { ctx, map, cam } = this
    if (this.calloutAlpha.length !== map.callouts.length) this.calloutAlpha = new Float32Array(map.callouts.length)
    const zoomFade = Math.min(1, Math.max(0, (cam.scale - 0.38) / 0.08))
    const ease = 1 - Math.exp(-dt * 14)
    ctx.font = `600 10px ${DISPLAY}`
    setSpacing(ctx, '0.05em')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const placed: Box[] = []
    for (const s of map.sites) {
      if (s.level !== this.level) continue
      const [x, y] = cam.toScreen(s.x, s.y)
      placed.push({ x: x - 16, y: y - 16, w: 32, h: 32 })
    }
    map.callouts.forEach((c, i) => {
      let target = 0
      let x = 0
      let y = 0
      let text = ''
      if (c.level === this.level && zoomFade > 0) {
        ;[x, y] = cam.toScreen(c.x, c.y)
        if (x > -60 && y > -20 && x < cam.w + 60 && y < cam.h + 20) {
          text = c.name.toUpperCase()
          const w = this.textWidth(text) + 4
          const box = { x: x - w / 2, y: y - 6, w, h: 12 }
          if (!placed.some((b) => overlaps(box, b))) {
            placed.push(box)
            target = this.covers.some((b) => overlaps(box, b)) ? 0 : 1
          } else {
            text = ''
          }
        }
      }
      const a = (this.calloutAlpha[i] += (target - this.calloutAlpha[i]) * ease)
      if (!text || a < 0.02) return
      ctx.globalAlpha = a * zoomFade
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'rgba(11,13,17,0.62)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = 'rgba(180,189,200,0.9)'
      ctx.fillText(text, x, y)
    })
    ctx.globalAlpha = 1
    setSpacing(ctx, '0px')
  }

  // Bombsites use the game's A and B badges at a fixed size. The site with
  // the bomb on it leaves the bomb to mark it.
  private drawSites(tick: number, f: Frame) {
    const { ctx, map, cam } = this
    const b = this.r.bombAt(tick)
    let skip = -1
    if (b.state === BOMB.planted || b.state === BOMB.defused || b.state === BOMB.exploded) {
      const [bx, by] = map.toRadar(b.x, b.y)
      let best = Infinity
      map.sites.forEach((s, i) => {
        const d = (s.x - bx) ** 2 + (s.y - by) ** 2
        if (d < best && s.level === map.levelOf(b.z)) {
          best = d
          skip = i
        }
      })
    }
    map.sites.forEach((s, i) => {
      if (s.level !== this.level || i === skip) return
      const [x, y] = cam.toScreen(s.x, s.y)
      ctx.fillStyle = 'rgba(6,8,11,0.35)'
      circle(ctx, x, y + 1, 14.5)
      ctx.fill()
      ctx.fillStyle = 'rgba(11,13,17,0.92)'
      circle(ctx, x, y, 12.5)
      ctx.fill()
      const drawn = drawIcon(ctx, `hud/bombsite-${s.name.toLowerCase()}`, x, y, 22, TEXT)
      if (!drawn) {
        ctx.fillStyle = TEXT
        ctx.font = `700 14px ${DISPLAY}`
        centreText(ctx, s.name, x, y, s.name)
      }
      f.solid.push({ x: x - 13, y: y - 13, w: 26, h: 26 })
    })
  }

  private drawSmokes(round: number, tick: number) {
    const { ctx, r, map } = this
    const end = r.round(round).officialEndTick
    for (const g of r.roundGrenades[round]) {
      if (g.type !== EQ.smoke || g.effectTick < 0 || tick < g.effectTick) continue
      const stop = g.endTick >= 0 ? g.endTick : end
      if (tick >= stop) continue
      const age = (tick - g.effectTick) / r.rate
      const left = (stop - tick) / r.rate
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.9), 3)
      const alpha = Math.min(1, age / 0.4) * Math.min(1, left / 1.5)
      const [x, y] = map.toRadar(g.pos[0], g.pos[1])
      const rad = map.units(SMOKE_RADIUS) * (0.7 + 0.3 * grow)
      ctx.globalAlpha = alpha * (this.onLevel(g.pos[2]) ? 0.96 : 0.28)
      // The sprite has room around the cloud for its shadow.
      ctx.drawImage(this.smoke, x - rad * 1.3, y - rad * 1.3, rad * 2.6, rad * 2.6)
    }
    ctx.globalAlpha = 1
  }

  // Fires are drawn from the game's fire hull as a soft glow with no hard
  // rim: the shape is drawn off screen so only its blurred shadow lands.
  // Flames flicker along the edge and the core is hotter. Drawn in screen
  // space, the camera transform is set again after.
  private drawInfernos(round: number, tick: number) {
    const { ctx, r, map, cam, dpr } = this
    const end = r.round(round).officialEndTick
    const reach = map.units(FIRE_RADIUS) * cam.scale
    const away = cam.w + reach * 8
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const inf of r.roundInfernos[round]) {
      const stop = inf.endTick >= 0 ? inf.endTick : end
      if (tick < inf.startTick || tick >= stop || !inf.snapshots?.length) continue
      const pts = this.fireHull(inf.snapshots, tick).map(([x, y]) => cam.toScreen(x, y))
      if (!pts.length) continue
      const left = (stop - tick) / r.rate
      const age = (tick - inf.startTick) / r.rate
      const fade = Math.min(1, left / 0.8) * Math.min(1, age / 0.25)
      let cx = 0
      let cy = 0
      for (const [x, y] of pts) {
        cx += x
        cy += y
      }
      cx /= pts.length
      cy /= pts.length
      const shape = (grow: number) => {
        ctx.beginPath()
        if (pts.length >= 3) {
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - away, y) : ctx.moveTo(x - away, y)))
          ctx.closePath()
        }
        for (const [x, y] of pts) {
          ctx.moveTo(x - away + grow, y)
          ctx.arc(x - away, y, grow, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.globalAlpha = fade
      ctx.fillStyle = '#000'
      ctx.shadowOffsetX = away * dpr
      ctx.shadowColor = 'rgba(236,92,44,0.85)'
      ctx.shadowBlur = reach * 1.3 * dpr
      shape(reach * 0.75)
      ctx.shadowColor = 'rgba(255,140,64,0.9)'
      ctx.shadowBlur = reach * 0.6 * dpr
      shape(reach * 0.35)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      // Flames along the edge, each on its own beat.
      pts.forEach(([x, y], i) => {
        const beat = 0.5 + 0.5 * Math.sin(tick / 2.7 + i * 1.7)
        const size = reach * (0.7 + 0.3 * beat)
        ctx.globalAlpha = fade * (0.15 + 0.25 * beat)
        ctx.drawImage(this.flame, x - size, y - size, size * 2, size * 2)
      })
      // A hotter core that flickers.
      let spread = reach
      for (const [x, y] of pts) spread = Math.max(spread, Math.hypot(x - cx, y - cy))
      const flick = 0.5 + 0.5 * Math.sin(tick / 3.1)
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, spread * 0.75)
      core.addColorStop(0, `rgba(255,208,137,${0.4 + 0.2 * flick})`)
      core.addColorStop(1, 'rgba(255,208,137,0)')
      ctx.globalAlpha = fade
      ctx.fillStyle = core
      circle(ctx, cx, cy, spread * 0.75)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    cam.apply(ctx, dpr)
  }

  private fireHull(snaps: { tick: number; hull: number[] }[], tick: number): [number, number][] {
    let snap = snaps[0]
    for (const s of snaps) {
      if (s.tick <= tick) snap = s
      else break
    }
    const pts: [number, number][] = []
    for (let i = 0; i < snap.hull.length; i += 2) pts.push(this.map.toRadar(snap.hull[i], snap.hull[i + 1]))
    return pts
  }

  // drawUtilityMarks puts a timer ring and icon on smokes and an icon on
  // fires, in screen space so they stay crisp.
  private drawUtilityMarks(round: number, tick: number, f: Frame) {
    const { ctx, r, map, cam } = this
    const end = r.round(round).officialEndTick
    for (const g of r.roundGrenades[round]) {
      if (g.type !== EQ.smoke || g.effectTick < 0 || tick < g.effectTick) continue
      const stop = g.endTick >= 0 ? g.endTick : end
      if (tick >= stop) continue
      const age = (tick - g.effectTick) / r.rate
      const left = (stop - tick) / r.rate
      const total = (stop - g.effectTick) / r.rate
      const [x, y] = this.screen(g.pos[0], g.pos[1])
      const rad = map.units(SMOKE_RADIUS) * cam.scale
      const level = this.onLevel(g.pos[2]) ? 1 : 0.3
      ctx.globalAlpha = Math.min(1, age / 0.6) * Math.min(1, left / 1.5) * level
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.9), 3)
      const ring = Math.max(8, rad * (0.7 + 0.3 * grow) * 0.94)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(11,13,17,0.3)'
      circle(ctx, x, y, ring)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.arc(x, y, ring, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
      ctx.stroke()
      if (rad > 14) {
        nadeBadge(ctx, x, y, 'weapon/smokegrenade', teamColor(g.side).base)
        f.solid.push({ x: x - 10, y: y - 10, w: 20, h: 20 })
      }
    }
    for (const inf of r.roundInfernos[round]) {
      const stop = inf.endTick >= 0 ? inf.endTick : end
      if (tick < inf.startTick || tick >= stop || !inf.snapshots?.length) continue
      const pts = this.fireHull(inf.snapshots, tick)
      if (!pts.length) continue
      let cx = 0
      let cy = 0
      for (const [x, y] of pts) {
        cx += x
        cy += y
      }
      const [x, y] = cam.toScreen(cx / pts.length, cy / pts.length)
      ctx.globalAlpha = Math.min(1, (stop - tick) / (r.rate * 0.8))
      ctx.fillStyle = SHADE
      circle(ctx, x, y, 8.5)
      ctx.fill()
      drawIcon(ctx, 'weapon/inferno', x, y, 11, '#ffb35c')
      f.solid.push({ x: x - 9, y: y - 9, w: 18, h: 18 })
    }
    ctx.globalAlpha = 1
  }

  // drawProjectiles shows grenades in flight with their real icon and a
  // thin trail, which fades out after they land.
  private drawProjectiles(round: number, tick: number, f: Frame) {
    const { ctx, r } = this
    const { x: nx, y: ny, z: nz, tick: nt } = r.nade
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const g of r.roundGrenades[round]) {
      if (g.pathLen < 2 || tick < g.throwTick) continue
      const landed = g.effectTick >= 0 && tick >= g.effectTick
      const fade = landed ? 1 - (tick - g.effectTick) / (r.rate * 1.2) : 1
      if (fade <= 0) continue
      const head = r.grenadePosition(g, tick)
      const c = teamColor(g.side)
      const z = head ? head[2] : nz[g.pathStart]
      const level = this.onLevel(z) ? 1 : 0.35
      ctx.globalAlpha = fade * level
      ctx.strokeStyle = `rgba(${c.rgb},0.6)`
      ctx.lineWidth = 1.25
      ctx.beginPath()
      const end = g.pathStart + g.pathLen
      for (let i = g.pathStart; i < end && nt[i] <= tick; i++) {
        const [x, y] = this.screen(nx[i], ny[i])
        if (i === g.pathStart) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      if (!head) {
        ctx.stroke()
        continue
      }
      const [hx, hy] = this.screen(head[0], head[1])
      ctx.lineTo(hx, hy)
      ctx.stroke()
      if (landed) continue
      ctx.globalAlpha = level
      nadeBadge(ctx, hx, hy, NADE_ICON[g.type] ?? null, c.base)
      f.soft.push({ x: hx - 10, y: hy - 10, w: 20, h: 20 })
    }
    ctx.globalAlpha = 1
  }

  private drawExplosions(round: number, tick: number, f: Frame) {
    const { ctx, r, map, cam } = this
    for (const g of r.roundGrenades[round]) {
      if (g.effectTick < 0 || tick < g.effectTick) continue
      const age = (tick - g.effectTick) / r.rate
      if (age > 0.6 && g.type !== EQ.decoy) continue
      const [x, y] = this.screen(g.pos[0], g.pos[1])
      const level = this.onLevel(g.pos[2]) ? 1 : 0.35
      if (g.type === EQ.he && age < 0.55) {
        const k = age / 0.55
        const e = 1 - Math.pow(1 - k, 3)
        const rad = map.units(HE_RADIUS) * cam.scale * (0.12 + 0.88 * e)
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
        grad.addColorStop(0, `rgba(255,214,160,${0.55 * (1 - k)})`)
        grad.addColorStop(0.6, `rgba(255,120,60,${0.22 * (1 - k)})`)
        grad.addColorStop(1, 'rgba(255,90,50,0)')
        ctx.globalAlpha = level
        ctx.fillStyle = grad
        circle(ctx, x, y, rad)
        ctx.fill()
        ctx.globalAlpha = level * (1 - k)
        ctx.strokeStyle = '#ffc89a'
        ctx.lineWidth = 2
        circle(ctx, x, y, rad)
        ctx.stroke()
      } else if (g.type === EQ.flash && age < 0.45) {
        const k = age / 0.45
        const e = 1 - Math.pow(1 - k, 2)
        const rad = map.units(40 + 240 * e) * cam.scale
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
        grad.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - k)})`)
        grad.addColorStop(0.45, `rgba(255,255,255,${0.4 * (1 - k)})`)
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.globalAlpha = level
        ctx.fillStyle = grad
        circle(ctx, x, y, rad)
        ctx.fill()
        ctx.globalAlpha = level * (1 - k) * 0.8
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.25
        circle(ctx, x, y, rad)
        ctx.stroke()
      } else if (g.type === EQ.decoy && (g.endTick < 0 || tick < g.endTick)) {
        const pulse = (tick / r.rate) % 1
        ctx.globalAlpha = level * (1 - pulse) * 0.7
        ctx.strokeStyle = TEXT
        ctx.lineWidth = 1.25
        circle(ctx, x, y, 9 + pulse * 10)
        ctx.stroke()
        ctx.globalAlpha = level
        nadeBadge(ctx, x, y, 'weapon/decoy', teamColor(g.side).base)
        f.solid.push({ x: x - 10, y: y - 10, w: 20, h: 20 })
      }
    }
    ctx.globalAlpha = 1
  }

  // Kill lines run from killer to victim for a moment, with the weapon
  // and a headshot mark in a tag next to the body, clear of tokens.
  private drawKillLines(round: number, tick: number, f: Frame) {
    const { ctx, r } = this
    for (const k of r.roundKills[round]) {
      const age = (tick - k.tick) / r.rate
      if (age < 0 || age > 2.2) continue
      const [x2, y2] = this.screen(k.victimPos[0], k.victimPos[1])
      const fade = Math.min(1, (2.2 - age) / 0.6)
      if (k.killer >= 0 && age < 1.8) {
        const [x1, y1] = this.screen(k.killerPos[0], k.killerPos[1])
        ctx.globalAlpha = 1 - age / 1.8
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      const icon = weaponIcon(k.weapon, k.killerSide)
      const h = 11
      const w1 = icon ? drawWidth(icon, h) : 0
      const w2 = k.headshot ? drawWidth('kill/headshot', h) : 0
      if (!w1 && !w2) continue
      const w = w1 + (w1 && w2 ? 4 : 0) + w2 + 12
      const H = 17
      const [px, py] = this.spot(
        [
          [x2, y2 - 17],
          [x2, y2 + 17],
          [x2 + w / 2 + 10, y2],
          [x2 - w / 2 - 10, y2],
          [x2, y2 - 36],
          [x2, y2 + 36],
        ],
        w,
        H,
        f,
      )
      f.solid.push({ x: px - w / 2, y: py - H / 2, w, h: H })
      ctx.globalAlpha = fade * (this.onLevel(k.victimPos[2]) ? 1 : 0.4)
      pill(ctx, px, py, w, H)
      let x = px - w / 2 + 6
      if (w1) {
        drawIcon(ctx, icon, x + w1 / 2, py, h, TEXT)
        x += w1 + 4
      }
      if (w2) drawIcon(ctx, 'kill/headshot', x + w2 / 2, py, h, TEXT)
    }
    ctx.globalAlpha = 1
  }

  private drawShots(tick: number, o: ViewOptions) {
    const { ctx, r, map, cam } = this
    const window = r.rate * 0.14
    const s = r.shots
    ctx.lineCap = 'round'
    for (let i = r.firstShotAfter(tick - window); i < s.tick.length && s.tick[i] <= tick; i++) {
      const p = s.player[i]
      if (s.weapon[i] >= 400 || p >= r.players) continue
      const st = this.states[p]
      if (!st.alive || !this.onLevel(st.z)) continue
      const age = (tick - s.tick[i]) / window
      const [x, y] = this.screen(st.x, st.y)
      const a = -(st.yaw * Math.PI) / 180 + cam.rot
      const len = map.units(o.follow === p ? 900 : 480) * cam.scale
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const g = ctx.createLinearGradient(x, y, x + ca * len, y + sa * len)
      g.addColorStop(0, `rgba(255,244,214,${0.95 * (1 - age)})`)
      g.addColorStop(1, 'rgba(255,244,214,0)')
      ctx.strokeStyle = g
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(x + ca * 14, y + sa * 14)
      ctx.lineTo(x + ca * len, y + sa * len)
      ctx.stroke()
    }
  }

  // Flash lines join a flash to the players it blinded. Enemies are white,
  // teammates in red.
  private drawFlashLines(round: number, tick: number, f: Frame) {
    const { ctx, r } = this
    const grenades = r.match.grenades ?? []
    for (const b of r.roundBlinds[round]) {
      const age = (tick - b.tick) / r.rate
      if (age < 0 || age > 1.8 || b.grenade < 0 || b.duration < 0.5) continue
      const g = grenades[b.grenade]
      if (!g) continue
      const v = this.states[b.victim]
      const [x1, y1] = this.screen(g.pos[0], g.pos[1])
      const [x2, y2] = this.screen(v.x, v.y)
      const enemy = r.match.players[b.attacker]?.team !== r.match.players[b.victim]?.team
      const color = enemy ? TEXT : ACCENT
      ctx.globalAlpha = Math.min(1, (1.8 - age) / 0.5)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.25
      ctx.lineCap = 'butt'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      // Duration tag on the line, clear of tokens.
      const text = `${b.duration.toFixed(1)}s`
      ctx.font = `600 11px ${DISPLAY}`
      const tw = this.textWidth(text)
      const iw = drawWidth('weapon/flashbang', 11)
      const w = tw + (iw ? iw + 4 : 0) + 12
      const H = 17
      const at = (t: number): [number, number] => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
      const [mx, my] = this.spot([0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78].map(at), w, H, f)
      f.solid.push({ x: mx - w / 2, y: my - H / 2, w, h: H })
      pill(ctx, mx, my, w, H, enemy ? undefined : 'rgba(240,75,83,0.6)')
      let x = mx - w / 2 + 6
      if (iw) {
        drawIcon(ctx, 'weapon/flashbang', x + iw / 2, my, 11, color)
        x += iw + 4
      }
      ctx.fillStyle = color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, x, my + 0.5)
    }
    ctx.globalAlpha = 1
  }

  // The bomb: an icon when dropped, and once planted a disc with the C4,
  // a countdown arc and a timer tag that keeps clear of players.
  private drawBomb(round: number, tick: number, f: Frame) {
    const { ctx, r } = this
    const b = r.bombAt(tick)
    if (b.state !== BOMB.dropped && b.state !== BOMB.planted && b.state !== BOMB.defused && b.state !== BOMB.exploded) return
    const [x, y] = this.screen(b.x, b.y)
    const level = this.onLevel(b.z) ? 1 : 0.45
    ctx.globalAlpha = level
    if (b.state === BOMB.dropped) {
      ctx.fillStyle = SHADE
      circle(ctx, x, y, 10)
      ctx.fill()
      ctx.lineWidth = 1.25
      ctx.strokeStyle = ACCENT
      circle(ctx, x, y, 10)
      ctx.stroke()
      if (!drawIcon(ctx, 'hud/dropped-bomb', x, y, 13, TEXT)) this.c4Text(x, y)
      f.solid.push({ x: x - 11, y: y - 11, w: 22, h: 22 })
      ctx.globalAlpha = 1
      return
    }
    const R = 12
    const disc = { x: x - R, y: y - R, w: R * 2, h: R * 2 }
    // A player standing on the bomb, usually the one defusing it, covers
    // the disc. The timer tag then carries the C4 instead.
    const covered = f.tokens.some((t) => Math.hypot(t.x + t.w / 2 - x, t.y + t.h / 2 - y) < t.w / 2)
    const plant = r.roundBomb[round].find((e) => e.kind === 'planted' && e.tick <= tick)
    const total = r.round(round).bombTime
    const left = plant ? Math.max(0, total - (tick - plant.tick) / r.rate) : total
    const color = b.state === BOMB.defused ? GOOD : ACCENT
    if (b.state === BOMB.planted && !covered) {
      // Pulse faster as the timer runs down.
      const period = left < 10 ? 0.5 : 1
      const k = ((tick / r.rate) % period) / period
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.5
      ctx.globalAlpha = level * (1 - k) * 0.8
      circle(ctx, x, y, R + 2 + k * 16)
      ctx.stroke()
      ctx.globalAlpha = level
    }
    if (b.state === BOMB.exploded) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 46)
      g.addColorStop(0, 'rgba(255,170,90,0.5)')
      g.addColorStop(1, 'rgba(240,75,83,0)')
      ctx.fillStyle = g
      circle(ctx, x, y, 46)
      ctx.fill()
    }
    if (!covered) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      circle(ctx, x, y + 1, R + 1.5)
      ctx.fill()
      ctx.fillStyle = 'rgba(11,13,17,0.94)'
      circle(ctx, x, y, R)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      circle(ctx, x, y, R - 1.5)
      ctx.stroke()
      if (b.state !== BOMB.exploded) {
        ctx.strokeStyle = color
        ctx.lineCap = 'butt'
        ctx.beginPath()
        const frac = b.state === BOMB.planted ? left / total : 1
        ctx.arc(x, y, R - 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
        ctx.stroke()
      }
      if (!drawIcon(ctx, 'weapon/c4', x, y, 13, b.state === BOMB.defused ? GOOD : TEXT)) this.c4Text(x, y)
      f.solid.push(grow(disc, 1))
    }
    if (b.state === BOMB.planted || b.state === BOMB.defused) {
      const defused = b.state === BOMB.defused
      const text = defused ? 'Defused' : left.toFixed(1)
      const icon = defused ? 'hud/defuse' : 'weapon/c4'
      ctx.font = `700 11px ${DISPLAY}`
      const iw = covered || defused ? drawWidth(icon, 11) : 0
      const w = this.textWidth(text) + (iw ? iw + 4 : 0) + 12
      const H = 16
      const [px, py] = this.spot(
        [
          [x, y + R + 11],
          [x, y - R - 11],
          [x + R + 6 + w / 2, y],
          [x - R - 6 - w / 2, y],
          [x, y + R + 30],
        ],
        w,
        H,
        f,
      )
      f.solid.push({ x: px - w / 2, y: py - H / 2, w, h: H })
      pill(ctx, px, py, w, H, defused ? 'rgba(60,203,138,0.6)' : 'rgba(240,75,83,0.6)')
      let tx = px - w / 2 + 6
      if (iw) {
        drawIcon(ctx, icon, tx + iw / 2, py, 11, defused ? GOOD : ACCENT)
        tx += iw + 4
      }
      ctx.fillStyle = defused ? GOOD : TEXT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, tx, py + 0.5)
    }
    ctx.globalAlpha = 1
  }

  private c4Text(x: number, y: number) {
    const { ctx } = this
    ctx.fillStyle = ACCENT
    ctx.font = `700 9px ${DISPLAY}`
    centreText(ctx, 'C4', x, y, 'C')
  }

  // Deaths are marked with a cross in the team colour where they fell.
  private drawDeaths(round: number, tick: number, f: Frame) {
    const { ctx, r } = this
    ctx.lineCap = 'round'
    for (const k of r.roundKills[round]) {
      if (k.tick > tick) continue
      const [x, y] = this.screen(k.victimPos[0], k.victimPos[1])
      const c = teamColor(k.victimSide)
      ctx.globalAlpha = this.onLevel(k.victimPos[2]) ? 0.75 : 0.25
      const s = 4.5
      ctx.strokeStyle = EDGE
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(x - s, y - s)
      ctx.lineTo(x + s, y + s)
      ctx.moveTo(x + s, y - s)
      ctx.lineTo(x - s, y + s)
      ctx.stroke()
      ctx.strokeStyle = c.base
      ctx.lineWidth = 2
      ctx.stroke()
      f.soft.push({ x: x - 6, y: y - 6, w: 12, h: 12 })
    }
    ctx.globalAlpha = 1
  }

  // layoutEvidence groups markers that share a spot into one chip, and
  // merges chips that would touch, so stems stay short and straight.
  private layoutEvidence(round: number, tick: number, f: Frame): Chip[] {
    const { ctx } = this
    ctx.font = `700 11px ${DISPLAY}`
    let chips: Chip[] = []
    this.r.roundBlunders[round].forEach((b, i) => {
      if (b.tick > tick || (!b.pos[0] && !b.pos[1])) return
      if (this.map.multiLevel && b.pos[2] !== 0 && this.map.levelOf(b.pos[2]) !== this.level) return
      const [x, y] = this.screen(b.pos[0], b.pos[1])
      const item = { id: this.r.blunders.indexOf(b), n: i + 1, w: Math.max(16, Math.round(this.textWidth(String(i + 1))) + 8) }
      chips.push({ x, y: y - 18, sy: y, w: item.w, spots: [[x, y]], items: [item] })
    })
    const box = (c: Chip): Box => ({ x: c.x - c.w / 2 - 2, y: c.y - CHIP_H / 2 - 2, w: c.w + 4, h: CHIP_H + 4 })
    for (let merged = true; merged; ) {
      merged = false
      for (let i = 0; i < chips.length && !merged; i++) {
        for (let j = i + 1; j < chips.length && !merged; j++) {
          const a = chips[i]
          const b = chips[j]
          const near = Math.abs(a.x - b.x) < 14 && Math.abs(a.sy - b.sy) < 14
          if (!near && !overlaps(box(a), box(b))) continue
          a.items.push(...b.items)
          a.items.sort((p, q) => p.n - q.n)
          a.spots.push(...b.spots)
          a.w = a.items.reduce((s, it) => s + it.w, 0)
          // The stem goes to the spot nearest the middle of the group.
          const mx = a.spots.reduce((s, p) => s + p[0], 0) / a.spots.length
          const my = a.spots.reduce((s, p) => s + p[1], 0) / a.spots.length
          let best = a.spots[0]
          for (const p of a.spots) if ((p[0] - mx) ** 2 + (p[1] - my) ** 2 < (best[0] - mx) ** 2 + (best[1] - my) ** 2) best = p
          a.x = best[0]
          a.sy = best[1]
          a.y = Math.min(...a.spots.map((p) => p[1])) - 18
          chips = chips.filter((c) => c !== b)
          merged = true
        }
      }
    }
    for (const c of chips) {
      // Long groups show the first few and a count.
      if (c.items.length > 6) {
        const rest = c.items.length - 5
        c.items = c.items.slice(0, 5).concat({ ...c.items[5], n: -rest, w: 24 })
        c.w = c.items.reduce((s, it) => s + it.w, 0)
      }
      const b = box(c)
      f.solid.push(b, { x: c.x - 3, y: c.y, w: 6, h: c.sy - c.y })
    }
    return chips
  }

  // Evidence markers flag blunders on the map, numbered per round like the
  // tents at a crime scene.
  private drawEvidence(chips: Chip[]) {
    const { ctx } = this
    ctx.font = `700 11px ${DISPLAY}`
    ctx.lineCap = 'round'
    // Stems first so no stem crosses a chip.
    for (const c of chips) {
      ctx.strokeStyle = EDGE
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(c.x, c.y + CHIP_H / 2)
      ctx.lineTo(c.x, c.sy)
      ctx.stroke()
      ctx.strokeStyle = EVIDENCE
      ctx.lineWidth = 1.25
      ctx.stroke()
      for (const [sx, sy] of c.spots) {
        ctx.fillStyle = EDGE
        circle(ctx, sx, sy, 3)
        ctx.fill()
        ctx.fillStyle = EVIDENCE
        circle(ctx, sx, sy, 2)
        ctx.fill()
      }
    }
    for (const c of chips) {
      const top = c.y - CHIP_H / 2
      const x0 = c.x - c.w / 2
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      roundRect(ctx, x0 - 1, top, c.w + 2, CHIP_H + 2, 5)
      ctx.fill()
      ctx.fillStyle = EVIDENCE
      roundRect(ctx, x0, top, c.w, CHIP_H, 4)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = EDGE
      ctx.stroke()
      let x = x0
      c.items.forEach((it, k) => {
        const hovered = this.hover?.kind === 'blunder' && this.hover.id === it.id
        if (k > 0) {
          ctx.fillStyle = 'rgba(11,13,17,0.3)'
          ctx.fillRect(x - 0.5, top + 3, 1, CHIP_H - 6)
        }
        if (hovered) {
          ctx.fillStyle = '#ffffff'
          roundRect(ctx, x + 1.5, top + 1.5, it.w - 3, CHIP_H - 3, 3)
          ctx.fill()
        }
        ctx.fillStyle = BG
        centreText(ctx, it.n > 0 ? String(it.n) : `+${-it.n}`, x + it.w / 2, c.y)
        this.hits.push({ kind: 'blunder', id: it.id, x: x + it.w / 2, y: c.y, r: Math.min(it.w, CHIP_H) / 2 - 3 })
        x += it.w
      })
    }
  }

  // drawGhosts shows where a team stood at the same time in every other
  // round they played on the same side, as faint hollow tokens.
  private drawGhosts(round: number, freezeEnd: number, tick: number, team: number) {
    const { ctx, r, cam } = this
    const side = r.sideOf(team, round)
    const offset = tick - freezeEnd
    if (offset < 0) return
    const c = teamColor(side)
    const size = 0.6 * Math.max(7, Math.min(12, 7.6 * Math.sqrt(cam.zoom)))
    const numbers = size >= 5.5
    ctx.font = `700 ${Math.round(size * 1.2)}px ${DISPLAY}`
    for (let i = 0; i < r.match.rounds.length; i++) {
      if (i === round || r.sideOf(team, i) !== side) continue
      const rd = r.match.rounds[i]
      const t = rd.freezeEndTick + offset
      if (t > rd.endTick) continue
      for (const p of r.teamPlayers[team]) {
        const s = r.state(p, t, this.ghost)
        if (!s.alive || s.side !== side) continue
        const [x, y] = this.screen(s.x, s.y)
        ctx.globalAlpha = this.onLevel(s.z) ? 0.42 : 0.15
        ctx.fillStyle = 'rgba(11,13,17,0.55)'
        circle(ctx, x, y, size)
        ctx.fill()
        ctx.lineWidth = 1.25
        ctx.strokeStyle = c.base
        ctx.stroke()
        if (numbers && r.slot[p]) {
          ctx.fillStyle = c.light
          centreText(ctx, String(r.slot[p]), x, y)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  // progress returns how far a plant or defuse has come, or -1.
  private progress(round: number, p: number, s: PlayerState, tick: number): number {
    if (!(s.flags & (FLAG.defusing | FLAG.planting))) return -1
    const kind = s.flags & FLAG.defusing ? 'defuse_begin' : 'plant_begin'
    let start: BombEvent | null = null
    for (const e of this.r.roundBomb[round]) {
      if (e.tick > tick) break
      if (e.kind === kind && e.player === p) start = e
    }
    if (!start) return -1
    const time = kind === 'plant_begin' ? PLANT_TIME : start.kit ? 5 : 10
    return Math.min(1, Math.max(0, (tick - start.tick) / this.r.rate / time))
  }

  private drawPlayers(o: ViewOptions, round: number, tick: number, people: Person[]): Label[] {
    const { ctx, r, cam } = this
    const labels: Label[] = []
    for (const t of people) {
      const { p, s, x, y, a, alpha, hidden } = t
      const radius = t.r
      const c = teamColor(s.side)
      const followed = p === o.follow
      const strong = followed || o.focus.includes(p)
      const hovered = this.hover?.kind === 'player' && this.hover.id === p
      ctx.globalAlpha = alpha

      // View cone.
      const showCone = o.cones === 'all' || (o.cones === 'follow' && strong)
      if (showCone && !hidden) {
        const len = this.map.units(CONE_LENGTH) * cam.scale
        const grad = ctx.createRadialGradient(x, y, radius, x, y, len)
        grad.addColorStop(0, `rgba(${c.rgb},${strong ? 0.26 : 0.12})`)
        grad.addColorStop(1, `rgba(${c.rgb},0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, len, a - FOV / 2, a + FOV / 2)
        ctx.closePath()
        ctx.fill()
      }

      // Blind players glow white but keep their team colour.
      const flash = hidden ? 0 : Math.min(1, s.flash / 1.6)
      if (flash > 0) {
        const glow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 2.6)
        glow.addColorStop(0, `rgba(255,255,255,${0.7 * flash})`)
        glow.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = glow
        circle(ctx, x, y, radius * 2.6)
        ctx.fill()
      }

      if (hidden) ghostToken(ctx, x, y, radius, a, c)
      else token(ctx, x, y, radius, tint(s.side))

      // Slot number.
      ctx.font = `700 ${Math.round(radius * 1.25)}px ${DISPLAY}`
      const num = String(r.slot[p] || '')
      if (hidden) {
        ctx.fillStyle = c.light
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        centreText(ctx, num, x, y + 0.8)
        ctx.fillStyle = '#ffffff'
      }
      centreText(ctx, num, x, y)

      if (flash > 0) {
        ctx.lineWidth = 2
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * flash})`
        circle(ctx, x, y, radius + 0.5)
        ctx.stroke()
      }

      // Rings stack outward: health, plant or defuse, follow. A plant or
      // defuse takes the place of the health ring while it lasts.
      let ring = radius + 1
      const prog = hidden ? -1 : this.progress(round, p, s, tick)
      if (s.hp < 100 && !hidden && prog < 0) {
        ring += 2
        ctx.lineCap = 'butt'
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(8,10,14,0.8)'
        circle(ctx, x, y, ring)
        ctx.stroke()
        ctx.strokeStyle = s.hp > 50 ? TEXT : s.hp > 20 ? WARN : BAD
        ctx.beginPath()
        ctx.arc(x, y, ring, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.hp) / 100)
        ctx.stroke()
        ring += 1
      }
      if (prog >= 0) {
        ring += 2
        ctx.lineWidth = 2.5
        ctx.strokeStyle = 'rgba(8,10,14,0.8)'
        circle(ctx, x, y, ring)
        ctx.stroke()
        ctx.strokeStyle = s.flags & FLAG.defusing ? c.light : ACCENT
        ctx.beginPath()
        ctx.arc(x, y, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog)
        ctx.stroke()
        ring += 1
      }
      if (followed) {
        ring += 3
        ctx.lineWidth = 2
        ctx.strokeStyle = ACCENT
        circle(ctx, x, y, ring)
        ctx.stroke()
      } else if (hovered) {
        ring += 2.5
        ctx.lineWidth = 1.25
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        circle(ctx, x, y, ring)
        ctx.stroke()
      }

      if (!hidden) lookPointer(ctx, x, y, radius, a, c)

      // Small badges sit beside the token so the number stays clear:
      // bomb or defuse top right, blind top left.
      const d = (radius + 2) * Math.SQRT1_2
      if (!hidden && s.flags & FLAG.defusing) {
        badge(ctx, x + d, y - d, c.deep, 'hud/defuse', '#ffffff')
      } else if (!hidden && s.flags & FLAG.bomb) {
        badge(ctx, x + d, y - d, ACCENT, 'weapon/c4', '#ffffff')
      }
      if (flash > 0.25) badge(ctx, x - d, y - d, '#ffffff', 'kill/blind', BG)

      ctx.globalAlpha = 1
      if (o.names || followed || hovered || strong) {
        const rank = followed ? 3 : hovered ? 2 : strong ? 1 : 0
        labels.push({ text: r.match.players[p].name, x, y, r: ring, alpha, followed, rank })
      }
      this.hits.push({ kind: 'player', id: p, x, y, r: radius })
    }
    return labels
  }

  // drawLabels places name tags so they do not sit on top of each other,
  // on other tokens, or on badges, pills and evidence. Each tag tries
  // below, above, right and left of its token, then moves further down.
  // Tags that find no room are dropped unless they matter.
  private drawLabels(labels: Label[], f: Frame) {
    const { ctx } = this
    ctx.font = `600 11px ${FONT}`
    const H = 17
    const taken = f.tags
    labels.sort((a, b) => b.rank - a.rank)
    for (const l of labels) {
      const w = this.textWidth(l.text) + 12
      const gap = l.r + 4 + H / 2
      const spots: [number, number][] = [
        [l.x, l.y + gap],
        [l.x, l.y - gap],
        [l.x + l.r + 5 + w / 2, l.y],
        [l.x - l.r - 5 - w / 2, l.y],
        [l.x, l.y + gap + 18],
        [l.x, l.y - gap - 18],
        [l.x, l.y + gap + 36],
      ]
      const own = (t: Box) => t.x < l.x && t.x + t.w > l.x && t.y < l.y && t.y + t.h > l.y
      const clear = ([x, y]: [number, number]) => {
        const b = { x: x - w / 2, y: y - H / 2, w, h: H }
        return (
          !taken.some((t) => overlaps(b, t)) &&
          !f.tokens.some((t) => overlaps(b, t) && !own(t)) &&
          !f.solid.some((t) => overlaps(b, t))
        )
      }
      let spot = spots.find(clear)
      if (!spot) {
        if (l.rank === 0) continue
        spot = spots[0]
      }
      const [x, y] = spot
      taken.push({ x: x - w / 2 - 1, y: y - H / 2 - 1, w: w + 2, h: H + 2 })
      ctx.globalAlpha = l.alpha
      if (Math.hypot(x - l.x, y - l.y) > gap + 8) {
        // Short leader line so a moved tag still points at its player.
        const dir = Math.sign(y - l.y) || 1
        ctx.strokeStyle = 'rgba(226,232,240,0.4)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(l.x, l.y + dir * l.r)
        ctx.lineTo(x, y - dir * (H / 2))
        ctx.stroke()
      }
      pill(ctx, x, y, w, H, l.followed ? ACCENT : undefined)
      ctx.fillStyle = l.followed || l.rank > 0 ? '#ffffff' : TEXT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(l.text, x, y + 0.5)
      ctx.globalAlpha = 1
    }
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function grow(b: Box, n: number): Box {
  return { x: b.x - n, y: b.y - n, w: b.w + n * 2, h: b.h + n * 2 }
}

// drawWidth is how wide an icon is at a height, 0 when it is not loaded.
function drawWidth(name: string, h: number): number {
  return icons.has(name) ? Math.round(h * icons.aspect(name)) : 0
}

// pointer is the small arrow outside the token showing where a player
// looks, like the one on the game's radar.
function pointer(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const base = r + 1.8
  const len = Math.max(5, r * 0.62)
  const half = Math.max(3.8, r * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + ca * (base + len), y + sa * (base + len))
  ctx.lineTo(x + ca * base - sa * half, y + sa * base + ca * half)
  ctx.quadraticCurveTo(x + ca * (base + len * 0.28), y + sa * (base + len * 0.28), x + ca * base + sa * half, y + sa * base - ca * half)
  ctx.closePath()
}

// lookPointer draws the pointer filled, on top of any rings.
function lookPointer(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, c: TeamColors) {
  pointer(ctx, x, y, r, a)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.5
  ctx.strokeStyle = EDGE
  ctx.stroke()
  ctx.fillStyle = c.light
  ctx.fill()
}

// token draws a player as a shaded disc.
function token(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: Tint) {
  // Lift it off the map with a soft edge below.
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  circle(ctx, x, y + 1.2, r + 1.6)
  ctx.fill()

  const g = ctx.createLinearGradient(x, y - r, x, y + r)
  g.addColorStop(0, t.top)
  g.addColorStop(1, t.bottom)
  ctx.fillStyle = g
  circle(ctx, x, y, r)
  ctx.fill()
  ctx.lineWidth = 1.25
  ctx.strokeStyle = EDGE
  ctx.stroke()
  // Thin highlight along the top edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, r - 1.3, Math.PI * 1.15, Math.PI * 1.85)
  ctx.stroke()
}

// ghostToken is an enemy the followed player's team cannot see: only an
// outline where they were last.
function ghostToken(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, c: TeamColors) {
  ctx.fillStyle = 'rgba(11,13,17,0.7)'
  circle(ctx, x, y, r)
  ctx.fill()
  ctx.setLineDash([2.5, 2.5])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = c.base
  ctx.stroke()
  ctx.setLineDash([])
  pointer(ctx, x, y, r, a)
  ctx.lineWidth = 1.25
  ctx.stroke()
}

// nadeBadge marks a grenade: its icon on a dark disc ringed in the
// thrower's team colour.
function nadeBadge(ctx: CanvasRenderingContext2D, x: number, y: number, icon: string | null, ring: string) {
  ctx.fillStyle = SHADE
  circle(ctx, x, y, 9)
  ctx.fill()
  ctx.lineWidth = 1.25
  ctx.strokeStyle = ring
  ctx.stroke()
  drawIcon(ctx, icon, x, y, 12, TEXT)
}

// badge is a small disc with an icon, pinned beside a token.
function badge(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, icon: string, ink: string) {
  ctx.fillStyle = fill
  circle(ctx, x, y, 5.5)
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = EDGE
  ctx.stroke()
  drawIcon(ctx, icon, x, y, 7, ink)
}
