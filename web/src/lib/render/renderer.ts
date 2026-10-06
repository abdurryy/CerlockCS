import { PLATE_PAD, type MapView } from '../mapview'
import { BOMB, FLAG, emptyState, type PlayerState, type Replay } from '../replay'
import type { Blunder } from '../types'
import { EQ } from '../weapons'
import { Camera } from './camera'

export const INK = '#0e1013'
export const PAPER = '#ece6da'
export const MARKER = '#e5484d'
export const EVIDENCE = '#f2c14e'

interface TeamColors {
  base: string
  light: string
  dark: string
  rgb: string
  chalk: string
}

export const TEAM: Record<number, TeamColors> = {
  3: { base: '#7eaad9', light: '#c4dbf2', dark: '#33597f', rgb: '126,170,217', chalk: '#b8c9dc' },
  2: { base: '#dda34a', light: '#f5d699', dark: '#8a5a17', rgb: '221,163,74', chalk: '#e2c9a0' },
}

export function teamColor(side: number): TeamColors {
  return TEAM[side] ?? TEAM[2]
}

// Muted versions of the in game teammate colours.
export const SLOT_COLORS = ['#7eaad9', '#8fbf9a', '#e8cf7a', '#e39a64', '#b59ad6', '#9c978c']

export const NADE: Record<number, string> = {
  [EQ.smoke]: '#d6d2c8',
  [EQ.flash]: '#fff1b8',
  [EQ.he]: '#e5484d',
  [EQ.molotov]: '#f08a3c',
  [EQ.incendiary]: '#f08a3c',
  [EQ.decoy]: '#8fbf9a',
}

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
const HE_RADIUS = 350
const CONE_LENGTH = 650
const FOV = (90 * Math.PI) / 180
const SANS = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'
const SERIF = 'Fraunces, Georgia, serif'

export interface Hit {
  kind: 'player' | 'blunder'
  id: number
  x: number
  y: number
  r: number
}

export class Renderer {
  readonly cam = new Camera()
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private states: PlayerState[]
  private ghost = emptyState()
  private hits: Hit[] = []
  private smoke: Record<number, HTMLCanvasElement>
  private framed = false
  hover: Hit | null = null
  level = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private r: Replay,
    private map: MapView,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.states = Array.from({ length: r.players }, () => emptyState())
    this.smoke = { 3: smokeSprite('201,207,214'), 2: smokeSprite('214,206,194') }
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
  // a lot of empty space around them.
  home() {
    const [x0, y0, x1, y1] = this.map.bounds
    const cam = this.cam
    cam.rot = 0
    cam.cx = (x0 + x1) / 2
    cam.cy = (y0 + y1) / 2
    const base = Math.min(cam.w, cam.h) / 1024
    cam.zoom = Math.max(0.6, Math.min(cam.w / (x1 - x0), cam.h / (y1 - y0)) / base)
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

    // Desk.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const bg = ctx.createRadialGradient(cam.w / 2, cam.h / 2, 0, cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.75)
    bg.addColorStop(0, '#15171b')
    bg.addColorStop(1, INK)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, cam.w, cam.h)

