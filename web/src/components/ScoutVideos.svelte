<script lang="ts">
  import { exportFolder, openExport, saveExport } from '../lib/api'
  import { mapLabel } from '../lib/format'
  import { indexHtml, type SavedVideo } from '../lib/scout/indexpage'
  import { scoutOptions } from '../lib/scout/aggregate'
  import { clockText, lengthOf, Overlay } from '../lib/scout/overlay'
  import type { MapScout, Situation } from '../lib/scout/types'
  import { Cancelled, targetBitrate } from '../lib/scout/video'
  import {
    COVER_NOTES,
    COVER_PLAIN,
    DEFAULT_SPEED,
    fightsOf,
    FPS,
    lengthSeconds,
    MAX_VIDEO_BYTES,
    pages,
    renderStory,
    renderVideo,
    sizeOf,
    storyPages,
    storyPlan,
    teamFolder,
    VIDEO_LAYOUTS,
    VIDEO_LENGTHS,
    VIDEO_SIZES,
    VIDEO_SPEEDS,
    videoPath,
    type VideoLayout,
  } from '../lib/scout/videos'
  import Icon from './Icon.svelte'
  import ScoutIcon from './ScoutIcon.svelte'

  // Makes the video of every situation on every map and saves them in
  // folders: <team>/<map>/<side>/<round type>.mp4.
  let { scouts, teamName, onclose }: { scouts: MapScout[]; teamName: string; onclose: () => void } = $props()

  type Stage = 'waiting' | 'making' | 'saved' | 'failed'
  interface Item {
    key: string
    scout: MapScout
    s: Situation
    layout: VideoLayout
    // The rounds in this video, null for all of them. A map per round with
    // many rounds is split over several videos, part says which rounds.
    rounds: number[] | null
    part?: { from: number; to: number }
    // Seconds of video.
    secs: number
  }
  interface Done {
    stage: Stage
    path?: string
    error?: string
  }

  let size = $state('1080')
  let length = $state('round')
  let layout = $state<VideoLayout>('story')
  let speed = $state(DEFAULT_SPEED)
  let skip = $state<Record<string, boolean>>({})
  let done = $state<Record<string, Done>>({})
  let running = $state(false)
  let finished = $state(false)
  let current = $state('')
  let progress = $state(0)
  let left = $state('')
  let dir = $state('')
  let collapsed = $state(false)
  let error = $state('')
  let page = $state('')
  let abort: AbortController | null = null
  let dialog: HTMLDivElement | undefined = $state()

  const items = $derived<Item[]>(
    scouts.flatMap((m) => {
      const max = scoutOptions(m).trackSeconds
      const cut = lengthSeconds(length)
      return m.situations
        .filter((s) => s.tracks.length)
        .flatMap((s): Item[] => {
          const lay = layout
          const part = (pg: number[], split: boolean) => (split ? { from: pg[0] + 1, to: pg[pg.length - 1] + 1 } : undefined)
          if (lay === 'story') {
            // One after another, split so no video runs over five minutes.
            const lens = s.tracks.map((tr, i) => {
              const full = lengthOf([tr], max)
              return { round: i, length: cut > 0 ? Math.min(cut, full) : full, fights: fightsOf(tr) }
            })
            const groups = storyPages(lens, speed)
            return groups.map((g, n) => {
              const pg = g.map((r) => r.round)
              return { key: `${m.map}/${s.key}/${n}`, scout: m, s, layout: lay, rounds: pg, part: part(pg, groups.length > 1), secs: storyPlan(g, speed, s.notes.length ? COVER_NOTES : COVER_PLAIN).total }
            })
          }
          const parts = pages(
            s.tracks.map((_, i) => i),
            lay,
          )
          return parts.map((pg, n) => {
            const full = lengthOf(
              pg.map((i) => s.tracks[i]),
              max,
            )
            const split = parts.length > 1
            return {
              key: `${m.map}/${s.key}/${n}`,
              scout: m,
              s,
              layout: lay,
              rounds: split ? pg : null,
              part: part(pg, split),
              secs: cut > 0 ? Math.min(cut, full) : full,
            }
          })
        })
    }),
  )
  const chosen = $derived(items.filter((i) => !skip[i.scout.map]))
  const totalSecs = $derived(chosen.reduce((n, i) => n + i.secs, 0))
  // The encoder stays a bit under its target on a mostly still map.
  const totalMb = $derived.by(() => {
    const { w, h } = sizeOf(size)
    const bytes = chosen.reduce((n, i) => n + (targetBitrate(w, h, FPS, i.secs, MAX_VIDEO_BYTES) / 8) * i.secs * 0.85, 0)
    return Math.max(1, Math.round(bytes / 1e6))
  })
  const savedCount = $derived(Object.values(done).filter((d) => d.stage === 'saved').length)
  const failedCount = $derived(Object.values(done).filter((d) => d.stage === 'failed').length)
  const doneCount = $derived(savedCount + failedCount)
  const runTotal = $derived(Object.keys(done).length)
  const currentItem = $derived(items.find((i) => i.key === current) ?? null)
  const folder = $derived(teamFolder(teamName))
  const where = $derived(dir ? `${dir}${dir.includes('\\') ? '\\' : '/'}${folder}` : '')

  $effect(() => {
    exportFolder()
      .then((d) => (dir = d))
      .catch(() => {})
  })

  $effect(() => {
    if (!collapsed) dialog?.focus()
  })

  // Closing the page part stops a batch that is still going.
  $effect(() => () => abort?.abort())

  function buyName(s: Situation): string {
    const b = s.title.replace(/^(CT|T) /, '')
    return b.charAt(0).toUpperCase() + b.slice(1)
  }

  function minutes(sec: number): string {
    if (sec < 60) return 'under a minute'
    const m = Math.round(sec / 60)
    return m === 1 ? 'about a minute' : `about ${m} minutes`
  }

  async function start() {
    if (running || !chosen.length) return
    const list = chosen.slice()
    const sz = sizeOf(size)
    const cut = lengthSeconds(length)
    running = true
    finished = false
    error = ''
    left = ''
    done = Object.fromEntries(list.map((i) => [i.key, { stage: 'waiting' as Stage }]))
    abort = new AbortController()
    const signal = abort.signal
    const t0 = performance.now()
    const all = list.reduce((n, i) => n + i.secs, 0)
    let secsDone = 0
    for (const it of list) {
      if (signal.aborted) break
      current = it.key
      progress = 0
      done = { ...done, [it.key]: { stage: 'making' } }
      try {
        const o = await Overlay.create(it.scout, it.s, { teamName })
        const onp = (p: number) => {
          progress = p
          // Time left from how fast the video seconds so far went.
          const did = secsDone + p * it.secs
          const spent = (performance.now() - t0) / 1000
          if (spent > 5 && did > 0) left = minutes(((all - did) * spent) / did)
        }
        const v =
          it.layout === 'story'
            ? await renderStory(o, {}, it.rounds ?? it.s.tracks.map((_, i) => i), sz, cut, speed, onp, signal)
            : await renderVideo(o, { layout: it.layout, rounds: it.rounds }, sz, cut, onp, signal)
        const path = videoPath(teamName, it.scout.map, it.s, v.ext, it.part)
        await saveExport(path, v.blob)
        done = { ...done, [it.key]: { stage: 'saved', path } }
      } catch (e) {
        if (e instanceof Cancelled || signal.aborted) {
          done = { ...done, [it.key]: { stage: 'waiting' } }
          break
        }
        done = { ...done, [it.key]: { stage: 'failed', error: (e as Error).message || 'Could not make this video' } }
      }
      secsDone += it.secs
    }
    // A page next to the videos with all of them, by map and side.
    const saved: SavedVideo[] = list.flatMap((it) => {
      const d = done[it.key]
      if (d?.stage !== 'saved' || !d.path) return []
      return [{ map: it.scout.map, situation: it.s, path: d.path.slice(folder.length + 1), part: it.part }]
    })
    if (saved.length) {
      try {
        const html = indexHtml(teamName, scouts, saved)
        const at = `${folder}/index.html`
        await saveExport(at, new Blob([html], { type: 'text/html' }))
        page = at
      } catch (e) {
        error = (e as Error).message || 'Could not save the video page'
      }
    }
    running = false
    finished = !signal.aborted
    current = ''
    abort = null
    if (finished) collapsed = false
  }

  function cancel() {
    abort?.abort()
  }

  async function open(what = folder) {
    try {
      await openExport(what)
    } catch (e) {
      error = (e as Error).message || 'Could not open it'
    }
  }

  // Closing while it runs keeps it going in the corner.
  function close() {
    if (running) collapsed = true
    else onclose()
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !collapsed) {
      e.preventDefault()
      close()
    }
  }

  function stageText(d: Done | undefined, key: string): string {
    if (!d) return ''
    if (d.stage === 'making' && key === current) return `Making it, ${Math.round(progress * 100)}%`
    if (d.stage === 'waiting') return 'Waiting'
    if (d.stage === 'saved') return 'Saved'
    if (d.stage === 'failed') return d.error ?? 'Failed'
    return ''
  }
