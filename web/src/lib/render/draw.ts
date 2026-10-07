// Small canvas drawing helpers shared by the radar layers.

export const FONT = '"Barlow", sans-serif'
export const DISPLAY = '"Barlow Semi Condensed", sans-serif'

// Dark backing for text and badges on top of the map.
export const SHADE = 'rgba(11,13,17,0.86)'
// Thin dark edge around shapes so they read on light and dark floors.
export const EDGE = 'rgba(6,8,11,0.9)'

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2)
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = v
}

// mix blends two #rrggbb colours, t = 0 gives a.
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => {
    const x = (pa >> s) & 255
    const y = (pb >> s) & 255
    return Math.round(x + (y - x) * t)
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

// pill draws a dark rounded backing centred on x, y.
export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, border?: string) {
  ctx.fillStyle = SHADE
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 4)
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = border ?? 'rgba(255,255,255,0.07)'
  roundRect(ctx, x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1, 3.5)
  ctx.stroke()
}

// Cap heights per font size, so digits and capitals sit exactly in the
// middle of whatever they are drawn on.
const caps = new Map<string, number>()

export function capHeight(ctx: CanvasRenderingContext2D, sample = '0'): number {
  const key = `${ctx.font}|${sample}`
  let h = caps.get(key)
  if (h === undefined) {
    const m = ctx.measureText(sample)
    h = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent
    // Fonts still loading report odd metrics, do not keep those.
    if (document.fonts?.status === 'loaded') caps.set(key, h)
  }
  return h
}

// centreText draws text centred on x, y by its cap height.
export function centreText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sample = '0') {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, x, y + capHeight(ctx, sample) / 2)
}

// smokeSprite builds a soft, cloudy disc once so smokes look like smoke
// instead of flat circles. A soft dark edge keeps the cloud readable on
// light floors, so the sprite has room around the cloud for it.
export function smokeSprite(): HTMLCanvasElement {
  const S = 256
  const C = S / 2
  const cloud = document.createElement('canvas')
  cloud.width = S
  cloud.height = S
  const ctx = cloud.getContext('2d')!
  let seed = 11
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const puff = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(204,211,220,${a})`)
    g.addColorStop(0.6, `rgba(193,201,211,${a * 0.78})`)
    g.addColorStop(1, 'rgba(186,194,205,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  puff(C, C, 93, 0.96)
  for (let i = 0; i < 28; i++) {
    const ang = (i / 28) * Math.PI * 2 + rand() * 0.3
    const d = 60 + rand() * 22
    puff(C + Math.cos(ang) * d, C + Math.sin(ang) * d, 21 + rand() * 15, 0.5 + rand() * 0.35)
  }
  // Light from above gives it some volume.
  const shade = ctx.createLinearGradient(0, 30, 0, S - 30)
  shade.addColorStop(0, 'rgba(255,255,255,0.14)')
  shade.addColorStop(1, 'rgba(10,14,20,0.2)')
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, S, S)

  const out = document.createElement('canvas')
  out.width = S
  out.height = S
  const octx = out.getContext('2d')!
  octx.shadowColor = 'rgba(6,9,13,0.6)'
  octx.shadowBlur = 10
  octx.drawImage(cloud, 0, 0)
  return out
}

// flameSprite is a soft warm glow, drawn along the edge of a fire.
export function flameSprite(): HTMLCanvasElement {
  const S = 64
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,176,88,1)')
  g.addColorStop(0.45, 'rgba(255,128,56,0.55)')
  g.addColorStop(1, 'rgba(240,90,44,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return c
}
