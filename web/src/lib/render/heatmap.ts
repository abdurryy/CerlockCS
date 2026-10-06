import type { MapView } from '../mapview'
import { FLAG, type Replay } from '../replay'

export type HeatKind = 'positions' | 'deaths' | 'kills'

export interface HeatConfig {
  players: number[]
  kind: HeatKind
  // 0 for both sides, otherwise 2 (T) or 3 (CT).
  side: number
  level: number
}

const G = 256
const CELL = 1024 / G

// Colour ramp from transparent blue through yellow to red.
const RAMP: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [40, 90, 255, 0.35],
  [40, 210, 255, 0.55],
  [250, 230, 60, 0.75],
  [255, 120, 30, 0.85],
  [255, 40, 40, 0.95],
]

function ramp(v: number): [number, number, number, number] {
  const x = Math.min(0.9999, Math.max(0, v)) * (RAMP.length - 1)
  const i = Math.floor(x)
  const t = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

// buildHeatmap renders a heatmap in radar space (1024x1024).
export function buildHeatmap(r: Replay, map: MapView, cfg: HeatConfig): HTMLCanvasElement {
  const grid = new Float32Array(G * G)
  const kernel = cfg.kind === 'positions' ? 2 : 4
  const splat = (x: number, y: number, z: number, w: number) => {
    if (map.multiLevel && map.levelOf(z) !== cfg.level) return
    const [px, py] = map.toRadar(x, y)
    const gx = px / CELL
    const gy = py / CELL
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    for (let dy = -kernel; dy <= kernel; dy++) {
      for (let dx = -kernel; dx <= kernel; dx++) {
        const cx = x0 + dx
        const cy = y0 + dy
        if (cx < 0 || cy < 0 || cx >= G || cy >= G) continue
        const d2 = (cx + 0.5 - gx) ** 2 + (cy + 0.5 - gy) ** 2
        grid[cy * G + cx] += w * Math.exp(-d2 / (kernel * kernel * 0.5))
      }
    }
  }

  const players = new Set(cfg.players)
  if (cfg.kind === 'positions') {
    const F = r.frames
    // Only count live round time, freeze time would dominate otherwise.
    const live = new Uint8Array(F)
    for (const rd of r.match.rounds) {
      const a = r.frameIndex(rd.freezeEndTick)
      const b = r.frameIndex(rd.endTick)
      live.fill(1, a, b + 1)
    }
    for (const p of players) {
      for (let f = 0; f < F; f += 4) {
        if (!live[f]) continue
        const i = p * F + f
        if (!(r.pflags[i] & FLAG.alive)) continue
        if (cfg.side && r.pside[i] !== cfg.side) continue
        splat(r.px[i], r.py[i], r.pz[i], 1)
      }
    }
  } else {
    for (const k of r.kills) {
      if (cfg.kind === 'deaths' && players.has(k.victim) && (!cfg.side || k.victimSide === cfg.side)) {
        splat(k.victimPos[0], k.victimPos[1], k.victimPos[2], 1)
      }
      if (cfg.kind === 'kills' && players.has(k.killer) && (!cfg.side || k.killerSide === cfg.side)) {
        splat(k.killerPos[0], k.killerPos[1], k.killerPos[2], 1)
      }
    }
  }

  let max = 0
  for (const v of grid) if (v > max) max = v
  const small = document.createElement('canvas')
  small.width = G
  small.height = G
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(G, G)
  if (max > 0) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] <= 0) continue
      const [cr, cg, cb, ca] = ramp(Math.sqrt(grid[i] / max))
      img.data[i * 4] = cr
      img.data[i * 4 + 1] = cg
      img.data[i * 4 + 2] = cb
      img.data[i * 4 + 3] = ca * 255
    }
  }
  sctx.putImageData(img, 0, 0)
  const out = document.createElement('canvas')
  out.width = 1024
  out.height = 1024
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, 1024, 1024)
  return out
}
