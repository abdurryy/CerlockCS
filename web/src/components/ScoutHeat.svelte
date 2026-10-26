<script module lang="ts">
  import { BG, TEXT } from '../lib/colors'
  import { DISPLAY, circle } from '../lib/render/draw'
  import { PLATE_PAD, makePlate } from '../lib/render/plate'
  import type { HeatGrid } from '../lib/scout/types'

  const RADAR = 1024
  // A second floor gets a switch when it has this share of the heat.
  const FLOOR_SHARE = 0.12
  const SIGMA = 2.4
  // Height over width of the preview, at least this.
  const MIN_ASPECT = 0.62

  // The app's heat colours, faint violet to pale pink (render/heatmap.ts).
  const RAMP: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [92, 74, 196, 0.14],
    [128, 84, 212, 0.3],
    [170, 94, 216, 0.46],
    [210, 108, 204, 0.6],
    [236, 144, 206, 0.72],
    [246, 186, 224, 0.82],
  ]

  type Box = [number, number, number, number]

  interface Floor {
    plate: HTMLCanvasElement
    outline: Path2D
    box: Box
  }

  // Plates are graded once per radar image and shared by every preview.
  const floors = new Map<string, Promise<Floor | null>>()
  const ready = new Map<string, Floor | null>()
  const heats = new WeakMap<Float32Array, HTMLCanvasElement | null>()

  function canvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }

  function floorFor(url: string): Promise<Floor | null> {
    let p = floors.get(url)
    if (!p) {
      p = new Promise<HTMLImageElement | null>((done) => {
        const img = new Image()
        img.onload = () => done(img)
        img.onerror = () => done(null)
        img.src = url
      }).then((img) => {
        if (!img) return null
        const plate = makePlate(img)
        return { plate: plate.canvas, outline: plate.outline, box: solidBox(img) }
      }).then((f) => {
        ready.set(url, f)
        return f
      })
      floors.set(url, p)
    }
    return p
  }

  // solidBox is the playable part of the radar, read from a small copy.
  function solidBox(img: CanvasImageSource): Box {
    const n = 256
    const ctx = canvas(n, n).getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    let x0 = n
    let y0 = n
    let x1 = -1
    let y1 = -1
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        if (d[(y * n + x) * 4 + 3] < 128) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    const k = RADAR / n
    return x1 < x0 ? [0, 0, RADAR, RADAR] : [x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k]
  }

  // heatBox is where the heat is, for maps without a radar image.
  function heatBox(g: HeatGrid): Box | null {
    const n = g.size
    let x0 = n
    let y0 = n
    let x1 = -1
    let y1 = -1
    for (const l of g.levels) {
      for (let i = 0; i < l.length; i++) {
        if (!l[i]) continue
        const x = i % n
        const y = (i / n) | 0
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    const k = RADAR / n
    return x1 < x0 ? null : [x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k]
  }

  function ramp(v: number): [number, number, number, number] {
    const x = Math.min(0.9999, Math.max(0, v)) * (RAMP.length - 1)
    const i = Math.floor(x)
    const t = x - i
    const a = RAMP[i]
    const b = RAMP[i + 1]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
  }

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

  // heatOf colours one floor of a grid, scaled to a high percentile so one
  // crowded spot does not wash out the rest.
  function heatOf(grid: Float32Array, n: number): HTMLCanvasElement | null {
    const hit = heats.get(grid)
    if (hit !== undefined) return hit
    const v = blur(grid, n, SIGMA)
    let used = 0
    for (let i = 0; i < v.length; i++) if (v[i] > 1e-6) used++
    let out: HTMLCanvasElement | null = null
    if (used) {
      const vals = new Float32Array(used)
      let k = 0
      for (let i = 0; i < v.length; i++) if (v[i] > 1e-6) vals[k++] = v[i]
      vals.sort()
      const max = vals[Math.min(used - 1, Math.floor(used * 0.985))]
      out = canvas(n, n)
      const ctx = out.getContext('2d')!
      const img = ctx.createImageData(n, n)
      for (let i = 0; i < v.length; i++) {
        if (v[i] <= 1e-6) continue
        const [r, g, b, a] = ramp(Math.sqrt(Math.min(1, v[i] / max)))
        const o = i * 4
        img.data[o] = r
        img.data[o + 1] = g
        img.data[o + 2] = b
        img.data[o + 3] = Math.min(0.94, a * 1.4) * 255
      }
      ctx.putImageData(img, 0, 0)
    }
    heats.set(grid, out)
    return out
  }

  export interface HeatSite {
    name: string
    x: number
    y: number
    level: number
  }
</script>

<script lang="ts">
  import { drawIcon, onIconLoad } from '../lib/icons.svelte'
  import type { MapInfo } from '../lib/types'

  // A small radar with heat on it, for previews. Maps with two floors get
  // a switch when both have a fair share of the heat.
  let {
    info,
    grid,
    sites = [],
    size = 200,
    label = '',
  }: { info: MapInfo; grid: HeatGrid; sites?: HeatSite[]; size?: number; label?: string } = $props()

  let el: HTMLCanvasElement | undefined = $state()
  let version = $state(0)
  let picked = $state(-1)
  let iconTick = $state(0)

  const totals = $derived(
    grid.levels.map((l) => {
      let s = 0
      for (let i = 0; i < l.length; i++) s += l[i]
      return s
    }),
  )
  const total = $derived(totals.reduce((a, b) => a + b, 0))
  const order = $derived(totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b))
  // Floors worth a switch, busiest first.
  const shown = $derived(info.levels.length > 1 ? order.filter((l, i) => i === 0 || (total > 0 && totals[l] >= total * FLOOR_SHARE)) : [0])
  const level = $derived(picked >= 0 && shown.includes(picked) ? picked : (shown[0] ?? 0))
  const empty = $derived(total <= 0)

  function floorName(l: number): string {
    const n = info.levels[l]?.name ?? ''
    return !n || n === 'default' ? 'Upper' : n.charAt(0).toUpperCase() + n.slice(1)
  }

  // Plates already made for another preview are there right away.
  const loaded = $derived.by(() => {
    void version
    return info.levels.map((l) => (l.image ? (ready.get(l.image) ?? null) : null))
  })
  const waiting = $derived.by(() => {
    void version
    return info.levels.some((l) => l.image && !ready.has(l.image))
  })

  $effect(() => {
    let live = true
    for (const l of info.levels) {
      if (l.image && !ready.has(l.image)) {
        floorFor(l.image).then(() => {
          if (live) version++
        })
      }
    }
    return () => {
      live = false
    }
  })

  $effect(() => onIconLoad(() => iconTick++))

  // The frame is the same for every floor, so switching does not jump.
  const box = $derived.by((): Box => {
    if (waiting) return [0, 0, RADAR, RADAR]
    let b: Box | null = null
    for (const f of loaded) {
      if (!f) continue
      b = b ? [Math.min(b[0], f.box[0]), Math.min(b[1], f.box[1]), Math.max(b[2], f.box[2]), Math.max(b[3], f.box[3])] : [...f.box]
    }
    b ??= heatBox(grid) ?? [0, 0, RADAR, RADAR]
    const pad = 14
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]
  })

  // Wide maps get a lower preview instead of empty space above and below.
  const height = $derived(Math.round(size * Math.min(1, Math.max(MIN_ASPECT, (box[3] - box[1]) / (box[2] - box[0])))))

  $effect(() => {
    void iconTick
    const c = el
    if (!c) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const W = Math.round(size * dpr)
    const H = Math.round(height * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    const [x0, y0, x1, y1] = box
    const k = Math.min(W / (x1 - x0), H / (y1 - y0))
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k
    const oy = (H - (y1 - y0) * k) / 2 - y0 * k
    const floor = loaded[level] ?? null
    ctx.save()
    ctx.setTransform(k, 0, 0, k, ox, oy)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (floor) {
      ctx.drawImage(floor.plate, -PLATE_PAD, -PLATE_PAD)
      ctx.strokeStyle = 'rgba(196,210,228,0.5)'
      ctx.lineWidth = dpr / k
      ctx.stroke(floor.outline)
    }
    const heat = grid.levels[level] ? heatOf(grid.levels[level], grid.size) : null
    if (heat) {
      if (floor) {
        ctx.save()
        ctx.clip(floor.outline, 'evenodd')
        ctx.drawImage(heat, 0, 0, RADAR, RADAR)
        ctx.restore()
      } else {
        ctx.drawImage(heat, 0, 0, RADAR, RADAR)
      }
    }
    ctx.restore()
    const R = 7.5 * dpr
    for (const s of sites) {
      if (s.level !== level) continue
      const x = ox + s.x * k
      const y = oy + s.y * k
      ctx.fillStyle = 'rgba(11,13,17,0.9)'
      circle(ctx, x, y, R)
      ctx.fill()
      if (!drawIcon(ctx, `hud/bombsite-${s.name.toLowerCase()}`, x, y, R * 1.7, TEXT)) {
        ctx.fillStyle = TEXT
        ctx.font = `700 ${Math.round(10 * dpr)}px ${DISPLAY}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(s.name, x, y + 0.5 * dpr)
      }
    }
  })
</script>

<div class="heat" style:width="{size}px" style:height="{height}px">
  <canvas bind:this={el} style:width="{size}px" style:height="{height}px" title={label || undefined} aria-hidden="true"></canvas>
  {#if empty}
    <span class="none">No positions</span>
  {/if}
  {#if shown.length > 1}
    <div class="floors" role="group" aria-label="Floor">
      {#each shown as l (l)}
        <button
          class="fl"
          class:on={l === level}
          aria-pressed={l === level}
          title="{floorName(l)} floor, {Math.round((totals[l] / total) * 100)}% of the time"
          onclick={(e) => {
            e.stopPropagation()
            picked = l
          }}>{floorName(l)} <span class="num">{Math.round((totals[l] / total) * 100)}%</span></button
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .heat {
    position: relative;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  canvas {
    display: block;
  }

  .none {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    font-size: 12px;
  }

  .floors {
    position: absolute;
    left: 5px;
    bottom: 5px;
    display: flex;
    gap: 3px;
  }

  .fl {
    height: 19px;
    padding: 0 6px;
    border-color: transparent;
    border-radius: 3px;
    background: rgba(11, 13, 17, 0.82);
    color: var(--text-3);
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    line-height: 17px;
  }

  .fl span {
    color: var(--text-3);
    font-weight: 500;
  }

  .fl:hover {
    color: var(--text);
    background: rgba(32, 37, 44, 0.92);
  }

  .fl.on {
    color: var(--text);
    border-color: var(--line-2);
    background: rgba(24, 28, 34, 0.94);
  }
</style>
