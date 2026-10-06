// Game icons (weapons, utility, killfeed). The server downloads and caches
// them (internal/icons), this module knows which ones exist and how wide
// they are, and draws tinted copies for the canvas.

import { EQ } from './weapons'

class IconSet {
  // Width to height ratio per icon name, for example "weapon/ak47": 2.77.
  aspects = $state<Record<string, number>>({})
  loaded = $state(false)
  private loading: Promise<void> | null = null

  load(): Promise<void> {
    this.loading ??= fetch('/api/icons')
      .then((r) => (r.ok ? r.json() : { icons: {} }))
      .then((body: { icons: Record<string, number> | null }) => {
        this.aspects = body.icons ?? {}
      })
      .catch(() => {})
      .finally(() => {
        this.loaded = true
      })
    return this.loading
  }

  has(name: string | null | undefined): name is string {
    return !!name && name in this.aspects
  }

  aspect(name: string): number {
    return this.aspects[name] ?? 1
  }
}

export const icons = new IconSet()

export function iconUrl(name: string): string {
  return `/api/icons/${name}.svg`
}

// Icons that have their own colours and must not be tinted.
export const COLORED = new Set(['kill/ct', 'kill/t'])

const WEAPON: Record<number, string> = {
  1: 'hkp2000', 2: 'glock', 3: 'p250', 4: 'deagle', 5: 'fiveseven', 6: 'elite', 7: 'tec9', 8: 'cz75a', 9: 'usp_silencer', 10: 'revolver',
  101: 'mp7', 102: 'mp9', 103: 'bizon', 104: 'mac10', 105: 'ump45', 106: 'p90', 107: 'mp5sd',
  201: 'sawedoff', 202: 'nova', 203: 'mag7', 204: 'xm1014', 205: 'm249', 206: 'negev',
  301: 'galilar', 302: 'famas', 303: 'ak47', 304: 'm4a1', 305: 'm4a1_silencer', 306: 'ssg08', 307: 'sg556', 308: 'aug', 309: 'awp', 310: 'scar20', 311: 'g3sg1',
  401: 'taser', 402: 'kevlar', 403: 'helmet', 404: 'c4', 405: 'knife', 406: 'defuser',
  501: 'decoy', 502: 'molotov', 503: 'incgrenade', 504: 'flashbang', 505: 'smokegrenade', 506: 'hegrenade',
}

// weaponIcon returns the icon name for an equipment id, or null when there
// is none (for example "world" kills). T side knives use the T knife.
export function weaponIcon(id: number, side?: number): string | null {
  if (id === EQ.knife && side === 2) return 'weapon/knife_t'
  if (id === EQ.world) return 'kill/world'
  const n = WEAPON[id]
  return n ? `weapon/${n}` : null
}

// Canvas drawing. SVGs are fetched once, given an explicit size so every
// browser can rasterise them, and tinted per colour and size on demand.

const images = new Map<string, HTMLImageElement | null>()
const bitmaps = new Map<string, HTMLCanvasElement>()
const waiting = new Set<() => void>()

// onIconLoad registers a callback for when a canvas icon finishes loading,
// so a paused radar can redraw. Returns a function that removes it.
export function onIconLoad(cb: () => void): () => void {
  waiting.add(cb)
  return () => waiting.delete(cb)
}

function image(name: string): HTMLImageElement | null {
  if (images.has(name)) return images.get(name)!
  images.set(name, null)
  fetch(iconUrl(name))
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
    .then((svg) => {
      const a = icons.aspect(name)
      // Give the root element a real size, Firefox will not draw an SVG
      // that only has a viewBox.
      const sized = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
        const clean = attrs.replace(/\s(width|height)\s*=\s*"[^"]*"/g, '')
        return `<svg${clean} width="${Math.round(64 * a)}" height="64">`
      })
      const img = new Image()
      img.onload = () => {
        images.set(name, img)
        for (const cb of waiting) cb()
      }
      img.src = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
    })
    .catch(() => {})
  return null
}

// iconBitmap returns a tinted icon `height` CSS pixels tall, or null while
// it is still loading or when the icon does not exist. Pass color null to
// keep the icon's own colours.
export function iconBitmap(name: string | null, color: string | null, height: number): HTMLCanvasElement | null {
  if (!icons.has(name)) return null
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1)
  const key = `${name}|${color}|${height}|${dpr}`
  const hit = bitmaps.get(key)
  if (hit) return hit
  const img = image(name)
  if (!img) return null
  const h = Math.max(1, Math.round(height * dpr))
  const w = Math.max(1, Math.round(height * icons.aspect(name) * dpr))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  if (color) {
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
  }
  bitmaps.set(key, c)
  return c
}

// drawIcon draws an icon centred on x, y. Returns the drawn width in CSS
// pixels, 0 if nothing was drawn.
export function drawIcon(ctx: CanvasRenderingContext2D, name: string | null, x: number, y: number, height: number, color: string | null): number {
  const b = iconBitmap(name, color, height)
  if (!b) return 0
  const w = (b.width / b.height) * height
  ctx.drawImage(b, x - w / 2, y - height / 2, w, height)
  return w
}
