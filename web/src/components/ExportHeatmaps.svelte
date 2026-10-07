<script lang="ts">
  import { mapLabel } from '../lib/format'
  import type { Replay } from '../lib/replay'
  import { renderMatchPlayers } from '../lib/scout/render'
  import Icon from './Icon.svelte'
  import ScoutGallery, { fileName, freePictures, saveZip, toPicture, toPictures, type Picture } from './ScoutGallery.svelte'
  import ScoutIcon from './ScoutIcon.svelte'

  // Heatmap images of one team in this match: one per player and one for
  // the whole team, ready to download as PNG.
  let { replay, team: firstTeam = 0, onclose }: { replay: Replay; team?: number; onclose: () => void } = $props()

  // svelte-ignore state_referenced_locally
  let team = $state(firstTeam === 1 ? 1 : 0)
  let side = $state<0 | 2 | 3>(0)
  let win = $state<'round' | 'early'>('round')
  let seconds = $state(20)
  let pictures = $state.raw<Picture[]>([])
  let busy = $state(false)
  let saving = $state(false)
  let error = $state('')
  let dialog: HTMLDivElement | undefined = $state()

  const r = $derived(replay)
  const members = $derived(r.teamPlayers[team]?.filter((p) => !r.match.players[p]?.isBot) ?? [])
  const expected = $derived(members.length + 1)
  const early = $derived(Math.max(5, Math.min(115, Math.round(Number(seconds) || 20))))
  const zipName = $derived(`${fileName(mapLabel(r.match.map), 'map')}-${fileName(r.teamName(team), `team-${team + 1}`)}-heatmaps.zip`)

  const sides: { id: 0 | 2 | 3; label: string }[] = [
    { id: 0, label: 'Both' },
    { id: 3, label: 'CT' },
    { id: 2, label: 'T' },
  ]

  // Each change draws the set again. Only the newest run may show its result.
  let run = 0
  $effect(() => {
    const opts = { team, side, window: win, earlySeconds: early }
    const my = ++run
    busy = true
    error = ''
    const timer = setTimeout(() => draw(my, opts), 150)
    return () => clearTimeout(timer)
  })

  class Stale extends Error {}

  async function draw(my: number, o: { team: number; side: 0 | 2 | 3; window: 'round' | 'early'; earlySeconds: number }) {
    if (my !== run) return
    freePictures(pictures)
    pictures = []
    const next: Picture[] = []
    try {
      const images = await renderMatchPlayers(r, o.team, {
        side: o.side,
        window: o.window,
        earlySeconds: o.earlySeconds,
        size: 1600,
        onImage: async (img) => {
          if (my !== run) {
            img.canvas.width = img.canvas.height = 0
            throw new Stale()
          }
          next.push(await toPicture(img))
          pictures = next.slice()
        },
      })
      const left = images.filter((im) => im.canvas.width > 0)
      if (left.length) next.push(...(await toPictures(left)))
      if (my !== run) throw new Stale()
      pictures = next
    } catch (e) {
      if (my !== run || e instanceof Stale) {
        freePictures(next)
        return
      }
      error = (e as Error).message || 'Could not draw the images'
    } finally {
      if (my === run) busy = false
    }
  }

  $effect(() => {
    dialog?.focus()
  })

  // The previews are object URLs, they go when the dialog closes.
  $effect(() => () => freePictures(pictures))

  async function saveAll() {
    if (!pictures.length) return
    saving = true
    try {
      await saveZip([{ pictures }], zipName)
    } finally {
      saving = false
    }
  }

  // Keys stay in the dialog so the replay behind it does not move. Escape
  // closes it from anywhere, the large image view catches its own first.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onclose()
    }
  }

  function sideClass(s: number): string {
    return s === 3 ? 'ct' : s === 2 ? 't' : ''
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" tabindex="-1" bind:this={dialog} onclick={(e) => e.stopPropagation()}>
    <header>
      <span class="badge"><ScoutIcon name="image" size={17} /></span>
      <div class="htext">
        <h2 id="export-title">Export heatmaps</h2>
        <span>{mapLabel(r.match.map)}, {r.teamName(0)} vs {r.teamName(1)}. One image per player plus the whole team, 1600 px PNG.</span>
      </div>
      <button class="plain close" title="Close (Esc)" aria-label="Close" onclick={onclose}><Icon name="x" size={16} /></button>
    </header>

    <div class="controls">
      <div class="field">
        <span class="label">Team</span>
        <div class="seg" role="group" aria-label="Team">
          {#each [0, 1] as t (t)}
            <button class="team {sideClass(r.match.teams[t]?.startSide ?? 0)}" class:on={team === t} aria-pressed={team === t} title={r.teamName(t)} onclick={() => (team = t)}>
              <i></i><span>{r.teamName(t)}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span class="label">Side</span>
        <div class="seg" role="group" aria-label="Side">
          {#each sides as s (s.id)}
            <button class:on={side === s.id} aria-pressed={side === s.id} onclick={() => (side = s.id)}>{s.label}</button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span class="label">Time in the round</span>
        <div class="row">
          <div class="seg" role="group" aria-label="Time in the round">
            <button class:on={win === 'round'} aria-pressed={win === 'round'} onclick={() => (win = 'round')}>Whole round</button>
            <button class:on={win === 'early'} aria-pressed={win === 'early'} onclick={() => (win = 'early')}>Early round</button>
          </div>
          {#if win === 'early'}
            <label class="secs">
              <span>First</span>
              <input type="number" min="5" max="115" step="5" bind:value={seconds} aria-label="Seconds after freeze time" />
              <span>s</span>
            </label>
          {/if}
        </div>
      </div>
      <span class="spacer"></span>
      <button class="primary" disabled={!pictures.length || busy || saving} onclick={saveAll}>
        <ScoutIcon name="download" size={15} />
        <span>Download all (zip)</span>
      </button>
    </div>

    <div class="body">
      {#if error}
        <div class="error" role="alert">{error}</div>
      {/if}
      <div class="status" aria-live="polite">
        {#if busy}
          <i class="spin"></i><span>Drawing image {Math.min(pictures.length + 1, expected)} of {expected}</span>
        {:else if pictures.length}
          <span>{pictures.length} images</span><span class="faint">·</span><span class="faint file" title={zipName}>{zipName}</span>
        {/if}
      </div>
      <ScoutGallery {pictures} placeholders={busy ? Math.max(1, expected - pictures.length) : 0} compact />
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
    background: rgba(11, 13, 17, 0.72);
  }

  .dialog {
    width: min(1120px, 100%);
    height: min(880px, 100%);
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
    padding: 14px 12px 14px 18px;
    border-bottom: 1px solid var(--line);
  }

  .badge {
    width: 34px;
    height: 34px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text);
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

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 14px 24px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .seg {
    display: inline-flex;
    min-width: 0;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding: 2px;
    gap: 2px;
  }

  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    min-width: 0;
    padding: 0 12px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 13.5px;
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

  .team span {
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .team i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--text-3);
    flex: none;
  }

  .team.ct i {
    background: var(--ct);
  }

  .team.t i {
    background: var(--t);
  }

  .secs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
  }

  .secs input {
    width: 58px;
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .spacer {
    flex: 1;
  }

  .primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px 0 12px;
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    background: #f6636a;
    border-color: #f6636a;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 18px 20px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
    margin-bottom: 12px;
    color: var(--text-2);
    min-width: 0;
  }

  .file {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spin {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  .error {
    margin-bottom: 12px;
    padding: 8px 12px;
    border: 1px solid rgba(255, 100, 100, 0.35);
    border-radius: var(--radius);
    background: rgba(255, 100, 100, 0.08);
    color: var(--bad);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 760px) {
    .scrim {
      padding: 0;
    }

    .dialog {
      height: 100%;
      border-radius: 0;
    }

    .htext span {
      white-space: normal;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
