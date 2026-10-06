import { mapInfo } from './api'
import { FLAG, type Replay } from './replay'
import type { MapInfo, MapLevel } from './types'

const SIZE = 1024

export interface Layer {
  level: MapLevel
  // The radar image, or a floor plan drawn from where players walked when
  // no image is available.
  image: CanvasImageSource | null
  generated: boolean
}

// MapView converts world coordinates to radar pixels. Radar space is always
// 1024x1024 regardless of the image resolution, as in the game's overview
// files.
export class MapView {
  readonly name: string
  posX: number
  posY: number
  scale: number
  readonly layers: Layer[]
  readonly known: boolean
  // bounds is the part of the radar players actually used, in radar pixels.
  bounds: [number, number, number, number] = [0, 0, 1024, 1024]

  private constructor(info: MapInfo, layers: Layer[]) {
    this.name = info.name
    this.posX = info.posX
    this.posY = info.posY
    this.scale = info.scale || 5
    this.layers = layers
    this.known = info.known
  }

  static async load(replay: Replay): Promise<MapView> {
    let info: MapInfo
    try {
      info = await mapInfo(replay.match.map)
    } catch {
      info = {
        name: replay.match.map, posX: 0, posY: 0, scale: 0, size: SIZE, known: false,
        levels: [{ name: 'default', altitudeMin: -1e6, altitudeMax: 1e6, image: '' }],
      }
    }
    const layers: Layer[] = await Promise.all(
      info.levels.map(async (level) => ({ level, image: await loadImage(level.image), generated: false })),
    )
    const view = new MapView(info, layers)
    if (!info.known) view.fitToPlayers(replay)
    view.bounds = view.walkedBounds(replay)
    for (const layer of view.layers) {
      if (!layer.image) {
        layer.image = view.floorPlan(replay, layer.level)
        layer.generated = true
      }
    }
    return view
  }

  get multiLevel(): boolean {
    return this.layers.length > 1
  }

  toRadar(x: number, y: number): [number, number] {
    return [(x - this.posX) / this.scale, (this.posY - y) / this.scale]
  }

  toWorld(px: number, py: number): [number, number] {
    return [px * this.scale + this.posX, this.posY - py * this.scale]
  }

  // units converts a distance in world units to radar pixels.
  units(d: number): number {
    return d / this.scale
  }

  levelOf(z: number): number {
    for (let i = this.layers.length - 1; i > 0; i--) {
      if (z < this.layers[i].level.altitudeMax) return i
    }
    return 0
  }

  private walkedBounds(r: Replay): [number, number, number, number] {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const F = r.frames
    for (let p = 0; p < r.players; p++) {
      for (let f = 0; f < F; f += 16) {
        const i = p * F + f
        if (!(r.pflags[i] & FLAG.alive)) continue
        const [x, y] = this.toRadar(r.px[i], r.py[i])
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (!isFinite(x0) || x1 - x0 < 50 || y1 - y0 < 50) return [0, 0, SIZE, SIZE]
    const pad = 40
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
  }

  // fitToPlayers is used for maps without overview data: centre the radar
  // on everywhere players went.
  private fitToPlayers(r: Replay) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const F = r.frames
    for (let p = 0; p < r.players; p++) {
      for (let f = 0; f < F; f += 8) {
        const i = p * F + f
        if (!(r.pflags[i] & FLAG.alive)) continue
        const x = r.px[i]
        const y = r.py[i]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (!isFinite(minX)) return
    const span = Math.max(maxX - minX, maxY - minY, 1000) * 1.15
    this.scale = span / SIZE
    this.posX = (minX + maxX) / 2 - span / 2
    this.posY = (minY + maxY) / 2 + span / 2
  }

  // floorPlan draws the parts of the map players stood on. It is a decent
  // stand in when the radar image is missing (offline, custom maps).
  private floorPlan(r: Replay, level: MapLevel): HTMLCanvasElement {
    const G = 256
    const cell = SIZE / G
    const grid = new Uint8Array(G * G)
    const F = r.frames
    for (let p = 0; p < r.players; p++) {
      for (let f = 0; f < F; f += 2) {
        const i = p * F + f
        if (!(r.pflags[i] & FLAG.alive)) continue
        const z = r.pz[i]
        if (z < level.altitudeMin || z >= level.altitudeMax) continue
        const [px, py] = this.toRadar(r.px[i], r.py[i])
        const gx = Math.floor(px / cell)
        const gy = Math.floor(py / cell)
        if (gx >= 0 && gy >= 0 && gx < G && gy < G) grid[gy * G + gx] = 1
      }
    }
    // Grow the walked cells a little so corridors get their real width.
    const grown = new Uint8Array(G * G)
    const R = 2
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        if (!grid[y * G + x]) continue
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < G && ny < G && dx * dx + dy * dy <= R * R + 1) grown[ny * G + nx] = 1
          }
        }
      }
    }
    const small = document.createElement('canvas')
    small.width = G
    small.height = G
    const sctx = small.getContext('2d')!
    const img = sctx.createImageData(G, G)
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const k = y * G + x
        if (!grown[k]) continue
        const edge =
          x === 0 || y === 0 || x === G - 1 || y === G - 1 ||
          !grown[k - 1] || !grown[k + 1] || !grown[k - G] || !grown[k + G]
        const o = k * 4
        if (edge) {
          img.data[o] = 120
          img.data[o + 1] = 138
          img.data[o + 2] = 160
          img.data[o + 3] = 255
        } else {
          img.data[o] = 44
          img.data[o + 1] = 53
          img.data[o + 2] = 66
          img.data[o + 3] = 255
        }
      }
    }
    sctx.putImageData(img, 0, 0)
    const out = document.createElement('canvas')
    out.width = SIZE
    out.height = SIZE
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(small, 0, 0, SIZE, SIZE)
    return out
  }
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
