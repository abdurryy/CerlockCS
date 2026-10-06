import { describe, expect, it } from 'vitest'
import { Camera } from './camera'

describe('Camera', () => {
  it('maps radar to screen and back', () => {
    const cam = new Camera()
    cam.resize(800, 600)
    cam.cx = 300
    cam.cy = 700
    cam.zoom = 2.5
    cam.rot = 0.7
    const [sx, sy] = cam.toScreen(420, 650)
    const [px, py] = cam.toRadar(sx, sy)
    expect(px).toBeCloseTo(420)
    expect(py).toBeCloseTo(650)
  })

  it('keeps the point under the cursor fixed when zooming', () => {
    const cam = new Camera()
    cam.resize(1000, 1000)
    const before = cam.toRadar(200, 300)
    cam.zoomAt(200, 300, 3)
    const after = cam.toRadar(200, 300)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
  })
})