    // World layers in radar space.
    cam.apply(ctx, this.dpr)
    this.drawGrid()
    const layer = map.layers[this.level]
    if (layer?.plate) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(layer.plate, -PLATE_PAD, -PLATE_PAD)
    }
    if (o.heat) ctx.drawImage(o.heat, 0, 0, 1024, 1024)
    this.drawInfernos(round, tick)
    this.drawSmokes(round, tick)
    if (o.paths) this.drawProjectiles(round, tick)
    this.drawExplosions(round, tick)

    // Everything else in screen space so sizes stay constant and text
    // stays upright.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.hits = []
    if (o.callouts) this.drawCallouts()
    this.drawSites()
    this.drawKillLines(round, tick)
    if (o.shots) this.drawShots(tick, o)
    this.drawFlashLines(round, tick)
    this.drawBomb(round, tick)
    this.drawDeaths(round, tick)
    if (o.evidence) this.drawEvidence(round, tick)
    if (o.ghosts >= 0) this.drawGhosts(round, rd.freezeEndTick, tick, o.ghosts)
    this.drawPlayers(o)
    this.drawVignette()
  }

  private screen(x: number, y: number): [number, number] {
    const [px, py] = this.map.toRadar(x, y)
    return this.cam.toScreen(px, py)
  }

  private onLevel(z: number): boolean {
    return !this.map.multiLevel || this.map.levelOf(z) === this.level
  }

  // drawGrid draws a faint survey grid every 512 world units, with a
  // stronger line every 2048.
  private drawGrid() {
    const { ctx, map, cam } = this
    const step = map.units(512)
    const from = -512
    const to = 1536
    ctx.lineWidth = 1 / cam.scale
    const lines = (origin: number, vertical: boolean) => {
      const first = Math.ceil((from - origin) / step)
      for (let i = first; origin + i * step <= to; i++) {
        const v = origin + i * step
        ctx.strokeStyle = i % 4 === 0 ? 'rgba(236,230,218,0.07)' : 'rgba(236,230,218,0.035)'
        ctx.beginPath()
        if (vertical) {
          ctx.moveTo(v, from)
          ctx.lineTo(v, to)
        } else {
          ctx.moveTo(from, v)
          ctx.lineTo(to, v)
        }
        ctx.stroke()
      }
    }
    // World x = 0 and y = 0 in radar pixels, so grid lines sit on round
    // world coordinates.
    const [ox, oy] = map.toRadar(0, 0)
    lines(ox, true)
    lines(oy, false)
  }

  private drawVignette() {
    const { ctx, cam } = this
    const g = ctx.createRadialGradient(cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.45, cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.8)
    g.addColorStop(0, 'rgba(14,16,19,0)')
    g.addColorStop(1, 'rgba(14,16,19,0.6)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cam.w, cam.h)
  }

  private drawCallouts() {
    const { ctx, map, cam } = this
    if (cam.zoom < 0.9) return
    ctx.font = `500 9.5px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setSpacing(ctx, '0.1em')
    const placed: [number, number, number, number][] = []
    for (const c of map.callouts) {
      if (c.level !== this.level) continue
      const [x, y] = cam.toScreen(c.x, c.y)
      if (x < -50 || y < -20 || x > cam.w + 50 || y > cam.h + 20) continue
      const text = c.name.toUpperCase()
      const w = ctx.measureText(text).width + 8
      const box: [number, number, number, number] = [x - w / 2, y - 7, x + w / 2, y + 7]
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue
      placed.push(box)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(14,16,19,0.75)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = 'rgba(236,230,218,0.55)'
      ctx.fillText(text, x, y)
    }
    setSpacing(ctx, '0px')
  }

  private drawSites() {
    const { ctx, map, cam } = this
    for (const s of map.sites) {
      if (s.level !== this.level) continue
      const [x, y] = cam.toScreen(s.x, s.y)
      const rad = Math.max(13, Math.min(22, 14 * Math.sqrt(cam.zoom)))
      ctx.strokeStyle = 'rgba(229,72,77,0.55)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, rad, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(229,72,77,0.75)'
      ctx.font = `600 ${Math.round(rad * 1.15)}px ${SERIF}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.name, x, y + 1)
    }
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
      const grow = Math.min(1, age / 0.8)
      const alpha = Math.min(1, age / 0.5) * Math.min(1, left / 1.5)
      const [x, y] = map.toRadar(g.pos[0], g.pos[1])
      const rad = map.units(SMOKE_RADIUS) * (0.75 + 0.25 * grow)
      ctx.globalAlpha = alpha * (this.onLevel(g.pos[2]) ? 0.92 : 0.3)
      ctx.drawImage(this.smoke[g.side === 3 ? 3 : 2], x - rad * 1.12, y - rad * 1.12, rad * 2.24, rad * 2.24)
      // Remaining time.
      const total = (stop - g.effectTick) / r.rate
      ctx.globalAlpha = alpha * 0.8
      ctx.strokeStyle = 'rgba(14,16,19,0.55)'
      ctx.lineWidth = rad * 0.05
      ctx.beginPath()
      ctx.arc(x, y, rad * 0.86, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  private drawInfernos(round: number, tick: number) {
    const { ctx, r, map } = this
    const end = r.round(round).officialEndTick
    for (const inf of r.roundInfernos[round]) {
      const stop = inf.endTick >= 0 ? inf.endTick : end
      if (tick < inf.startTick || tick >= stop || !inf.snapshots?.length) continue
      let snap = inf.snapshots[0]
      for (const s of inf.snapshots) {
        if (s.tick <= tick) snap = s
        else break
      }
      const h = snap.hull
      if (!h.length) continue
      const left = (stop - tick) / r.rate
      const fade = Math.min(1, left / 0.8)
      let cx = 0
      let cy = 0
      const pts: [number, number][] = []
      for (let i = 0; i < h.length; i += 2) {
        const p = map.toRadar(h[i], h[i + 1])
        pts.push(p)
        cx += p[0]
        cy += p[1]
      }
      cx /= pts.length
      cy /= pts.length
      const reach = map.units(FIRE_RADIUS)
      let maxR = reach
      for (const [x, y] of pts) maxR = Math.max(maxR, Math.hypot(x - cx, y - cy) + reach)
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
      grad.addColorStop(0, 'rgba(255,200,110,0.8)')
      grad.addColorStop(0.55, 'rgba(240,120,50,0.6)')
      grad.addColorStop(1, 'rgba(200,50,40,0.35)')
      ctx.globalAlpha = fade
      ctx.fillStyle = grad
      ctx.lineJoin = 'round'
      ctx.lineWidth = reach * 1.4
      ctx.strokeStyle = 'rgba(230,90,45,0.45)'
      ctx.beginPath()
      if (pts.length >= 3) {
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.closePath()
        ctx.stroke()
        ctx.fill()
      } else {
        for (const [x, y] of pts) {
          ctx.moveTo(x + reach, y)
          ctx.arc(x, y, reach, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      // Embers.
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]
        const flick = 0.5 + 0.5 * Math.sin(tick / 2.7 + i * 1.7)
        ctx.globalAlpha = fade * (0.4 + 0.5 * flick)
        ctx.fillStyle = '#ffd38a'
        ctx.beginPath()
        ctx.arc(x, y, map.units(9 + 6 * flick), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  private drawProjectiles(round: number, tick: number) {
    const { ctx, r, map } = this
    const { x: nx, y: ny, tick: nt } = r.nade
    for (const g of r.roundGrenades[round]) {
      if (g.pathLen < 2 || tick < g.throwTick) continue
      const landed = g.effectTick >= 0 && tick >= g.effectTick
      const fade = landed ? 1 - (tick - g.effectTick) / (r.rate * 1.2) : 1
      if (fade <= 0) continue
      const color = NADE[g.type] ?? PAPER
      const head = r.grenadePosition(g, tick)
      ctx.globalAlpha = fade * 0.85
      ctx.strokeStyle = color
      ctx.lineWidth = map.units(7)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([map.units(4), map.units(22)])
      ctx.beginPath()
      const end = g.pathStart + g.pathLen
      for (let i = g.pathStart; i < end && nt[i] <= tick; i++) {
        const [x, y] = map.toRadar(nx[i], ny[i])
        if (i === g.pathStart) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      if (head) {
        const [hx, hy] = map.toRadar(head[0], head[1])
        ctx.lineTo(hx, hy)
        ctx.stroke()
        ctx.setLineDash([])
        if (!landed) {
          ctx.shadowColor = color
          ctx.shadowBlur = 8
          ctx.fillStyle = color
          ctx.strokeStyle = INK
          ctx.lineWidth = map.units(5)
          ctx.beginPath()
          ctx.arc(hx, hy, map.units(18), 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.stroke()
        }
      } else {
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }

  private drawExplosions(round: number, tick: number) {
    const { ctx, r, map } = this
    for (const g of r.roundGrenades[round]) {
      if (g.effectTick < 0 || tick < g.effectTick) continue
      const age = (tick - g.effectTick) / r.rate
      const [x, y] = map.toRadar(g.pos[0], g.pos[1])
      if (g.type === EQ.he && age < 0.7) {
        const k = age / 0.7
        const rad = map.units(HE_RADIUS) * (0.25 + 0.75 * Math.sqrt(k))
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
        grad.addColorStop(0, `rgba(255,210,150,${0.6 * (1 - k)})`)
        grad.addColorStop(0.7, `rgba(229,72,77,${0.35 * (1 - k)})`)
        grad.addColorStop(1, 'rgba(229,72,77,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(x, y, rad, 0, Math.PI * 2)
        ctx.fill()
      } else if (g.type === EQ.flash && age < 0.5) {
        const k = age / 0.5
        const rad = map.units(80 + 300 * Math.sqrt(k))
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
        grad.addColorStop(0, `rgba(255,252,235,${0.95 * (1 - k)})`)
        grad.addColorStop(1, 'rgba(255,252,235,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(x, y, rad, 0, Math.PI * 2)
        ctx.fill()
      } else if (g.type === EQ.decoy && (g.endTick < 0 || tick < g.endTick)) {
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(tick / 6)
        ctx.strokeStyle = NADE[EQ.decoy]
        ctx.lineWidth = map.units(6)
        ctx.beginPath()
        ctx.arc(x, y, map.units(36), 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  private drawKillLines(round: number, tick: number) {
    const { ctx, r } = this
    for (const k of r.roundKills[round]) {
      const age = (tick - k.tick) / r.rate
      if (age < 0 || age > 1.8 || k.killer < 0) continue
      const [x1, y1] = this.screen(k.killerPos[0], k.killerPos[1])
      const [x2, y2] = this.screen(k.victimPos[0], k.victimPos[1])
      ctx.globalAlpha = 1 - age / 1.8
      ctx.strokeStyle = MARKER
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      if (k.headshot) {
        ctx.fillStyle = PAPER
        ctx.beginPath()
        ctx.arc(x2, y2, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawShots(tick: number, o: ViewOptions) {
    const { ctx, r, map, cam } = this
    const window = r.rate * 0.14
    const s = r.shots
    for (let i = r.firstShotAfter(tick - window); i < s.tick.length && s.tick[i] <= tick; i++) {
      const p = s.player[i]
      if (s.weapon[i] >= 400 || p >= r.players) continue
      const st = this.states[p]
      if (!st.alive || !this.onLevel(st.z)) continue
      const age = (tick - s.tick[i]) / window
      const [x, y] = this.screen(st.x, st.y)
      const a = -(st.yaw * Math.PI) / 180 + cam.rot
      const len = map.units(o.follow === p ? 900 : 480) * cam.scale
      const g = ctx.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len)
      const c = teamColor(st.side)
      g.addColorStop(0, `rgba(${c.rgb},${0.9 * (1 - age)})`)
      g.addColorStop(1, `rgba(${c.rgb},0)`)
      ctx.strokeStyle = g
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12)
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
      ctx.stroke()
    }
  }

  private drawFlashLines(round: number, tick: number) {
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
      ctx.globalAlpha = 1 - age / 1.8
      ctx.strokeStyle = enemy ? 'rgba(255,241,184,0.85)' : MARKER
      ctx.lineWidth = 1.2
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      tag(ctx, `${b.duration.toFixed(1)}s`, (x1 + x2) / 2, (y1 + y2) / 2, enemy ? '#fff1b8' : MARKER, MONO)
    }
    ctx.globalAlpha = 1
  }

  private drawBomb(round: number, tick: number) {
    const { ctx, r } = this
    const b = r.bombAt(tick)
    if (b.state !== BOMB.dropped && b.state !== BOMB.planted && b.state !== BOMB.defused && b.state !== BOMB.exploded) return
    const [x, y] = this.screen(b.x, b.y)
    if (b.state === BOMB.planted) {
      const plant = r.roundBomb[round].find((e) => e.kind === 'planted' && e.tick <= tick)
      const total = r.round(round).bombTime
      const left = plant ? Math.max(0, total - (tick - plant.tick) / r.rate) : total
      const pulse = 0.5 + 0.5 * Math.sin(tick / (left < 10 ? 2 : 5))
      const g = ctx.createRadialGradient(x, y, 0, x, y, 26)
      g.addColorStop(0, `rgba(229,72,77,${0.25 + 0.3 * pulse})`)
      g.addColorStop(1, 'rgba(229,72,77,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, 26, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(14,16,19,0.7)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, 14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = MARKER
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
      ctx.stroke()
    }
    if (b.state === BOMB.exploded) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 40)
      g.addColorStop(0, 'rgba(255,170,90,0.5)')
      g.addColorStop(1, 'rgba(229,72,77,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, 40, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 4
    ctx.fillStyle = b.state === BOMB.defused ? '#5bae8c' : MARKER
    roundRect(ctx, x - 8, y - 5.5, 16, 11, 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = INK
    ctx.font = `600 7.5px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('C4', x, y + 0.5)
  }

  // Deaths are drawn as chalk crosses where the player fell.
  private drawDeaths(round: number, tick: number) {
    const { ctx, r } = this
    ctx.lineCap = 'round'
    for (const k of r.roundKills[round]) {
      if (k.tick > tick) continue
      const [x, y] = this.screen(k.victimPos[0], k.victimPos[1])
      const c = teamColor(k.victimSide)
      const base = this.onLevel(k.victimPos[2]) ? 0.8 : 0.3
      ctx.strokeStyle = c.chalk
      // Two passes, slightly offset, so the cross looks drawn by hand.
      const passes: [number, number, number][] = [
        [2.2, 0.85, 0],
        [1, 0.45, 0.8],
      ]
      for (const [w, a, off] of passes) {
        ctx.lineWidth = w
        ctx.globalAlpha = base * a
        ctx.beginPath()
        ctx.moveTo(x - 5 + off, y - 5)
        ctx.lineTo(x + 5 + off, y + 5 - off)
        ctx.moveTo(x + 5, y - 5 + off)
        ctx.lineTo(x - 5 + off, y + 5)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  // Evidence markers flag blunders on the map, numbered per round like the
  // tents at a crime scene.
  private drawEvidence(round: number, tick: number) {
    const { ctx } = this
    const list = this.r.roundBlunders[round]
    list.forEach((b: Blunder, i) => {
      if (b.tick > tick || (!b.pos[0] && !b.pos[1])) return
      if (this.map.multiLevel && b.pos[2] !== 0 && this.map.levelOf(b.pos[2]) !== this.level) return
      const [x, y] = this.screen(b.pos[0], b.pos[1])
      const ty = y - 16
      ctx.strokeStyle = 'rgba(242,193,78,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, ty + 9)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 5
      ctx.shadowOffsetY = 1
      ctx.fillStyle = EVIDENCE
      ctx.beginPath()
      ctx.moveTo(x - 7, ty + 9)
      ctx.lineTo(x - 4.5, ty - 6)
      ctx.lineTo(x + 4.5, ty - 6)
      ctx.lineTo(x + 7, ty + 9)
      ctx.closePath()
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowOffsetY = 0
      ctx.strokeStyle = 'rgba(14,16,19,0.8)'
      ctx.stroke()
      ctx.fillStyle = INK
      ctx.font = `600 9px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), x, ty + 2)
      this.hits.push({ kind: 'blunder', id: this.r.blunders.indexOf(b), x, y: ty + 1, r: 8 })
    })
  }

  // drawGhosts shows where a team stood at the same time in every other
  // round they played on the same side.
  private drawGhosts(round: number, freezeEnd: number, tick: number, team: number) {
    const { ctx, r, cam } = this
    const side = r.sideOf(team, round)
    const offset = tick - freezeEnd
    if (offset < 0) return
    const size = Math.max(2.5, Math.min(5, 2.5 * Math.sqrt(cam.zoom)))
    for (let i = 0; i < r.match.rounds.length; i++) {
      if (i === round || r.sideOf(team, i) !== side) continue
      const rd = r.match.rounds[i]
      const t = rd.freezeEndTick + offset
      if (t > rd.endTick) continue
      for (const p of r.teamPlayers[team]) {
        const s = r.state(p, t, this.ghost)
        if (!s.alive || s.side !== side) continue
        const [x, y] = this.screen(s.x, s.y)
        ctx.globalAlpha = this.onLevel(s.z) ? 0.6 : 0.2
        ctx.fillStyle = SLOT_COLORS[(r.slot[p] - 1) % SLOT_COLORS.length]
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawPlayers(o: ViewOptions) {
    const { ctx, r, cam } = this
    const radius = Math.max(6.5, Math.min(12, 7.5 * Math.sqrt(cam.zoom)))
    const viewerTeam = o.follow >= 0 ? r.match.players[o.follow].team : -1
    let teamMask = 0
    if (o.teamVision && viewerTeam >= 0) {
      for (const p of r.teamPlayers[viewerTeam]) if (p < 32) teamMask |= 1 << p
    }
    const weight = (p: number) => (p === o.follow ? 2 : o.focus.includes(p) ? 1 : 0)
    const order = [...Array(r.players).keys()].sort((a, b) => weight(a) - weight(b))
    const labels: Label[] = []
    const tokens: Box[] = []

    for (const p of order) {
      const s = this.states[p]
      if (!s.present || !s.alive) continue
      const [x, y] = this.screen(s.x, s.y)
      const c = teamColor(s.side)
      const enemy = viewerTeam >= 0 && r.match.players[p].team !== viewerTeam
      const hidden = o.teamVision && enemy && (s.spotted & teamMask) === 0
      let alpha = this.onLevel(s.z) ? 1 : 0.35
      if (hidden) alpha *= 0.35
      if (o.focus.length && !o.focus.includes(p) && p !== o.follow) alpha *= 0.45
      const a = -(s.yaw * Math.PI) / 180 + cam.rot
      const followed = p === o.follow
      const strong = followed || o.focus.includes(p)
      ctx.globalAlpha = alpha

      // View cone.
      const showCone = o.cones === 'all' || (o.cones === 'follow' && strong)
      if (showCone && !hidden) {
        const len = this.map.units(CONE_LENGTH) * cam.scale
        const grad = ctx.createRadialGradient(x, y, radius, x, y, len)
        grad.addColorStop(0, `rgba(${c.rgb},${strong ? 0.3 : 0.14})`)
        grad.addColorStop(1, `rgba(${c.rgb},0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, len, a - FOV / 2, a + FOV / 2)
        ctx.closePath()
        ctx.fill()
      }

      // Flash bloom around the token.
      if (s.flash > 0) {
        const bloom = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 2.6)
        bloom.addColorStop(0, `rgba(255,253,240,${Math.min(0.95, s.flash / 2.2)})`)
        bloom.addColorStop(1, 'rgba(255,253,240,0)')
        ctx.fillStyle = bloom
        ctx.beginPath()
        ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2)
        ctx.fill()
      }

      token(ctx, x, y, radius, a, c, hidden)

      // Health ring.
      if (s.hp < 100 && !hidden) {
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(14,16,19,0.7)'
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = s.hp > 50 ? '#5bae8c' : s.hp > 20 ? EVIDENCE : MARKER
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.hp) / 100)
        ctx.stroke()
      }

      ctx.fillStyle = hidden ? c.base : INK
      ctx.font = `600 ${Math.round(radius * 1.05)}px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(hidden ? '?' : String(r.slot[p] || ''), x, y + 0.5)

      if (s.flags & FLAG.bomb) {
        ctx.fillStyle = MARKER
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.2
        roundRect(ctx, x + radius * 0.35, y - radius - 3, 9, 6.5, 1.5)
        ctx.fill()
        ctx.stroke()
      }
      if (s.flags & (FLAG.defusing | FLAG.planting)) {
        const t = performance.now() / 300
        ctx.strokeStyle = s.flags & FLAG.defusing ? c.light : MARKER
        ctx.lineWidth = 2
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(x, y, radius + 7, t, t + Math.PI * 1.4)
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (followed) markerRing(ctx, x, y, radius + 8)

      ctx.globalAlpha = 1
      const hovered = this.hover?.kind === 'player' && this.hover.id === p
      if (o.names || followed || hovered || strong) {
        const rank = followed ? 3 : hovered ? 2 : strong ? 1 : 0
        labels.push({ text: r.match.players[p].name, x, y, r: radius, alpha, followed, rank })
      }
      tokens.push({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 })
      this.hits.push({ kind: 'player', id: p, x, y, r: radius })
    }
    // Names last so tokens never cover them.
    this.drawLabels(labels, tokens)
  }

  // drawLabels places name tags so they do not sit on top of each other.
  // Each tag tries below, above, right and left of its token, then moves
  // further down. Tags that find no room are dropped unless they matter.
  private drawLabels(labels: Label[], tokens: Box[]) {
    const { ctx } = this
    ctx.font = `500 10.5px ${SANS}`
    const taken: Box[] = []
    labels.sort((a, b) => b.rank - a.rank)
    for (const l of labels) {
      const w = ctx.measureText(l.text).width + 10
      const gap = l.r + 11
      const spots: [number, number][] = [
        [l.x, l.y + gap],
        [l.x, l.y - gap],
        [l.x + l.r + 6 + w / 2, l.y],
        [l.x - l.r - 6 - w / 2, l.y],
        [l.x, l.y + gap + 16],
        [l.x, l.y - gap - 16],
        [l.x, l.y + gap + 32],
      ]
      const others = (b: Box) => tokens.some((t) => overlaps(b, t) && !(t.x < l.x && t.x + t.w > l.x && t.y < l.y && t.y + t.h > l.y))
      let spot = spots.find(([x, y]) => {
        const b = { x: x - w / 2, y: y - 7.5, w, h: 15 }
        return !taken.some((t) => overlaps(b, t)) && !others(b)
      })
      if (!spot) {
        if (l.rank === 0) continue
        spot = spots[0]
      }
      const [x, y] = spot
      taken.push({ x: x - w / 2 - 1, y: y - 8.5, w: w + 2, h: 17 })
      ctx.globalAlpha = l.alpha
      if (Math.hypot(x - l.x, y - l.y) > gap + 8) {
        // Short leader line so a moved tag still points at its player.
        ctx.strokeStyle = 'rgba(236,230,218,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(l.x, l.y + Math.sign(y - l.y) * l.r)
        ctx.lineTo(x, y - Math.sign(y - l.y) * 7.5)
        ctx.stroke()
      }
      nameTag(ctx, l.text, x, y, l.followed)
      ctx.globalAlpha = 1
    }
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
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

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// token draws a player as a shaded drop pointing where they look.
function token(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, c: TeamColors, hidden: boolean) {
  const tip = r * 1.75
  const t = Math.acos(r / tip)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x + Math.cos(a) * tip, y + Math.sin(a) * tip)
  ctx.arc(x, y, r, a + t, a - t + Math.PI * 2)
  ctx.closePath()
  if (hidden) {
    ctx.fillStyle = 'rgba(14,16,19,0.85)'
    ctx.fill()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = c.base
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.7)
  g.addColorStop(0, c.light)
  g.addColorStop(0.55, c.base)
  g.addColorStop(1, c.dark)
  ctx.fillStyle = g
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1.3
  ctx.strokeStyle = 'rgba(14,16,19,0.9)'
  ctx.stroke()
  // Soft highlight on the upper left edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, r * 0.72, Math.PI * 1.05, Math.PI * 1.55)
  ctx.stroke()
  ctx.restore()
}

// markerRing is a quick red pen circle around the followed player.
function markerRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const alpha = ctx.globalAlpha
  ctx.strokeStyle = MARKER
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.ellipse(x, y, r, r * 0.92, -0.3, 0.2, Math.PI * 2.05)
  ctx.stroke()
  ctx.globalAlpha = alpha * 0.5
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(x + 0.6, y - 0.4, r + 1.6, r * 0.95 + 1.2, 0.25, 0, Math.PI * 1.85)
  ctx.stroke()
  ctx.globalAlpha = alpha
}

function nameTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, followed: boolean) {
  ctx.font = `500 10.5px ${SANS}`
  const w = ctx.measureText(text).width + 10
  ctx.fillStyle = 'rgba(14,16,19,0.82)'
  roundRect(ctx, x - w / 2, y - 7.5, w, 15, 2)
  ctx.fill()
  if (followed) {
    ctx.fillStyle = MARKER
    ctx.fillRect(x - w / 2, y + 6.5, w, 1.5)
  }
  ctx.fillStyle = followed ? '#ffffff' : PAPER
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: string) {
  ctx.font = `500 10px ${font}`
  const w = ctx.measureText(text).width + 8
  ctx.fillStyle = 'rgba(14,16,19,0.85)'
  roundRect(ctx, x - w / 2, y - 7, w, 14, 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = v
}

// smokeSprite builds a soft, cloudy disc once so smokes look like smoke
// instead of flat circles.
function smokeSprite(rgb: string): HTMLCanvasElement {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const puff = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${rgb},${a})`)
    g.addColorStop(0.7, `rgba(${rgb},${a * 0.6})`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  puff(128, 128, 112, 0.85)
  for (let i = 0; i < 22; i++) {
    const ang = rand() * Math.PI * 2
    const d = 60 + rand() * 40
    puff(128 + Math.cos(ang) * d, 128 + Math.sin(ang) * d, 22 + rand() * 22, 0.35 + rand() * 0.3)
  }
  // Light from the upper left gives it some volume.
  const shade = ctx.createRadialGradient(108, 104, 0, 128, 128, 120)
  shade.addColorStop(0, 'rgba(255,255,255,0.16)')
  shade.addColorStop(1, 'rgba(0,0,0,0.14)')
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, S, S)
  return c
}
