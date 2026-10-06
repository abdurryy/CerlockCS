import type { MapView } from '../mapview'
import { BOMB, FLAG, emptyState, type PlayerState, type Replay } from '../replay'
import { EQ, NADE_COLOR } from '../weapons'
import { Camera } from './camera'

export const COLOR = {
  ct: '#5aa9ff',
  t: '#f5a524',
  ctDim: 'rgba(90,169,255,0.55)',
  tDim: 'rgba(245,165,36,0.55)',
  bg: '#0b0f14',
}

// In game teammate colours, used for ghosts and slot badges.
export const SLOT_COLORS = ['#3d8bff', '#3fcf6e', '#f2d23a', '#ff8c2e', '#b16bff', '#9aa4b2']

export function sideColor(side: number): string {
  return side === 3 ? COLOR.ct : COLOR.t
}

export interface ViewOptions {
  follow: number
  rotate: boolean
  teamVision: boolean
  names: boolean
  cones: 'all' | 'follow' | 'none'
  shots: boolean
  paths: boolean
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

interface Hit {
  p: number
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
  hover = -1
  level = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private r: Replay,
    private map: MapView,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.states = Array.from({ length: r.players }, () => emptyState())
  }

  private framed = false

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

  hitTest(sx: number, sy: number): number {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if ((sx - h.x) ** 2 + (sy - h.y) ** 2 <= (h.r + 3) ** 2) return h.p
    }
    return -1
  }

  // radarOf returns a player's radar position at a tick.
  radarOf(p: number, tick: number): [number, number] {
    const s = this.r.state(p, tick, this.ghost)
    return this.map.toRadar(s.x, s.y)
  }

  draw(tick: number, o: ViewOptions, dt: number) {
    const { ctx, r, map, cam } = this
    const round = r.roundIndex(tick)
    const rd = r.round(round)
    for (let p = 0; p < r.players; p++) r.state(p, tick, this.states[p])

    // Camera.
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

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = COLOR.bg
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    // World layers, drawn in radar space.
    cam.apply(ctx, this.dpr)
    const layer = map.layers[this.level]
    if (layer?.image) {
      ctx.imageSmoothingEnabled = true
      ctx.globalAlpha = layer.generated ? 1 : 0.95
      ctx.drawImage(layer.image, 0, 0, 1024, 1024)
      ctx.globalAlpha = 1
    }
    if (o.heat) ctx.drawImage(o.heat, 0, 0, 1024, 1024)

    this.drawInfernos(round, tick)
    this.drawSmokes(round, tick)
    if (o.paths) this.drawProjectiles(round, tick)
    this.drawExplosions(round, tick)
    this.drawKillLines(round, tick)
    if (o.shots) this.drawShots(tick, o)

    // Screen space layers keep a constant size and stay upright.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.drawFlashLines(round, tick)
    this.drawBomb(round, tick)
    this.drawDeaths(round, tick)
    if (o.ghosts >= 0) this.drawGhosts(round, rd.freezeEndTick, tick, o.ghosts)
    this.drawPlayers(o)
  }

  private screen(x: number, y: number): [number, number] {
    const [px, py] = this.map.toRadar(x, y)
    return this.cam.toScreen(px, py)
  }

  private onLevel(z: number): boolean {
    return !this.map.multiLevel || this.map.levelOf(z) === this.level
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
      const alpha = Math.min(1, age / 0.6) * Math.min(1, left / 1.2)
      const [x, y] = map.toRadar(g.pos[0], g.pos[1])
      const rad = map.units(SMOKE_RADIUS)
      const dim = this.onLevel(g.pos[2]) ? 1 : 0.35
      ctx.globalAlpha = alpha * dim
      const grad = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad)
      const tint = g.side === 3 ? '200,214,232' : '222,214,200'
      grad.addColorStop(0, `rgba(${tint},0.85)`)
      grad.addColorStop(0.8, `rgba(${tint},0.7)`)
      grad.addColorStop(1, `rgba(${tint},0.15)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, rad, 0, Math.PI * 2)
      ctx.fill()
      // Remaining time as a ring.
      const total = (stop - g.effectTick) / r.rate
      ctx.strokeStyle = 'rgba(30,36,44,0.8)'
      ctx.lineWidth = rad * 0.08
      ctx.beginPath()
      ctx.arc(x, y, rad * 0.92, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  private drawInfernos(round: number, tick: number) {
    const { ctx, r, map } = this
    const end = r.round(round).officialEndTick
    const flicker = 0.85 + 0.15 * Math.sin(tick / 3)
    for (const inf of r.roundInfernos[round]) {
      const stop = inf.endTick >= 0 ? inf.endTick : end
      if (tick < inf.startTick || tick >= stop || !inf.snapshots?.length) continue
      let snap = inf.snapshots[0]
      for (const s of inf.snapshots) {
        if (s.tick <= tick) snap = s
        else break
      }
      const h = snap.hull
      const left = (stop - tick) / r.rate
      ctx.globalAlpha = Math.min(1, left / 0.8) * flicker
      ctx.fillStyle = 'rgba(255,96,32,0.55)'
      ctx.strokeStyle = 'rgba(255,170,60,0.9)'
      ctx.lineWidth = map.units(10)
      ctx.lineJoin = 'round'
      if (h.length >= 6) {
        ctx.beginPath()
        for (let i = 0; i < h.length; i += 2) {
          const [x, y] = map.toRadar(h[i], h[i + 1])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        for (let i = 0; i < h.length; i += 2) {
          const [x, y] = map.toRadar(h[i], h[i + 1])
          ctx.beginPath()
          ctx.arc(x, y, map.units(FIRE_RADIUS), 0, Math.PI * 2)
          ctx.fill()
        }
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
      const color = NADE_COLOR[g.type] ?? '#ffffff'
      const head = r.grenadePosition(g, tick)
      ctx.globalAlpha = fade * 0.9
      ctx.strokeStyle = color
      ctx.lineWidth = map.units(9)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([map.units(28), map.units(18)])
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
          ctx.fillStyle = color
          ctx.strokeStyle = '#0b0f14'
          ctx.lineWidth = map.units(6)
          ctx.beginPath()
          ctx.arc(hx, hy, map.units(22), 0, Math.PI * 2)
          ctx.fill()
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
      if (g.type === EQ.he && age < 0.6) {
        const k = age / 0.6
        ctx.globalAlpha = 1 - k
        ctx.fillStyle = 'rgba(255,90,60,0.35)'
        ctx.strokeStyle = '#ff6b5a'
        ctx.lineWidth = map.units(14)
        ctx.beginPath()
        ctx.arc(x, y, map.units(HE_RADIUS) * (0.3 + 0.7 * k), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (g.type === EQ.flash && age < 0.45) {
        const k = age / 0.45
        ctx.globalAlpha = 1 - k
        ctx.fillStyle = 'rgba(255,250,210,0.9)'
        ctx.beginPath()
        ctx.arc(x, y, map.units(60 + 260 * k), 0, Math.PI * 2)
        ctx.fill()
      } else if (g.type === EQ.decoy && (g.endTick < 0 || tick < g.endTick)) {
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 6)
        ctx.strokeStyle = NADE_COLOR[EQ.decoy]
        ctx.lineWidth = map.units(8)
        ctx.beginPath()
        ctx.arc(x, y, map.units(40), 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawKillLines(round: number, tick: number) {
    const { ctx, r, map } = this
    for (const k of r.roundKills[round]) {
      const age = (tick - k.tick) / r.rate
      if (age < 0 || age > 1.6 || k.killer < 0) continue
      const [x1, y1] = map.toRadar(k.killerPos[0], k.killerPos[1])
      const [x2, y2] = map.toRadar(k.victimPos[0], k.victimPos[1])
      ctx.globalAlpha = 1 - age / 1.6
      ctx.strokeStyle = k.headshot ? '#ff5d5d' : '#ffffff'
      ctx.lineWidth = map.units(9)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private drawShots(tick: number, o: ViewOptions) {
    const { ctx, r, map } = this
    const window = r.rate * 0.12
    const s = r.shots
    for (let i = r.firstShotAfter(tick - window); i < s.tick.length && s.tick[i] <= tick; i++) {
      const p = s.player[i]
      const w = s.weapon[i]
      if (w >= 400 || p >= r.players) continue
      const st = this.states[p]
      if (!st.alive || !this.onLevel(st.z)) continue
      const age = (tick - s.tick[i]) / window
      const [x, y] = map.toRadar(st.x, st.y)
      const a = (st.yaw * Math.PI) / 180
      const len = map.units(o.follow === p ? 900 : 450)
      ctx.globalAlpha = 1 - age
      ctx.strokeStyle = st.side === 3 ? '#bfe0ff' : '#ffe2a8'
      ctx.lineWidth = map.units(5)
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * map.units(30), y - Math.sin(a) * map.units(30))
      ctx.lineTo(x + Math.cos(a) * len, y - Math.sin(a) * len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
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
      ctx.strokeStyle = enemy ? 'rgba(255,244,176,0.9)' : 'rgba(255,90,90,0.9)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      label(ctx, `${b.duration.toFixed(1)}s`, (x1 + x2) / 2, (y1 + y2) / 2, enemy ? '#fff4b0' : '#ff8080')
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
      ctx.fillStyle = `rgba(255,60,60,${0.15 + 0.25 * pulse})`
      ctx.beginPath()
      ctx.arc(x, y, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ff4d4d'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(x, y, 13, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total)
      ctx.stroke()
    }
    if (b.state === BOMB.exploded) {
      ctx.fillStyle = 'rgba(255,120,40,0.35)'
      ctx.beginPath()
      ctx.arc(x, y, 30, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = b.state === BOMB.defused ? '#3fcf6e' : '#ff4d4d'
    ctx.strokeStyle = '#0b0f14'
    ctx.lineWidth = 1.5
    roundRect(ctx, x - 7, y - 5, 14, 10, 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#0b0f14'
    ctx.font = 'bold 7px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('C4', x, y + 0.5)
  }

  private drawDeaths(round: number, tick: number) {
    const { ctx, r } = this
    for (const k of r.roundKills[round]) {
      if (k.tick > tick) continue
      const [x, y] = this.screen(k.victimPos[0], k.victimPos[1])
      const dim = this.onLevel(k.victimPos[2]) ? 1 : 0.35
      ctx.globalAlpha = 0.75 * dim
      ctx.strokeStyle = k.victimSide === 3 ? COLOR.ct : COLOR.t
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - 5, y - 5)
      ctx.lineTo(x + 5, y + 5)
      ctx.moveTo(x + 5, y - 5)
      ctx.lineTo(x - 5, y + 5)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // drawGhosts shows where a team stood at the same time in every other
  // round they played on the same side. Good for spotting setups and
  // habits.
  private drawGhosts(round: number, freezeEnd: number, tick: number, team: number) {
    const { ctx, r } = this
    const side = r.sideOf(team, round)
    const offset = tick - freezeEnd
    if (offset < 0) return
    const size = Math.max(3, Math.min(6, 3 * Math.sqrt(this.cam.zoom)))
    for (let i = 0; i < r.match.rounds.length; i++) {
      if (i === round || r.sideOf(team, i) !== side) continue
      const rd = r.match.rounds[i]
      const t = rd.freezeEndTick + offset
      if (t > rd.endTick) continue
      for (const p of r.teamPlayers[team]) {
        const s = r.state(p, t, this.ghost)
        if (!s.alive || s.side !== side) continue
        const [x, y] = this.screen(s.x, s.y)
        ctx.globalAlpha = this.onLevel(s.z) ? 0.55 : 0.2
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
    this.hits = []
    const radius = Math.max(6, Math.min(13, 8 * Math.sqrt(cam.zoom)))
    const viewer = o.follow >= 0 ? this.states[o.follow] : null
    const viewerTeam = o.follow >= 0 ? r.match.players[o.follow].team : -1
    let teamMask = 0
    if (o.teamVision && viewerTeam >= 0) {
      for (const p of r.teamPlayers[viewerTeam]) if (p < 32) teamMask |= 1 << p
    }

    // Draw the followed and focused players last so they stay on top.
    const order = [...Array(r.players).keys()].sort((a, b) => weight(a) - weight(b))
    function weight(p: number) {
      return p === o.follow ? 2 : o.focus.includes(p) ? 1 : 0
    }

    for (const p of order) {
      const s = this.states[p]
      if (!s.present || !s.alive) continue
      const [x, y] = this.screen(s.x, s.y)
      const color = sideColor(s.side)
      const enemy = viewerTeam >= 0 && r.match.players[p].team !== viewerTeam
      const hidden = o.teamVision && enemy && (s.spotted & teamMask) === 0
      let alpha = this.onLevel(s.z) ? 1 : 0.35
      if (hidden) alpha *= 0.3
      if (o.focus.length && !o.focus.includes(p) && p !== o.follow) alpha *= 0.45
      ctx.globalAlpha = alpha

      const a = -(s.yaw * Math.PI) / 180 + cam.rot
      const showCone = o.cones === 'all' || (o.cones === 'follow' && (p === o.follow || o.focus.includes(p)))
      if (showCone && !hidden) {
        const len = this.map.units(CONE_LENGTH) * cam.scale
        const grad = ctx.createRadialGradient(x, y, radius, x, y, len)
        const strong = p === o.follow || o.focus.includes(p)
        grad.addColorStop(0, s.side === 3 ? `rgba(90,169,255,${strong ? 0.35 : 0.18})` : `rgba(245,165,36,${strong ? 0.35 : 0.18})`)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, len, a - FOV / 2, a + FOV / 2)
        ctx.closePath()
        ctx.fill()
      }

      // Direction pointer.
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * (radius + 6), y + Math.sin(a) * (radius + 6))
      ctx.lineTo(x + Math.cos(a + 0.55) * radius * 0.95, y + Math.sin(a + 0.55) * radius * 0.95)
      ctx.lineTo(x + Math.cos(a - 0.55) * radius * 0.95, y + Math.sin(a - 0.55) * radius * 0.95)
      ctx.closePath()
      ctx.fill()

      // Body.
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = hidden ? 'rgba(20,24,30,0.9)' : color
      ctx.fill()
      ctx.lineWidth = p === o.follow ? 3 : 1.5
      ctx.strokeStyle = p === o.follow ? '#ffffff' : hidden ? color : '#0b0f14'
      if (hidden) ctx.setLineDash([3, 3])
      ctx.stroke()
      ctx.setLineDash([])

      // Health ring.
      if (s.hp < 100) {
        ctx.strokeStyle = s.hp > 50 ? '#3fcf6e' : s.hp > 20 ? '#f2d23a' : '#ff4d4d'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, y, radius + 2.5, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.hp) / 100)
        ctx.stroke()
      }

      // Flashed players light up white.
      if (s.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, s.flash / 2.5)})`
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.fillStyle = '#0b0f14'
      ctx.font = `bold ${Math.round(radius * 1.05)}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(r.slot[p] || ''), x, y + 0.5)

      if (s.flags & FLAG.bomb) {
        ctx.fillStyle = '#ff4d4d'
        ctx.strokeStyle = '#0b0f14'
        ctx.lineWidth = 1
        roundRect(ctx, x + radius * 0.45, y - radius - 2, 8, 6, 1.5)
        ctx.fill()
        ctx.stroke()
      }
      if (s.flags & (FLAG.defusing | FLAG.planting)) {
        const t = performance.now() / 300
        ctx.strokeStyle = s.flags & FLAG.defusing ? '#5aa9ff' : '#ff4d4d'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, y, radius + 6, t, t + Math.PI * 1.2)
        ctx.stroke()
      }

      if (o.names || p === o.follow || p === this.hover) {
        label(ctx, r.match.players[p].name, x, y + radius + 10, p === o.follow ? '#ffffff' : '#c9d1d9')
      }
      ctx.globalAlpha = 1
      this.hits.push({ p, x, y, r: radius })
    }
    if (viewer && !viewer.alive && viewer.present) {
      const [x, y] = this.screen(viewer.x, viewer.y)
      label(ctx, `${r.match.players[o.follow].name} (dead)`, x, y - 16, '#ff8080')
    }
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '600 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(8,11,15,0.85)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
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
