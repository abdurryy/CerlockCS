import { mapInfo } from './api'
import { makePlate } from './render/plate'
import { FLAG, type Replay } from './replay'
import type { MapInfo, MapLevel } from './types'

export { PLATE_PAD } from './render/plate'

const SIZE = 1024

export interface Layer {
  level: MapLevel
  // The radar image, or a floor plan drawn from where players walked when
  // no image is available.
  image: CanvasImageSource | null
  generated: boolean
  // plate is the image graded and lifted with a shadow, PLATE_PAD pixels
  // bigger on every side.
  plate: HTMLCanvasElement | null
  // outline is the edge of the playable area in radar pixels.
  outline: Path2D | null
}

// Callout is a map area name placed where players stood while in it.
export interface Callout {
  name: string
  x: number
  y: number
  level: number
  weight: number
}

export interface Site {
  name: string
  x: number
  y: number
  level: number
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
  callouts: Callout[] = []
  sites: Site[] = []

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
      info.levels.map(async (level) => ({ level, image: await loadImage(level.image), generated: false, plate: null, outline: null })),
    )
    const view = new MapView(info, layers)
    if (!info.known) view.fitToPlayers(replay)
    view.bounds = view.walkedBounds(replay)
    for (const layer of view.layers) {
      if (!layer.image) {
        layer.image = view.floorPlan(replay, layer.level)
        layer.generated = true
      }
      const plate = makePlate(layer.image)
      layer.plate = plate.canvas
      layer.outline = plate.outline
    }
    view.findCallouts(replay)
    view.findSites(replay)
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

  // findCallouts places every area name at the middle of where players
  // stood while the game said they were there.
  private findCallouts(r: Replay) {
    if (!r.pplace.length) return
    const F = r.frames
    const acc = new Map<string, { x: number; y: number; n: number }>()
    for (let p = 0; p < r.players; p++) {
      for (let f = 0; f < F; f += 6) {
        const i = p * F + f
        const place = r.pplace[i]
        if (!place || !(r.pflags[i] & FLAG.alive)) continue
        const level = this.levelOf(r.pz[i])
        const key = `${place}|${level}`
        const a = acc.get(key) ?? { x: 0, y: 0, n: 0 }
        a.x += r.px[i]
        a.y += r.py[i]
        a.n++
        acc.set(key, a)
      }
    }
    const out: Callout[] = []
    for (const [key, a] of acc) {
      if (a.n < 12) continue
      const [place, level] = key.split('|').map(Number)
      const name = r.placeName(place)
      if (!name || /spawn/i.test(name)) continue
      const [x, y] = this.toRadar(a.x / a.n, a.y / a.n)
      out.push({ name, x, y, level, weight: a.n })
    }
    // Busy areas first so they win when labels overlap.
    this.callouts = out.sort((a, b) => b.weight - a.weight)
  }

  // findSites marks bombsites where the bomb was actually planted, or where
  // the game says the site is when nobody planted there.
  private findSites(r: Replay) {
    const acc = new Map<string, { x: number; y: number; level: number; n: number }>()
    for (const b of r.match.bombEvents ?? []) {
      if (b.kind !== 'planted' || !b.site) continue
      const [x, y] = this.toRadar(b.pos[0], b.pos[1])
      const a = acc.get(b.site) ?? { x: 0, y: 0, level: this.levelOf(b.pos[2]), n: 0 }
      a.x += x
      a.y += y
      a.n++
      acc.set(b.site, a)
    }
    for (const c of this.callouts) {
      const m = /^Bombsite ([AB])$/.exec(c.name)
      if (m && !acc.has(m[1])) acc.set(m[1], { x: c.x, y: c.y, level: c.level, n: 1 })
    }
    this.sites = [...acc].map(([name, a]) => ({ name, x: a.x / a.n, y: a.y / a.n, level: a.level }))
    this.callouts = this.callouts.filter((c) => !/^Bombsite [AB]$/.test(c.name))
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

  // floorPlan draws the parts of the map players stood on, lighter where
  // they stood higher. It is a decent stand in when the radar image is
  // missing (offline, custom maps).
  private floorPlan(r: Replay, level: MapLevel): HTMLCanvasElement {
    const G = 256
    const cell = SIZE / G
    const zsum = new Float32Array(G * G)
    const count = new Uint32Array(G * G)
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
        if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue
        zsum[gy * G + gx] += z
        count[gy * G + gx]++
      }
    }
    // Grow the walked cells a little so corridors get their real width,
    // taking the height of the cells they grew from.
    const gz = new Float32Array(G * G)
    const gn = new Uint32Array(G * G)
    const R = 2
    let zmin = Infinity
    let zmax = -Infinity
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const k = y * G + x
        if (!count[k]) continue
        const z = zsum[k] / count[k]
        zmin = Math.min(zmin, z)
        zmax = Math.max(zmax, z)
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= G || ny >= G || dx * dx + dy * dy > R * R + 1) continue
            gz[ny * G + nx] += z
            gn[ny * G + nx]++
          }
        }
      }
    }
    const span = Math.max(1, zmax - zmin)
    const small = document.createElement('canvas')
    small.width = G
    small.height = G
    const sctx = small.getContext('2d')!
    const img = sctx.createImageData(G, G)
    for (let k = 0; k < G * G; k++) {
      if (!gn[k]) continue
      const v = 70 + 130 * ((gz[k] / gn[k] - zmin) / span)
      img.data[k * 4] = v
      img.data[k * 4 + 1] = v
      img.data[k * 4 + 2] = v
      img.data[k * 4 + 3] = 255
    }
    sctx.putImageData(img, 0, 0)
    const out = document.createElement('canvas')
    out.width = SIZE
    out.height = SIZE
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    // Soften the cell steps so the traced outline comes out smooth.
    ctx.filter = 'blur(3px)'
    ctx.drawImage(small, 0, 0, SIZE, SIZE)
    ctx.filter = 'none'
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