</script>

<svelte:window onkeydown={onKey} />

{#if collapsed}
  <div class="mini" role="status">
    <span class="mt">
      <b>Saving videos, {Math.min(doneCount + 1, runTotal)} of {runTotal}</b>
      <span class="faint">{currentItem ? `${mapLabel(currentItem.scout.map)}, ${currentItem.s.title}, ${Math.round(progress * 100)}%` : ''}</span>
    </span>
    <span class="pbar"><i style:width="{runTotal ? ((doneCount + progress) / runTotal) * 100 : 0}%"></i></span>
    <button class="plain" onclick={() => (collapsed = false)}>Show</button>
    <button class="plain" onclick={cancel}>Cancel</button>
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="videos-title" tabindex="-1" bind:this={dialog} onclick={(e) => e.stopPropagation()}>
      <header>
        <span class="badge"><ScoutIcon name="play" size={16} /></span>
        <div class="htext">
          <h2 id="videos-title">Save all videos</h2>
          <span>One video per map, side and round type, every round of it on the map at the same time.</span>
        </div>
        <button class="plain close" title={running ? 'Keep it going in the corner (Esc)' : 'Close (Esc)'} aria-label="Close" onclick={close}><Icon name="x" size={16} /></button>
      </header>

      <div class="controls">
        <div class="field">
          <span class="label">Size</span>
          <div class="seg" role="group" aria-label="Video size">
            {#each VIDEO_SIZES as z (z.id)}
              <button class:on={size === z.id} aria-pressed={size === z.id} disabled={running} title="{z.w} x {z.h}" onclick={() => (size = z.id)}>{z.label}</button>
            {/each}
          </div>
        </div>
        <div class="field">
          <span class="label">Length</span>
          <div class="seg" role="group" aria-label="Video length">
            {#each VIDEO_LENGTHS as l (l.id)}
              <button class:on={length === l.id} aria-pressed={length === l.id} disabled={running} onclick={() => (length = l.id)}>{l.label}</button>
            {/each}
          </div>
        </div>
        <div class="field">
          <span class="label">Layout</span>
          <div class="seg" role="group" aria-label="Layout">
            {#each VIDEO_LAYOUTS as l (l.id)}
              <button class:on={layout === l.id} aria-pressed={layout === l.id} disabled={running} title={l.title} onclick={() => (layout = l.id)}>{l.label}</button>
            {/each}
          </div>
        </div>
        {#if layout === 'story'}
          <div class="field">
            <span class="label">Speed</span>
            <div class="seg" role="group" aria-label="Speed">
              {#each VIDEO_SPEEDS as sp (sp)}
                <button class:on={speed === sp} aria-pressed={speed === sp} disabled={running} onclick={() => (speed = sp)}>{sp}x</button>
              {/each}
            </div>
          </div>
        {/if}
        <span class="spacer"></span>
        {#if running}
          <button class="btn" onclick={cancel}>Cancel</button>
        {:else}
          {#if finished || savedCount}
            {#if page}
              <button class="btn" title="A page with every video, by map and side" onclick={() => open(page)}><ScoutIcon name="play" size={13} /><span>Open video page</span></button>
            {/if}
            <button class="btn" onclick={() => open()}><ScoutIcon name="external" size={14} /><span>Open folder</span></button>
          {/if}
          <button class="primary" disabled={!chosen.length} onclick={start}>
            <ScoutIcon name="download" size={15} />
            <span>{finished ? 'Save again' : `Save ${chosen.length} ${chosen.length === 1 ? 'video' : 'videos'}`}</span>
          </button>
        {/if}
      </div>

      <div class="status" aria-live="polite">
        {#if running}
          <span class="pbar big"><i style:width="{runTotal ? ((doneCount + progress) / runTotal) * 100 : 0}%"></i></span>
          <span>Video {Math.min(doneCount + 1, runTotal)} of {runTotal}{left ? `, ${left} left` : ''}. You can close this window, it keeps going in the corner.</span>
        {:else if finished}
          <span class:good={!failedCount}>Saved {savedCount} {savedCount === 1 ? 'video' : 'videos'}{failedCount ? `, ${failedCount} failed` : ''}.</span>
        {:else}
          <span class="faint">{clockText(totalSecs)} of video, about {totalMb} MB, each one under {MAX_VIDEO_BYTES / 1e6} MB. Making them takes about as long as they last, often less.</span>
        {/if}
        {#if where}<span class="faint path" title={where}>Saves to {where}</span>{/if}
        {#if error}<span class="err" role="alert">{error}</span>{/if}
      </div>

      <div class="body">
        {#each scouts as m (m.map)}
          {@const list = items.filter((i) => i.scout === m)}
          {#if list.length}
            <section class="map" class:off={skip[m.map]}>
              <label class="mh">
                <input type="checkbox" checked={!skip[m.map]} disabled={running} onchange={() => (skip = { ...skip, [m.map]: !skip[m.map] })} />
                <b>{mapLabel(m.map)}</b>
                <span class="faint">{list.length} {list.length === 1 ? 'video' : 'videos'}</span>
              </label>
              <ul>
                {#each list as it (it.key)}
                  {@const d = done[it.key]}
                  {@const n = it.rounds?.length ?? it.s.tracks.length}
                  <li class={d?.stage ?? ''}>
                    <span class="tag {it.s.side}">{it.s.side.toUpperCase()}</span>
                    <span class="nm">{buyName(it.s)}{it.part ? `, ${it.part.from}-${it.part.to}` : ''}</span>
                    <span class="faint num">{n} {n === 1 ? 'round' : 'rounds'}, {clockText(it.secs)}</span>
                    <span class="file faint" title={d?.path ?? videoPath(teamName, m.map, it.s, 'mp4', it.part)}>{d?.path ?? videoPath(teamName, m.map, it.s, 'mp4', it.part)}</span>
                    <span class="st">
                      {#if d?.stage === 'making'}<i class="spin"></i>{:else if d?.stage === 'saved'}<Icon name="check" size={14} />{/if}
                      <span>{stageText(d, it.key)}</span>
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        {/each}
        {#if !items.length}
          <p class="faint">No situations with rounds yet. Build the report first.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
    width: min(980px, 100%);
    height: min(820px, 100%);
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
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding: 2px;
    gap: 2px;
  }

  .seg button {
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
  }

  .seg button:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-2);
  }

  .seg button.on {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .spacer {
    flex: 1;
  }

  .primary,
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
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

  .status {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--line);
  }

  .path {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .good {
    color: var(--good);
  }

  .err {
    color: var(--bad);
  }

  .pbar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .pbar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s linear;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 18px 20px;
  }

  .map {
    padding: 8px 0;
  }

  .map + .map {
    border-top: 1px solid var(--line);
  }

  .map.off ul {
    opacity: 0.4;
  }

  .mh {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 0 6px;
    cursor: pointer;
  }

  .mh input {
    accent-color: var(--accent);
    margin: 0;
  }

  .mh b {
    font-family: var(--display);
    font-size: 15px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: 30px 130px 130px minmax(0, 1fr) 150px;
    align-items: center;
    gap: 10px;
    height: 30px;
  }

  .tag {
    justify-self: start;
    height: 18px;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    letter-spacing: 0.04em;
  }

  .tag.ct {
    color: var(--ct);
    background: rgba(98, 169, 245, 0.13);
  }

  .tag.t {
    color: var(--t);
    background: rgba(239, 166, 60, 0.13);
  }

  .nm {
    font-family: var(--display);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .file {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  .st {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-3);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
  }

  li.saved .st {
    color: var(--good);
  }

  li.failed .st {
    color: var(--bad);
  }

  li.making .st {
    color: var(--text);
  }

  .spin {
    width: 12px;
    height: 12px;
    flex: none;
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

  .mini {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 40;
    width: min(420px, calc(100vw - 32px));
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 8px 10px;
    padding: 12px 12px 12px 14px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .mt {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .mt span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  .mini .pbar {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .mini button {
    height: 28px;
    padding: 0 8px;
    color: var(--text-2);
  }

  .mini button:hover {
    color: var(--text);
  }

  @media (max-width: 760px) {
    li {
      grid-template-columns: 30px 1fr auto;
      height: auto;
      padding: 4px 0;
    }

    .file,
    .num {
      display: none;
    }
  }
</style>
