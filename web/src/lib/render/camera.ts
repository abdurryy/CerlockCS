const RADAR = 1024

// Camera maps radar pixels to screen pixels. cx/cy is the radar point in the
// middle of the screen, rot rotates the map around it.
export class Camera {
  cx = RADAR / 2
  cy = RADAR / 2
  zoom = 1
  rot = 0
  w = 1
  h = 1

  resize(w: number, h: number) {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
  }

  // scale is screen pixels per radar pixel.
  get scale(): number {
    return (Math.min(this.w, this.h) / RADAR) * this.zoom
  }

  toScreen(px: number, py: number): [number, number] {
    const s = this.scale
    const dx = (px - this.cx) * s
    const dy = (py - this.cy) * s
    const c = Math.cos(this.rot)
    const n = Math.sin(this.rot)
    return [this.w / 2 + dx * c - dy * n, this.h / 2 + dx * n + dy * c]
  }

  toRadar(sx: number, sy: number): [number, number] {
    const s = this.scale
    const dx = sx - this.w / 2
    const dy = sy - this.h / 2
    const c = Math.cos(-this.rot)
    const n = Math.sin(-this.rot)
    return [this.cx + (dx * c - dy * n) / s, this.cy + (dx * n + dy * c) / s]
  }

  apply(ctx: CanvasRenderingContext2D, dpr: number) {
    const s = this.scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(this.w / 2, this.h / 2)
    ctx.rotate(this.rot)
    ctx.scale(s, s)
    ctx.translate(-this.cx, -this.cy)
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [bx, by] = this.toRadar(sx, sy)
    this.zoom = Math.min(12, Math.max(0.5, this.zoom * factor))
    const [ax, ay] = this.toRadar(sx, sy)
    this.cx += bx - ax
    this.cy += by - ay
  }

  pan(dx: number, dy: number) {
    const s = this.scale
    const c = Math.cos(-this.rot)
    const n = Math.sin(-this.rot)
    this.cx -= (dx * c - dy * n) / s
    this.cy -= (dx * n + dy * c) / s
  }

  // follow eases the camera toward a point, dt in seconds.
  follow(px: number, py: number, dt: number) {
    const k = 1 - Math.exp(-dt * 9)
    this.cx += (px - this.cx) * k
    this.cy += (py - this.cy) * k
  }

  easeRotation(target: number, dt: number) {
    let d = target - this.rot
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    this.rot += d * (1 - Math.exp(-dt * 6))
  }
}
