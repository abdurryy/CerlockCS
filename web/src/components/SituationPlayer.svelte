<script lang="ts">
  import { copyText } from '../lib/clipboard'
  import { mapLabel } from '../lib/format'
  import { clockText, hitMarks, Overlay, type FloorMode, type OverlayOptions } from '../lib/scout/overlay'
  import type { MapScout, Situation, SituationTrack } from '../lib/scout/types'
  import { Cancelled } from '../lib/scout/video'
  import { FPS, lengthSeconds, renderVideo, sizeOf, VIDEO_LENGTHS, VIDEO_SIZES, videoLength } from '../lib/scout/videos'
  import { downloadBlob } from '../lib/zip'
  import Icon from './Icon.svelte'
  import { fileName } from './ScoutGallery.svelte'
  import ScoutIcon from './ScoutIcon.svelte'

  // Plays every round of one situation on the map at once, from freeze
  // time to the end of the round, and saves it as a video or a still.
  let { scout, situation, teamName = '', onclose }: { scout: MapScout; situation: Situation; teamName?: string; onclose?: () => void } = $props()

  const SPEEDS = [0.5, 1, 2, 4]

  let overlay = $state.raw<Overlay | null>(null)
  let error = $state('')
  let t = $state(0)
  let playing = $state(false)
  let speed = $state(1)
  // svelte-ignore state_referenced_locally
  let picked = $state<boolean[]>(situation.tracks.map(() => true))
  let highlight = $state<string | null>(null)
  let floors = $state<FloorMode>('auto')
  let size = $state('1080')
  let length = $state('round')
  let progress = $state(-1)
  let copiedRound = $state(-1)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  let saved = $state('')
  let abort: AbortController | null = null
  let dialog: HTMLDivElement | undefined = $state()
  let stage: HTMLDivElement | undefined = $state()
  let canvas: HTMLCanvasElement | undefined = $state()
  let box = $state({ w: 0, h: 0 })
  // Bumped when the overlay finished loading something, so a paused view
  // draws again.
  let tick = $state(0)

  const s = $derived(situation)
  // One array per change of the picks, the overlay keys its cache on it.
  const rounds = $derived.by(() => (picked.every(Boolean) ? null : picked.flatMap((on, i) => (on ? [i] : []))))
  // As long as the longest of the picked rounds.
  const duration = $derived(overlay ? overlay.durationOf(rounds) : 30)
  const videoSecs = $derived(overlay ? videoLength(overlay, rounds, lengthSeconds(length)) : 0)
  const step = $derived(overlay?.step ?? 0.25)
  const exporting = $derived(progress >= 0)
  const shown = $derived(rounds ? rounds.map((i) => s.tracks[i]) : s.tracks)
  const marks = $derived(hitMarks(shown, duration, 10, 600))
  const opts = $derived<OverlayOptions>({ rounds, highlight, floors })
  const players = $derived.by(() => {
    const seen = new Map<string, { steamId: string; name: string; color: string; role: string }>()
    for (const r of scout.roles) seen.set(r.steamId, { steamId: r.steamId, name: r.name, color: r.color, role: s.side === 'ct' ? r.ct.label : r.t.label })
    for (const tr of s.tracks) for (const p of tr.players) if (!seen.has(p.steamId)) seen.set(p.steamId, { steamId: p.steamId, name: p.name, color: p.color, role: '' })
    return [...seen.values()]
  })
  const floorModes = $derived.by(() => {
    if (!overlay || overlay.floorCount < 2) return []
    const out: { id: FloorMode; label: string }[] = [{ id: 'auto', label: 'Auto' }]
    for (let i = 0; i < overlay.floorCount; i++) out.push({ id: i, label: overlay.floorName(i) })
    out.push({ id: 'both', label: 'Both' })
    return out
  })
  const baseName = $derived(`${fileName(teamName, 'team')}-${fileName(mapLabel(scout.map), 'map')}-${s.key}`)

  $effect(() => {
    let live = true
    overlay = null
    error = ''
    Overlay.create(scout, situation, { teamName })
      .then((o) => {
        if (!live) return
        o.onchange = () => tick++
        overlay = o
      })
      .catch((e) => {
        if (live) error = (e as Error).message || 'Could not load the map'
      })
    return () => {
      live = false
    }
  })

  $effect(() => {
    dialog?.focus()
  })

  // The canvas follows the size of its box at the screen's pixel density.
  $effect(() => {
    if (!stage) return
    const ro = new ResizeObserver(() => {
      if (!stage) return
      const r = stage.getBoundingClientRect()
      box = { w: r.width, h: r.height }
    })
    ro.observe(stage)
    return () => ro.disconnect()
  })

  $effect(() => {
    const o = overlay
    const c = canvas
    const { w, h } = box
    void tick
    if (!o || !c || w < 2 || h < 2 || exporting) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    o.draw(c, t, opts)
  })

  // While playing, the clock moves with real time times the speed.
  $effect(() => {
    if (!playing) return
    let last = 0
    let raf = requestAnimationFrame(function frame(now) {
      const dt = last ? Math.min(0.5, (now - last) / 1000) : 0
      last = now
      const next = Math.min(duration, t + dt * speed)
      t = next
      if (next >= duration) {
        playing = false
        return
      }
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  })

  function toggle() {
    if (exporting) return
    if (!playing && t >= duration - 1e-3) t = 0
    playing = !playing
  }

  function seek(to: number) {
    t = Math.max(0, Math.min(duration, to))
  }

  function pickAll(on: boolean) {
    picked = s.tracks.map(() => on)
  }

  function only(i: number) {
    picked = s.tracks.map((_, j) => j === i)
  }

  function flip(i: number) {
    const next = picked.slice()
    next[i] = !next[i]
    picked = next
  }

  function hiPlayer(id: string) {
    highlight = highlight === id ? null : id
  }

  async function saveVideo() {
    if (!overlay || exporting) return
    playing = false
    saved = ''
    error = ''
    progress = 0
    abort = new AbortController()
    const o = overlay
    const view = opts
    try {
      const v = await renderVideo(o, view, sizeOf(size), lengthSeconds(length), (p) => (progress = p), abort.signal)
      const name = `${baseName}.${v.ext}`
      downloadBlob(v.blob, name)
      saved = name
    } catch (e) {
      if (!(e instanceof Cancelled)) error = (e as Error).message || 'Could not make the video'
    } finally {
      abort = null
      progress = -1
      tick++
    }
  }

  async function saveFrame() {
    if (!overlay || exporting) return
    const sz = sizeOf(size)
    await overlay.prepare(sz.w, sz.h)
    const c = document.createElement('canvas')
    c.width = sz.w
    c.height = sz.h
    overlay.draw(c, t, opts)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    c.width = c.height = 0
    tick++
    if (!blob) return
    const name = `${baseName}-${Math.floor(t)}s.png`
    downloadBlob(blob, name)
    saved = name
  }

  function close() {
    abort?.abort()
    onclose?.()
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    const typing = !!el && (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox'))
    if (e.key === 'Escape') {
      e.preventDefault()
      if (exporting) abort?.abort()
      else close()
      return
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const by = (e.shiftKey ? step : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
      seek(t + by)
    } else if (e.key === 'Home') {
      e.preventDefault()
      seek(0)
    }
  }

  // cs2Command jumps a demo open in CS2 to this moment of the round, and
  // spectates the highlighted player.
  function cs2Command(tr: SituationTrack): string {
    const tick = Math.round(tr.tick + t * tr.rate)
    const who = highlight ? (tr.players.find((p) => p.steamId === highlight)?.name ?? '') : ''
    const name = who.replace(/[";]/g, '')
    return `demo_gototick ${tick}${name ? `; spec_player "${name}"` : ''}`
  }

  function demoName(tr: SituationTrack): string {
    return scout.replays.find((r) => r.id === tr.replayId)?.name ?? 'the demo'
  }

  async function copyCs2(tr: SituationTrack, i: number) {
    if (!(await copyText(cs2Command(tr)))) return
    copiedRound = i
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copiedRound = -1), 1600)
  }

  function hitText(hit: string, time: number): string {
    if (!hit || time < 0) return 'No hit'
    return `${hit} at ${clockText(time)}`
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sp-title" tabindex="-1" bind:this={dialog} onclick={(e) => e.stopPropagation()}>
    <header>
      <span class="tag {s.side}">{s.side.toUpperCase()}</span>
      <div class="htext">
        <h2 id="sp-title">{s.title}</h2>
        <span>{mapLabel(scout.map)}{teamName ? `, ${teamName}` : ''}. {s.tracks.length} {s.tracks.length === 1 ? 'round' : 'rounds'}, from freeze time to the end of the round ({clockText(duration)}).</span>
      </div>
      <button class="plain close" title="Close (Esc)" aria-label="Close" onclick={close}><Icon name="x" size={16} /></button>
    </header>

    <div class="main">
      <div class="left">
        <div class="stage" bind:this={stage}>
          <canvas bind:this={canvas} aria-label="Positions of {teamName || 'the team'} on {s.title}, {clockText(t)} into the round"></canvas>
          {#if !overlay && !error}
            <div class="cover"><i class="spin"></i><span>Loading the map</span></div>
          {/if}
          {#if exporting}
            <div class="cover">
              <span>Making the video, {Math.round(progress * 100)}%</span>
              <div class="bar"><i style="width: {Math.round(progress * 100)}%"></i></div>
              <button class="plain" onclick={() => abort?.abort()}>Cancel</button>
            </div>
          {/if}
        </div>

        <div class="controls">
          <button class="playbtn" disabled={!overlay || exporting} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'} onclick={toggle}>
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </button>
          <span class="clock num">{clockText(t)}<span class="faint"> / {clockText(duration)}</span></span>
          <div class="scrub">
            <input type="range" min="0" max={duration} step={step} value={t} disabled={!overlay || exporting} aria-label="Time in the round" oninput={(e) => seek(Number((e.currentTarget as HTMLInputElement).value))} />
            {#each marks as m (m.site + m.time)}
              <span class="hit" style="left: {(m.time / duration) * 100}%" title="{m.n} {m.n === 1 ? 'hit' : 'hits'} on {m.site} around {clockText(m.time)}">{m.site}</span>
            {/each}
          </div>
          <div class="seg" role="group" aria-label="Speed">
            {#each SPEEDS as sp (sp)}
              <button class:on={speed === sp} aria-pressed={speed === sp} onclick={() => (speed = sp)}>{sp}x</button>
            {/each}
          </div>
        </div>

        <div class="export">
          <div class="seg" role="group" aria-label="Video size">
            {#each VIDEO_SIZES as z (z.id)}
              <button class:on={size === z.id} aria-pressed={size === z.id} title="{z.w} x {z.h}" onclick={() => (size = z.id)}>{z.label}</button>
            {/each}
          </div>
          <div class="seg" role="group" aria-label="Video length">
            {#each VIDEO_LENGTHS as l (l.id)}
              <button class:on={length === l.id} aria-pressed={length === l.id} onclick={() => (length = l.id)}>{l.label}</button>
            {/each}
          </div>
          <button class="primary" disabled={!overlay || exporting} onclick={saveVideo}>
            <ScoutIcon name="download" size={15} /><span>Save video</span>
          </button>
          <button class="ghost" disabled={!overlay || exporting} title="Save this moment as a PNG" onclick={saveFrame}>
            <ScoutIcon name="image" size={15} /><span>Save frame</span>
          </button>
          <span class="note" aria-live="polite">
            {#if error}
              <span class="err">{error}</span>
            {:else if saved}
              <span class="faint">Saved {saved}</span>
            {:else}
              <span class="faint">{clockText(videoSecs)} at {FPS} fps, as shown here</span>
            {/if}
          </span>
        </div>
      </div>

      <aside class="side">
        <section>
          <div class="sh">
            <h3>Rounds</h3>
            <span class="links">
              <button class="plain link" onclick={() => pickAll(true)}>All</button>
              <button class="plain link" onclick={() => pickAll(false)}>None</button>
            </span>
          </div>
          <ul class="rounds">
            {#each s.tracks as tr, i (tr.replayId + tr.round)}
              <li class:off={!picked[i]}>
                <label>
                  <input type="checkbox" checked={picked[i]} onchange={() => flip(i)} />
                  <span class="rl">{tr.label}</span>
                  <span class="wl" class:good={tr.won} class:bad={!tr.won}>{tr.won ? 'W' : 'L'}</span>
                </label>
                <span class="hitline faint">{hitText(tr.hit, tr.hitTime)}</span>
                <span class="acts">
                  <button class="plain only" title="Show only this round" onclick={() => only(i)}>Only</button>
                  {#if tr.rate}
                    <button class="plain cs2" class:done={copiedRound === i} title="Copy a console command that jumps to {clockText(t)} of this round. Open {demoName(tr)} in CS2 first." onclick={() => copyCs2(tr, i)}>
                      {copiedRound === i ? 'Copied' : 'CS2'}
                    </button>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>

        {#if players.length}
          <section>
            <div class="sh">
              <h3>Players</h3>
              {#if highlight}<button class="plain link" onclick={() => (highlight = null)}>Show all</button>{/if}
            </div>
            <ul class="players">
              {#each players as p (p.steamId)}
                <li>
                  <button class="pl" class:on={highlight === p.steamId} class:dim={!!highlight && highlight !== p.steamId} aria-pressed={highlight === p.steamId} onclick={() => hiPlayer(p.steamId)}>
                    <i style="background: {p.color}"></i>
                    <span class="pn">{p.name}</span>
                    {#if p.role}<span class="role faint">{p.role}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if floorModes.length}
          <section>
            <div class="sh"><h3>Floor</h3></div>
            <div class="seg wrap" role="group" aria-label="Floor">
              {#each floorModes as f (f.id)}
                <button class:on={floors === f.id} aria-pressed={floors === f.id} onclick={() => (floors = f.id)}>{f.label}</button>
              {/each}
            </div>
          </section>
        {/if}

        {#if s.notes.length}
          <section>
            <div class="sh"><h3>Notes</h3></div>
            <ul class="notes">
              {#each s.notes.slice(0, 4) as n (n)}
                <li>{n}</li>
              {/each}
            </ul>
          </section>
        {/if}

        <p class="keys faint">Space plays and pauses. Arrows move 1 s, with Shift one frame. CS2 copies a command for the console that jumps to this moment, with the demo open in the game.</p>
      </aside>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(11, 13, 17, 0.78);
  }

  .dialog {
    width: min(1440px, 100%);
    height: min(900px, 100%);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .dialog:focus {
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 18px;
    border-bottom: 1px solid var(--line);
  }

  .tag {
    flex: none;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--bg);
  }

  .tag.ct {
    background: var(--ct);
  }

  .tag.t {
    background: var(--t);
  }

  .htext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  h2 {
    font-size: 18px;
    line-height: 1.2;
  }

  .htext span {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    align-self: flex-start;
  }

  .close:hover {
    color: var(--text);
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .cover {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(11, 13, 17, 0.72);
    color: var(--text-2);
    font-family: var(--display);
    font-weight: 600;
  }

  .bar {
    width: min(320px, 60%);
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .spin {
    width: 18px;
    height: 18px;
    border: 2px solid var(--line-2);
    border-top-color: var(--text);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .controls,
  .export {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .export {
    flex-wrap: wrap;
  }

  .playbtn {
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }

  .clock {
    flex: none;
    min-width: 86px;
    font-family: var(--display);
    font-size: 15px;
    font-weight: 600;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .scrub {
    position: relative;
    flex: 1;
    min-width: 120px;
    display: flex;
    align-items: center;
    height: 36px;
  }

  .scrub input {
    width: 100%;
    accent-color: var(--accent);
  }

  .hit {
    position: absolute;
    top: -2px;
    transform: translateX(-50%);
    padding: 0 4px;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text);
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    line-height: 14px;
    pointer-events: auto;
  }

  .seg {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding: 2px;
    gap: 2px;
  }

  .seg.wrap {
    flex-wrap: wrap;
  }

  .seg button {
    height: 26px;
    padding: 0 10px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
  }

  .seg button:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .seg button.on {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .primary,
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 14px 0 12px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .primary:hover:not(:disabled) {
    background: #f6636a;
    border-color: #f6636a;
  }

  .note {
    flex: 1;
    min-width: 0;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .err {
    color: var(--bad);
  }

  .side {
    width: 300px;
    flex: none;
    overflow-y: auto;
    border-left: 1px solid var(--line);
    padding: 6px 0 16px;
  }

  .side section {
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--line);
  }

  .sh {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  h3 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .links {
    display: inline-flex;
    gap: 10px;
  }

  .link {
    padding: 0;
    height: auto;
    color: var(--text-2);
    font-size: 13px;
  }

  .link:hover {
    color: var(--text);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rounds li {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 8px;
    padding: 5px 0;
  }

  .rounds li.off {
    opacity: 0.5;
  }

  .rounds label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    cursor: pointer;
  }

  .rounds input {
    accent-color: var(--accent);
    margin: 0;
  }

  .rl {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wl {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 700;
  }

  .good {
    color: var(--good);
  }

  .bad {
    color: var(--bad);
  }

  .hitline {
    grid-column: 1;
    padding-left: 22px;
    font-size: 12.5px;
  }

  .acts {
    grid-column: 2;
    grid-row: 1 / span 2;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .only,
  .cs2 {
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--text-3);
  }

  .only {
    visibility: hidden;
  }

  .cs2 {
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }

  .cs2:hover {
    color: var(--text);
  }

  .cs2.done {
    color: var(--good);
    border-color: var(--good);
  }

  .rounds li:hover .only,
  .only:focus-visible {
    visibility: visible;
  }

  .only:hover {
    color: var(--text);
  }

  .players li + li {
    margin-top: 2px;
  }

  .pl {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
  }

  .pl:hover {
    background: var(--surface-2);
  }

  .pl.on {
    background: var(--surface-3);
    border-color: var(--line-2);
  }

  .pl.dim {
    opacity: 0.5;
  }

  .pl i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }

  .pn {
    flex: 1;
    min-width: 0;
    font-family: var(--display);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .role {
    font-size: 12.5px;
  }

  .notes li {
    color: var(--text-2);
    font-size: 13.5px;
    line-height: 1.4;
  }

  .notes li + li {
    margin-top: 6px;
  }

  .keys {
    padding: 12px 16px 0;
    font-size: 12.5px;
  }

  .faint {
    color: var(--text-3);
  }

  @media (max-width: 900px) {
    .scrim {
      padding: 0;
    }

    .dialog {
      height: 100%;
      border-radius: 0;
    }

    .main {
      flex-direction: column;
      overflow-y: auto;
    }

    .left {
      flex: none;
    }

    .stage {
      flex: none;
      aspect-ratio: 16 / 9;
    }

    .side {
      width: auto;
      border-left: none;
      overflow: visible;
    }

    .controls {
      flex-wrap: wrap;
    }
  }
</style>
