<script lang="ts">
  import { onMount } from 'svelte'
  import { teamColor } from '../lib/colors'
  import { weaponIcon } from '../lib/icons.svelte'
  import { roundClock } from '../lib/live'
  import { Renderer, type Hit } from '../lib/render/renderer'
  import { FLAG, UTIL } from '../lib/replay'
  import type { Viewer } from '../lib/viewer.svelte'
  import { EQ, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'

  let { v }: { v: Viewer } = $props()

  let wrap: HTMLDivElement
  let canvas: HTMLCanvasElement
  let renderer: Renderer | null = null
  let cursor = $state('grab')
  let hover = $state<{ kind: Hit['kind']; id: number; x: number; y: number } | null>(null)
  let size = $state({ w: 0, h: 0 })

  // Exposed so the toolbar can show the right floor on two level maps.
  export function level(): number {
    return renderer?.level ?? 0
  }

  export function resetCamera() {
    if (!renderer) return
    renderer.insets = insets()
    renderer.home()
  }

  // insets measures the bars that float over the top and bottom of the
  // stage (score bar, toolbar), so the map is framed between them.
  function insets(): { top: number; bottom: number } {
    const box = wrap.getBoundingClientRect()
    let top = 0
    let bottom = 0
    for (const el of wrap.parentElement?.children ?? []) {
      if (el === wrap) continue
      const r = el.getBoundingClientRect()
      if (!r.height || r.width < box.width * 0.5 || r.height > box.height * 0.3) continue
      if (r.top - box.top < 24) top = Math.max(top, r.bottom - box.top)
      else if (box.bottom - r.bottom < 24) bottom = Math.max(bottom, box.bottom - r.top)
    }
    return { top, bottom }
  }

  onMount(() => {
    const r = new Renderer(canvas, v.replay, v.map)
    renderer = r
    const fit = () => {
      size = { w: wrap.clientWidth, h: wrap.clientHeight }
      r.insets = insets()
      r.resize(size.w, size.h)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    fit()

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      v.advance(dt, now)
      r.draw(v.live, v.options(r.level), dt)
      recheck()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  const sevWord: Record<string, string> = { high: 'Serious', medium: 'Costly', low: 'Minor', positive: 'Good play' }

  const evidence = $derived.by(() => {
    if (hover?.kind !== 'blunder') return null
    const b = v.replay.blunders[hover.id]
    if (!b) return null
    const n = v.replay.roundBlunders[b.round].indexOf(b) + 1
    const who = b.player >= 0 ? v.replay.playerName(b.player) : v.replay.teamName(b.team)
    return { b, n, who, at: roundClock(v.replay, b.tick).text }
  })

  // The hovered player at the current tick, refreshed with the panels.
  const player = $derived.by(() => {
    if (hover?.kind !== 'player') return null
    const p = hover.id
    const s = v.replay.state(p, v.tick)
    if (!s.present) return null
    const nades: number[] = []
    const u = s.util
    if (u & UTIL.smoke) nades.push(EQ.smoke)
    if (u & UTIL.flash1) nades.push(EQ.flash)
    if (u & UTIL.flash2) nades.push(EQ.flash)
    if (u & UTIL.he) nades.push(EQ.he)
    if (u & UTIL.fire) nades.push(s.side === 3 ? EQ.incendiary : EQ.molotov)
    if (u & UTIL.decoy) nades.push(EQ.decoy)
    const status: string[] = []
    if (s.flags & FLAG.defusing) status.push('Defusing')
    if (s.flags & FLAG.planting) status.push('Planting')
    if (s.flash > 0.2) status.push(`Blind ${s.flash.toFixed(1)}s`)
    if (s.flags & FLAG.reloading) status.push('Reloading')
    return {
      name: v.replay.playerName(p),
      slot: v.replay.slot[p],
      color: teamColor(s.side),
      s,
      weapon: weaponIcon(s.weapon, s.side),
      weaponLabel: weaponName(s.weapon),
      nades,
      bomb: (s.flags & FLAG.bomb) !== 0,
      kit: (s.flags & FLAG.kit) !== 0,
      helmet: (s.flags & FLAG.helmet) !== 0,
      place: s.place ? v.replay.placeName(s.place) : '',
      status,
    }
  })

  // Keep the tip inside the radar: flip to the other side of the cursor
  // near the right and bottom edges.
  const tipStyle = $derived.by(() => {
    if (!hover) return ''
    const right = hover.x > size.w - 300
    const below = hover.y > size.h - 170
    const x = right ? `right: ${size.w - hover.x + 16}px` : `left: ${hover.x + 16}px`
    const y = below ? `bottom: ${size.h - hover.y + 12}px` : `top: ${hover.y + 12}px`
    return `${x}; ${y}`
  })

  let drag: { x: number; y: number; moved: boolean } | null = null
  // Last pointer position over the canvas, null when outside.
  let pointer: [number, number] | null = null

  // Players move under a still pointer, so the hover is checked again as
  // the radar redraws.
  function recheck() {
    if (!renderer || !pointer || drag) return
    const h = renderer.hitTest(pointer[0], pointer[1])
    renderer.hover = h
    if ((h?.kind ?? null) !== (hover?.kind ?? null) || h?.id !== hover?.id) {
      cursor = h ? 'pointer' : 'grab'
      describe(h, pointer[0], pointer[1])
    }
  }

  function pos(e: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  function describe(h: Hit | null, x: number, y: number) {
    hover = h ? { kind: h.kind, id: h.id, x, y } : null
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  }

  function onMove(e: PointerEvent) {
    if (!renderer) return
    pointer = pos(e)
    if (drag) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && dx * dx + dy * dy > 16) {
        drag.moved = true
        // Panning by hand takes over from the follow camera.
        if (v.follow >= 0) v.follow = -1
        cursor = 'grabbing'
        hover = null
      }
      if (drag.moved) {
        renderer.cam.pan(dx, dy)
        drag.x = e.clientX
        drag.y = e.clientY
      }
      return
    }
    const [x, y] = pointer
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
    resetCamera()
  }

  $effect(() => {
    // Zoom in when a follow starts, not so far that the radar image gets
    // soft.
    const following = v.follow >= 0
    if (!renderer) return
    if (following && renderer.cam.zoom < 1.6) renderer.cam.zoom = 2
  })
</script>

<div class="radar" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    style:cursor={cursor}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointerleave={() => {
      if (renderer) renderer.hover = null
      pointer = null
      hover = null
    }}
    onwheel={onWheel}
    ondblclick={onDouble}
  ></canvas>
  {#if evidence}
    <div class="tip evidence" style={tipStyle}>
      <header>
        <span class="mark num">{evidence.n}</span>
        <span class="label">Evidence</span>
        <span class="when num">R{evidence.b.round + 1} · {evidence.at}</span>
      </header>
      <strong>{evidence.b.title}</strong>
      <p>{evidence.b.detail}</p>
      <footer>
        <span>{evidence.who}</span>
        {#if sevWord[evidence.b.severity]}
          <span class="sev {evidence.b.severity}">{sevWord[evidence.b.severity]}</span>
        {/if}
      </footer>
    </div>
  {:else if player}
    <div class="tip player" style="{tipStyle}; --team: {player.color.base}">
      <header>
        <span class="slot num">{player.slot}</span>
        <strong class="name">{player.name}</strong>
        {#if player.place}<span class="place">{player.place}</span>{/if}
      </header>
      {#if player.s.alive}
        <div class="vitals">
          <span class="stat" title="Health">
            <GameIcon name="hud/health" h={12} fallback="HP" />
            <span class="num" class:low={player.s.hp <= 20}>{player.s.hp}</span>
          </span>
          <span class="stat" title={player.helmet ? 'Armor and helmet' : 'Armor'}>
            <GameIcon name={player.helmet ? 'hud/armor-helmet' : 'hud/armor'} h={12} fallback="AR" />
            <span class="num">{player.s.armor}</span>
          </span>
          <span class="stat money num">${player.s.money.toLocaleString('en-US')}</span>
        </div>
        <div class="gear">
          <span class="weapon" title={player.weaponLabel}>
            <GameIcon name={player.weapon} h={16} fallback={player.weaponLabel} />
          </span>
          <span class="weapon-name">{player.weaponLabel}</span>
        </div>
        {#if player.nades.length || player.bomb || player.kit}
          <div class="kit">
            {#each player.nades as n, i (i)}
              <GameIcon name={weaponIcon(n)} h={14} title={weaponName(n)} fallback={weaponName(n)} />
            {/each}
            {#if player.bomb}
              <GameIcon name="weapon/c4" h={14} color="var(--accent)" title="Bomb" fallback="C4" />
            {/if}
            {#if player.kit}
              <GameIcon name="weapon/defuser" h={14} title="Defuse kit" fallback="Kit" />
            {/if}
          </div>
        {/if}
        {#if player.status.length}
          <div class="status">
            {#each player.status as st (st)}<span>{st}</span>{/each}
          </div>
        {/if}
      {:else}
        <p class="dead">Dead</p>
      {/if}
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
    width: max-content;
    max-width: 280px;
    background: rgba(18, 21, 26, 0.97);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    padding: 10px 12px;
    pointer-events: none;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 4;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .evidence .mark {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--evidence);
    color: var(--bg);
    font-family: var(--display);
    font-weight: 700;
    font-size: 12px;
  }

  .evidence .label {
    color: var(--evidence);
  }

  .when {
    margin-left: auto;
    color: var(--text-3);
    font-size: 12px;
  }

  .evidence strong {
    font-family: var(--display);
    font-weight: 600;
    font-size: 15px;
    line-height: 1.25;
  }

  .evidence p {
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.45;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--text-2);
  }

  .sev {
    margin-left: auto;
    font-family: var(--display);
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .sev.high {
    color: var(--accent);
  }

  .sev.medium {
    color: var(--warn);
  }

  .sev.positive {
    color: var(--good);
  }

  .player {
    min-width: 200px;
    border-top: 2px solid var(--team);
    gap: 8px;
  }

  .slot {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--team);
    color: var(--bg);
    font-family: var(--display);
    font-weight: 700;
    font-size: 11px;
  }

  .name {
    font-family: var(--display);
    font-weight: 600;
    font-size: 15px;
    color: var(--team);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .place {
    margin-left: auto;
    padding-left: 8px;
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .vitals {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-2);
    font-family: var(--display);
    font-weight: 600;
    font-size: 14px;
  }

  .stat .num {
    color: var(--text);
  }

  .stat .low {
    color: var(--bad);
  }

  .money {
    margin-left: auto;
    color: var(--good);
  }

  .gear {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .weapon {
    display: inline-flex;
    color: var(--text);
  }

  .weapon-name {
    margin-left: auto;
    font-family: var(--display);
    font-weight: 600;
    font-size: 13px;
    color: var(--text-2);
  }

  .kit {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .status span {
    font-family: var(--display);
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text-2);
  }

  .dead {
    margin: 0;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
