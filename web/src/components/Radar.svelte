<script lang="ts">
  import { onMount } from 'svelte'
  import { Renderer, type Hit } from '../lib/render/renderer'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v }: { v: Viewer } = $props()

  let wrap: HTMLDivElement
  let canvas: HTMLCanvasElement
  let renderer: Renderer | null = null
  let cursor = $state('grab')
  let tip = $state<{ x: number; y: number; title: string; detail: string } | null>(null)

  // Exposed so the toolbar can show the right floor on two level maps.
  export function level(): number {
    return renderer?.level ?? 0
  }

  export function resetCamera() {
    renderer?.home()
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

  function describe(h: Hit | null, x: number, y: number) {
    if (h?.kind !== 'blunder') {
      tip = null
      return
    }
    const b = v.replay.blunders[h.id]
    tip = b ? { x, y, title: b.title, detail: b.detail } : null
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
        tip = null
      }
      if (drag.moved) {
        renderer.cam.pan(dx, dy)
        drag.x = e.clientX
        drag.y = e.clientY
      }
      return
    }
    const [x, y] = pos(e)
    const h = renderer.hitTest(x, y)
    renderer.hover = h
    cursor = h ? 'pointer' : 'grab'
    describe(h, x, y)
  }

  function onUp(e: PointerEvent) {
    if (!renderer) return
    if (drag && !drag.moved) {
      const [x, y] = pos(e)
      const h = renderer.hitTest(x, y)
      if (h?.kind === 'player') v.setFollow(h.id)
      if (h?.kind === 'blunder') {
        v.openBlunder(h.id)
        v.tab = 'evidence'
      }
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
    renderer?.home()
  }

  $effect(() => {
    // Zoom in when a follow starts.
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
    onpointerleave={() => {
      if (renderer) renderer.hover = null
      tip = null
    }}
    onwheel={onWheel}
    ondblclick={onDouble}
  ></canvas>
  {#if tip}
    <div class="tip" style="left: {tip.x + 14}px; top: {tip.y - 10}px">
      <span class="label">Evidence</span>
      <strong>{tip.title}</strong>
      <p>{tip.detail}</p>
    </div>
  {/if}
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

  .tip {
    position: absolute;
    max-width: 260px;
    background: rgba(21, 23, 27, 0.97);
    border: 1px solid var(--rule-2);
    border-left: 2px solid var(--evidence);
    border-radius: 3px;
    padding: 8px 10px;
    pointer-events: none;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 4;
  }

  strong {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 14px;
  }

  p {
    margin: 0;
    color: var(--graphite);
    font-size: 12px;
  }
</style>
