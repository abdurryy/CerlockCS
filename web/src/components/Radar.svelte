<script lang="ts">
  import { onMount } from 'svelte'
  import { Renderer } from '../lib/render/renderer'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v }: { v: Viewer } = $props()

  let wrap: HTMLDivElement
  let canvas: HTMLCanvasElement
  let renderer: Renderer | null = null
  let cursor = $state('grab')

  // Exposed so the toolbar can show the right level on two floor maps.
  export function level(): number {
    return renderer?.level ?? 0
  }

  export function resetCamera() {
    renderer?.cam.reset()
  }

  onMount(() => {
    const r = new Renderer(canvas, v.replay, v.map)
    renderer = r
    const ro = new ResizeObserver(() => r.resize(wrap.clientWidth, wrap.clientHeight))
    ro.observe(wrap)
    r.resize(wrap.clientWidth, wrap.clientHeight)

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      v.advance(dt, now)
      r.draw(v.live, v.options(r.level), dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  let drag: { x: number; y: number; moved: boolean } | null = null

  function pos(e: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  }

  function onMove(e: PointerEvent) {
    if (!renderer) return
    if (drag) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && dx * dx + dy * dy > 16) {
        drag.moved = true
        // Panning by hand takes over from the follow camera.
        if (v.follow >= 0) v.follow = -1
        cursor = 'grabbing'
      }
      if (drag.moved) {
        renderer.cam.pan(dx, dy)
        drag.x = e.clientX
        drag.y = e.clientY
      }
      return
    }
    const [x, y] = pos(e)
    renderer.hover = renderer.hitTest(x, y)
    cursor = renderer.hover >= 0 ? 'pointer' : 'grab'
  }

  function onUp(e: PointerEvent) {
    if (!renderer) return
    if (drag && !drag.moved) {
      const [x, y] = pos(e)
      const p = renderer.hitTest(x, y)
      if (p >= 0) v.setFollow(p)
    }
    drag = null
    cursor = 'grab'
  }

  function onWheel(e: WheelEvent) {
    if (!renderer) return
    e.preventDefault()
    const [x, y] = pos(e)
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))
    if (v.follow >= 0) {
      // Keep the followed player centred while zooming.
      renderer.cam.zoom = Math.min(12, Math.max(0.5, renderer.cam.zoom * factor))
    } else {
      renderer.cam.zoomAt(x, y, factor)
    }
  }

  function onDouble() {
    v.follow = -1
    renderer?.cam.reset()
  }

  $effect(() => {
    // Zoom in when a follow starts, out when it ends.
    const following = v.follow >= 0
    if (!renderer) return
    if (following && renderer.cam.zoom < 1.8) renderer.cam.zoom = 2.4
  })
</script>

<div class="radar" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    style="cursor: {cursor}"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointerleave={() => renderer && (renderer.hover = -1)}
    onwheel={onWheel}
    ondblclick={onDouble}
  ></canvas>
</div>

<style>
  .radar {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    touch-action: none;
  }
</style>
