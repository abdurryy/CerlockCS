// The map plate: the radar image graded to a cool slate that keeps heights
// readable, lifted off the background with a soft shadow, plus the outline
// of the playable area as a path so it stays sharp at any zoom. All of it
// is built once per floor.

const SIZE = 1024

// PLATE_PAD is the extra room around the radar for the shadow.
export const PLATE_PAD = 64

// Pixels at least this opaque are part of the playable area. Some radars
// draw the other floor faintly below it, that stays out of the outline.
const SOLID = 128

// Height ramp, low ground to high ground.
const RAMP: [number, number, number][] = [
  [20, 24, 30],
  [39, 46, 55],
  [65, 74, 87],
  [103, 114, 128],
  [146, 156, 170],
]

// How much of the original colour to keep, after the map's overall tint
// is taken out.
const HUE = 0.32

export interface Plate {
  canvas: HTMLCanvasElement
  outline: Path2D
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ramp(t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.floor(x)
  const k = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

export function makePlate(image: CanvasImageSource): Plate {
  const src = canvas(SIZE, SIZE)
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(image, 0, 0, SIZE, SIZE)
  const img = sctx.getImageData(0, 0, SIZE, SIZE)
  const d = img.data
  const N = SIZE * SIZE

  // Some radars have a frame line along the image border.
  for (let i = 0; i < SIZE; i++) {
    for (const k of [0, 1, SIZE - 2, SIZE - 1]) {
      d[(k * SIZE + i) * 4 + 3] = 0
      d[(i * SIZE + k) * 4 + 3] = 0
    }
  }

  // Luma range and average tint of the playable area.
  const hist = new Uint32Array(256)
  const luma = new Float32Array(N)
  let cr = 0
  let cg = 0
  let cb = 0
  let n = 0
  for (let p = 0; p < N; p++) {
    const o = p * 4
    const l = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]
    luma[p] = l
    if (d[o + 3] < SOLID) continue
    hist[Math.min(255, Math.round(l))]++
    cr += d[o] - l
    cg += d[o + 1] - l
    cb += d[o + 2] - l
    n++
  }
  const pct = (q: number) => {
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]
      if (acc >= n * q) return i
    }
    return 255
  }
  const lo = n ? pct(0.02) : 0
  const hi = n ? Math.max(lo + 24, pct(0.985)) : 255
  if (n) {
    cr /= n
    cg /= n
    cb /= n
  }

  // Distance to the nearest wall, for a little shading along the walls.
  const solid = new Uint8Array(N)
  for (let p = 0; p < N; p++) solid[p] = d[p * 4 + 3] >= SOLID ? 1 : 0
  const dist = distance(solid)

  for (let p = 0; p < N; p++) {
    const o = p * 4
    const a = d[o + 3]
    if (a === 0) continue
    const l = luma[p]
    if (!solid[p]) {
      // The other floor or soft edges: flat and faint.
      const [r, g, b] = ramp(0.5)
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
      d[o + 3] = a * 0.8
      continue
    }
    const t = Math.pow(Math.min(1, Math.max(0, (l - lo) / (hi - lo))), 0.9)
    let [r, g, b] = ramp(t)
    r += (d[o] - l - cr) * HUE
    g += (d[o + 1] - l - cg) * HUE
    b += (d[o + 2] - l - cb) * HUE
    const shade = 1 - 0.3 * Math.exp(-(dist[p] - 1) / 2.2)
    d[o] = r * shade
    d[o + 1] = g * shade
    d[o + 2] = b * shade
  }
  sctx.putImageData(img, 0, 0)

  const out = canvas(SIZE + PLATE_PAD * 2, SIZE + PLATE_PAD * 2)
  const ctx = out.getContext('2d')!
  // Shadow of the playable area only. The shape itself is drawn far off
  // the canvas so just its shadow lands.
  const mask = canvas(SIZE, SIZE)
  const mctx = mask.getContext('2d')!
  const mimg = mctx.createImageData(SIZE, SIZE)
  for (let p = 0; p < N; p++) {
    if (!solid[p]) continue
    mimg.data[p * 4 + 3] = 255
  }
  mctx.putImageData(mimg, 0, 0)
  const away = SIZE * 3
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetX = away
  ctx.shadowOffsetY = 10
  ctx.drawImage(mask, PLATE_PAD - away, PLATE_PAD)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2
  ctx.drawImage(mask, PLATE_PAD - away, PLATE_PAD)
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(src, PLATE_PAD, PLATE_PAD)

  const alpha = new Uint8Array(N)
  for (let p = 0; p < N; p++) alpha[p] = d[p * 4 + 3]
  return { canvas: out, outline: trace(alpha, SIZE, SOLID) }
}

