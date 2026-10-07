<script lang="ts">
  import { untrack } from 'svelte'
  import { mapLabel } from '../lib/format'
  import { buildScout } from '../lib/scout/aggregate'
  import { renderMapImages } from '../lib/scout/render'
  import type { MapScout } from '../lib/scout/types'
  import { fileName, freePictures, saveZip, toPicture, toPictures, type Picture } from './ScoutGallery.svelte'
  import ScoutIcon from './ScoutIcon.svelte'
  import ScoutMapReport, { type ImageSet } from './ScoutMapReport.svelte'
  import type { ScoutState } from './ScoutPage.svelte'

  // Step 3: reads the selected demos into one scouting report per map and
  // draws its images.
  let { s }: { s: ScoutState } = $props()

  let scouts = $state.raw<MapScout[] | null>(null)
  let building = $state(false)
  let prog = $state({ done: 0, total: 0, label: '' })
  let error = $state('')
  let active = $state('')
  let early = $state(20)
  let builtKey = $state('')
  let teamName = $state('')
  let sets = $state.raw<Record<string, ImageSet>>({})
  let zipping = $state('')

  // The seconds as used, an emptied field counts as the default.
  const earlySecs = $derived(Math.max(5, Math.min(60, Math.round(Number(early) || 20))))
  let builtEarly = $state(20)
  const key = $derived(JSON.stringify([s.roster.map((p) => p.steamId), s.selected.map((c) => c.entry.id), earlySecs]))
  const stale = $derived(!!scouts && builtKey !== key)
  const current = $derived(scouts?.find((m) => m.map === active) ?? null)
  const canBuild = $derived(s.roster.length > 0 && s.selected.length > 0 && !building)
  const totalRounds = $derived((scouts ?? []).reduce((n, m) => n + m.ctRounds + m.tRounds, 0))

  // Every build starts a new generation, older renders throw their work away.
  let generation = 0
  let queue: Promise<unknown> = Promise.resolve()
  const inflight = new Map<string, Promise<Picture[]>>()

  function freeAll() {
    for (const set of Object.values(sets)) freePictures(set.pictures)
    sets = {}
    inflight.clear()
  }

  $effect(() => () => {
    generation++
    for (const set of Object.values(sets)) freePictures(set.pictures)
  })

  function setOf(map: string, next: ImageSet) {
    sets = { ...sets, [map]: next }
  }

  async function build() {
    if (!canBuild) return
    generation++
    freeAll()
    building = true
    error = ''
    scouts = null
    prog = { done: 0, total: s.selected.length, label: '' }
    const ids = s.selected.map((c) => c.entry.id)
    const k = key
    const secs = earlySecs
    try {
      const res = await buildScout(ids, $state.snapshot(s.roster), { earlyCtSeconds: secs }, (done, total, label) => (prog = { done, total, label }))
      res.sort((a, b) => b.replays.length - a.replays.length || b.ctRounds + b.tRounds - (a.ctRounds + a.tRounds) || a.map.localeCompare(b.map))
      scouts = res
      builtKey = k
      builtEarly = secs
      teamName = s.rosterName
      active = res[0]?.map ?? ''
      if (!res.length) error = 'None of the selected demos had these players in them.'
    } catch (e) {
      error = (e as Error).message || 'Could not read the demos'
    } finally {
      building = false
    }
  }

  class Stale extends Error {}

  // The team's map pool from FACEIT and the match dates, for the summary
  // card and the footers.
  function extras(): { pool?: { map: string; played: number; won: number }[]; dates?: Record<string, number> } {
    if (!s.found || s.foundFor !== s.teamKey || s.source !== 'faceit') return {}
    const dates: Record<string, number> = {}
    for (const m of s.found.matches) {
      const e = s.entryFor(m.matchId) ?? s.replays.find((x) => x.id === m.replayId)
      if (e && m.startedAt) dates[e.id] = m.startedAt
    }
    return { pool: $state.snapshot(s.found.maps), dates }
  }

  // ensure draws the images of a map once. Maps are drawn one at a time and
  // every image is saved as PNG as soon as it is drawn, so they show up
  // one by one and memory stays low.
  function ensure(map: string): Promise<Picture[]> {
    const done = sets[map]
    if (done?.stage === 'done') return Promise.resolve(done.pictures)
    const running = inflight.get(map)
    if (running) return running
    const scout = scouts?.find((m) => m.map === map)
    if (!scout) return Promise.resolve([])
    const gen = generation
    const name = teamName
    const more = extras()
    setOf(map, { stage: 'waiting', done: 0, total: 0, pictures: [] })
    const p = queue.then(async () => {
      if (gen !== generation) return []
      const pics: Picture[] = []
      setOf(map, { stage: 'drawing', done: 0, total: 0, pictures: [] })
      try {
        const images = await renderMapImages(scout, {
          teamName: name,
          ...more,
          onImage: async (img, n, total) => {
            if (gen !== generation) {
              img.canvas.width = img.canvas.height = 0
              throw new Stale()
            }
            pics.push(await toPicture(img))
            setOf(map, { stage: 'drawing', done: n, total, pictures: pics.slice() })
          },
        })
        // Images that did not come through onImage.
        const left = images.filter((im) => im.canvas.width > 0)
        if (left.length) pics.push(...(await toPictures(left)))
        if (gen !== generation) {
          freePictures(pics)
          return []
        }
        setOf(map, { stage: 'done', done: pics.length, total: pics.length, pictures: pics })
        return pics
      } catch (e) {
        if (gen !== generation || e instanceof Stale) {
          freePictures(pics)
          return []
        }
        setOf(map, { stage: 'error', done: 0, total: 0, pictures: pics, error: (e as Error).message || 'Could not draw the images' })
        return pics
      } finally {
        if (inflight.get(map) === p) inflight.delete(map)
      }
    })
    queue = p
    inflight.set(map, p)
    return p
  }

  $effect(() => {
    const map = active
    if (map && scouts && !stale) untrack(() => ensure(map))
  })

  function team(): string {
    return fileName(teamName, 'team')
  }

  async function zipMap(map: string) {
    zipping = map
    try {
      const pics = await ensure(map)
      if (pics.length) await saveZip([{ pictures: pics }], `${fileName(mapLabel(map), 'map')}-${team()}-scout.zip`)
    } finally {
      zipping = ''
    }
  }

  async function zipAll() {
    if (!scouts) return
    zipping = '*'
    try {
      const all: { folder: string; pictures: Picture[] }[] = []
      for (const m of scouts) {
        const pics = await ensure(m.map)
        if (pics.length) all.push({ folder: fileName(mapLabel(m.map), m.map), pictures: pics })
      }
      if (all.length) await saveZip(all, `${team()}-scout.zip`)
    } finally {
      zipping = ''
    }
  }

  function hide(e: Event) {
    ;(e.currentTarget as HTMLElement).style.visibility = 'hidden'
  }

  const drawnMaps = $derived(Object.values(sets).filter((x) => x.stage === 'done').length)