// distance gives every pixel its distance in pixels to the nearest empty
// one, with a two pass chamfer.
function distance(solid: Uint8Array): Float32Array {
  const W = SIZE
  const dist = new Float32Array(solid.length)
  const D = 1
  const E = Math.SQRT2
  const BIG = 1e6
  for (let p = 0; p < dist.length; p++) dist[p] = solid[p] ? BIG : 0
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!dist[p]) continue
      let v = dist[p]
      if (x > 0) v = Math.min(v, dist[p - 1] + D)
      if (y > 0) {
        v = Math.min(v, dist[p - W] + D)
        if (x > 0) v = Math.min(v, dist[p - W - 1] + E)
        if (x < W - 1) v = Math.min(v, dist[p - W + 1] + E)
      }
      dist[p] = v
    }
  }
  for (let y = W - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x
      if (!dist[p]) continue
      let v = dist[p]
      if (x < W - 1) v = Math.min(v, dist[p + 1] + D)
      if (y < W - 1) {
        v = Math.min(v, dist[p + W] + D)
        if (x < W - 1) v = Math.min(v, dist[p + W + 1] + E)
        if (x > 0) v = Math.min(v, dist[p + W - 1] + E)
      }
      dist[p] = v
    }
  }
  return dist
}

// Marching squares cases: pairs of cell edges (0 top, 1 right, 2 bottom,
// 3 left) to join. Corners are tl 8, tr 4, br 2, bl 1. The two saddles
// (5 and 10) are decided by the cell centre.
const CASES: number[][] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], [], [0, 2], [0, 3],
  [0, 3], [0, 2], [], [0, 1], [3, 1], [2, 1], [3, 2], [],
]

// trace follows the edge of the area where alpha >= level and returns it
// as a path in radar pixels. Loops are joined and simplified so the path
// stays cheap to stroke every frame.
export function trace(alpha: Uint8Array, W: number, level: number): Path2D {
  const S = W + 2
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= W ? 0 : alpha[y * W + x])
  // Edge points keyed by the cell edge they sit on.
  const px = new Map<number, number>()
  const py = new Map<number, number>()
  const links = new Map<number, number[]>()
  const hId = (x: number, y: number) => ((y + 1) * S + (x + 1)) * 2
  const vId = (x: number, y: number) => ((y + 1) * S + (x + 1)) * 2 + 1
  const point = (id: number, x0: number, y0: number, a0: number, x1: number, y1: number, a1: number) => {
    if (px.has(id)) return
    const t = a1 === a0 ? 0.5 : Math.min(1, Math.max(0, (level - a0) / (a1 - a0)))
    px.set(id, x0 + (x1 - x0) * t + 0.5)
    py.set(id, y0 + (y1 - y0) * t + 0.5)
  }
  const link = (a: number, b: number) => {
    const la = links.get(a)
    if (la) la.push(b)
    else links.set(a, [b])
    const lb = links.get(b)
    if (lb) lb.push(a)
    else links.set(b, [a])
  }
  for (let y = -1; y < W; y++) {
    for (let x = -1; x < W; x++) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0)
      if (c === 0 || c === 15) continue
      const edge = (e: number): number => {
        switch (e) {
          case 0: {
            const id = hId(x, y)
            point(id, x, y, tl, x + 1, y, tr)
            return id
          }
          case 1: {
            const id = vId(x + 1, y)
            point(id, x + 1, y, tr, x + 1, y + 1, br)
            return id
          }
          case 2: {
            const id = hId(x, y + 1)
            point(id, x, y + 1, bl, x + 1, y + 1, br)
            return id
          }
          default: {
            const id = vId(x, y)
            point(id, x, y, tl, x, y + 1, bl)
            return id
          }
        }
      }
      if (c === 5 || c === 10) {
        const joined = (tl + tr + br + bl) / 4 >= level
        const pairs = (c === 5) === joined ? [[0, 3], [2, 1]] : [[3, 2], [0, 1]]
        for (const [a, b] of pairs) link(edge(a), edge(b))
        continue
      }
      const [a, b] = CASES[c]
      link(edge(a), edge(b))
    }
  }

  const path = new Path2D()
  const seen = new Set<number>()
  for (const start of links.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let prev = -1
    let cur = start
    while (!seen.has(cur)) {
      seen.add(cur)
      loop.push(cur)
      const next = links.get(cur)!.find((k) => k !== prev && !seen.has(k))
      if (next === undefined) break
      prev = cur
      cur = next
    }
    if (loop.length < 8) continue
    const xs = loop.map((k) => px.get(k)!)
    const ys = loop.map((k) => py.get(k)!)
    const keep = simplify(xs, ys, 0.35)
    if (keep.length < 3) continue
    path.moveTo(xs[keep[0]], ys[keep[0]])
    for (let i = 1; i < keep.length; i++) path.lineTo(xs[keep[i]], ys[keep[i]])
    path.closePath()
  }
  return path
}

// simplify drops points that sit within eps of the line through their
// neighbours (Douglas Peucker), returning the indices to keep.
function simplify(xs: number[], ys: number[], eps: number): number[] {
  const n = xs.length
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  // Split the loop at the point furthest from the start so both halves
  // are open lines.
  let far = 0
  let best = -1
  for (let i = 1; i < n; i++) {
    const dd = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2
    if (dd > best) {
      best = dd
      far = i
    }
  }
  keep[far] = 1
  const stack: [number, number][] = [[0, far], [far, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const dx = xs[b] - xs[a]
    const dy = ys[b] - ys[a]
    const len = Math.hypot(dx, dy) || 1
    let idx = -1
    let max = eps
    for (let i = a + 1; i < b; i++) {
      const dev = Math.abs((xs[i] - xs[a]) * dy - (ys[i] - ys[a]) * dx) / len
      if (dev > max) {
        max = dev
        idx = i
      }
    }
    if (idx >= 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}