</script>

<div class="panel">
  <div class="bar">
    <div class="what">
      {#if !s.roster.length}
        <b>Pick a team first</b>
        <span>In step 1 or from a demo in step 2.</span>
      {:else if !s.selected.length}
        <b>No demos selected</b>
        <span>Tick the demos with {s.rosterName || 'this team'} in step 2.</span>
      {:else}
        <b>{s.rosterName || 'Picked players'}</b>
        <span>
          {s.selected.length} {s.selected.length === 1 ? 'demo' : 'demos'} on {new Set(s.selected.map((c) => c.entry.map)).size}
          {new Set(s.selected.map((c) => c.entry.map)).size === 1 ? 'map' : 'maps'}, {s.roster.length} players
        </span>
      {/if}
    </div>
    <label class="early" title="The early CT images and setups use this part of each CT round">
      <span>Early round</span>
      <span class="inp">
        <span class="faint">first</span>
        <input type="number" min="5" max="60" step="5" bind:value={early} disabled={building} aria-label="Early round seconds" />
        <span class="faint">s</span>
      </span>
    </label>
    <button class="btn primary" disabled={!canBuild} onclick={build}>
      <ScoutIcon name={scouts ? 'refresh' : 'map'} size={15} />
      <span>{building ? 'Reading the demos' : scouts ? 'Build again' : 'Build report'}</span>
    </button>
  </div>

  {#if building}
    <div class="progress">
      <span class="pbar"><i style:width="{prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%"></i></span>
      <span class="ptext">
        {#if prog.done < prog.total}
          Reading demo {prog.done + 1} of {prog.total}<span class="faint file">{prog.label}</span>
        {:else}
          Adding it all up
        {/if}
      </span>
    </div>
  {/if}

  {#if error}<p class="err" role="alert">{error}</p>{/if}

  {#if stale && !building}
    <div class="stale">
      <ScoutIcon name="info" size={15} />
      <span>The players or demos changed since this report was built. Build it again to bring it up to date.</span>
    </div>
  {/if}
</div>

{#if scouts && scouts.length}
  <div class="report">
    <div class="tabs-row">
      <div class="tabs" role="tablist" aria-label="Maps">
        {#each scouts as m (m.map)}
          <button class="tab" class:on={active === m.map} role="tab" aria-selected={active === m.map} onclick={() => (active = m.map)}>
            <span class="thumb">
              <span class="ini">{mapLabel(m.map).slice(0, 2)}</span>
              <img src="/api/maps/{m.map}_radar_psd.png" alt="" onerror={hide} />
            </span>
            <span class="tt">
              <b>{mapLabel(m.map)}</b>
              <small>{m.replays.length} {m.replays.length === 1 ? 'match' : 'matches'}, {m.ctRounds + m.tRounds} rounds</small>
            </span>
            {#if sets[m.map]?.stage === 'drawing' || sets[m.map]?.stage === 'saving'}<i class="spin" title="Drawing the images"></i>{/if}
          </button>
        {/each}
      </div>
      <button class="btn" disabled={!!zipping || stale} onclick={zipAll} title="Every image of every map, one folder per map">
        {#if zipping === '*'}<i class="spin"></i>{:else}<ScoutIcon name="download" size={15} />{/if}
        <span>{zipping === '*' ? `Drawing ${drawnMaps} of ${scouts.length} maps` : 'Download everything (zip)'}</span>
      </button>
    </div>
    <p class="sum faint">{scouts.length} {scouts.length === 1 ? 'map' : 'maps'}, {totalRounds} rounds of {teamName || 'the team'}.</p>
    {#if current}
      {#key current}
        <ScoutMapReport scout={current} set={sets[current.map]} {teamName} early={builtEarly} zipping={zipping === current.map || zipping === '*'} onzip={() => zipMap(current.map)} onretry={() => ensure(current.map)} />
      {/key}
    {/if}
  </div>
{/if}

<style>
  .panel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 62px;
    padding: 10px 12px 10px 16px;
    flex-wrap: wrap;
  }

  .what {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
  }

  .what b {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
  }

  .what span {
    color: var(--text-2);
  }

  .early {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .inp {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font);
    font-size: 13px;
    letter-spacing: 0;
    text-transform: none;
  }

  .inp input {
    width: 56px;
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px 0 12px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: #f6636a;
    border-color: #f6636a;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px 14px;
    border-top: 1px solid var(--line);
  }

  .pbar {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .pbar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }

  .ptext {
    display: flex;
    gap: 10px;
    min-width: 0;
    color: var(--text-2);
  }

  .file {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .err {
    margin: 0;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--line);
    color: var(--bad);
  }

  .stale {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 16px;
    border-top: 1px solid var(--line);
    color: var(--evidence);
  }

  .stale span {
    flex: 1;
  }

  .report {
    margin-top: 16px;
  }

  .tabs-row {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    border-bottom: 1px solid var(--line);
  }

  .tabs {
    flex: 1;
    display: flex;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs-row > .btn {
    margin-bottom: 8px;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: 56px;
    padding: 0 14px 0 10px;
    border: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: transparent;
    text-align: left;
    color: var(--text-2);
  }

  .tab:hover {
    background: var(--surface);
  }

  .tab.on {
    background: var(--surface);
    color: var(--text);
  }

  .tab::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: transparent;
  }

  .tab.on::after {
    background: var(--accent);
  }

  .tt {
    display: flex;
    flex-direction: column;
  }

  .tt b {
    font-family: var(--display);
    font-size: 16px;
    font-weight: 700;
    line-height: 1.15;
  }

  .tt small {
    font-size: 12px;
    color: var(--text-3);
  }

  .thumb {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.45);
    filter: saturate(0.85) brightness(0.95);
  }

  .ini {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    color: var(--text-3);
    text-transform: uppercase;
  }

  .sum {
    margin: 10px 0 14px;
  }

  .spin {
    display: inline-block;
    width: 13px;
    height: 13px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 760px) {
    .tabs-row {
      flex-direction: column;
      align-items: stretch;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
