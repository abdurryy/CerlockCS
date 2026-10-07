<script lang="ts">
  import { ago, bytes, mapLabel } from '../lib/format'
  import { loadReplay } from '../lib/replay'
  import type { Job } from '../lib/types'
  import Icon from './Icon.svelte'
  import ScoutIcon from './ScoutIcon.svelte'
  import type { ManualRoster, ScoutState } from './ScoutPage.svelte'

  // Step 2: the demos the report reads. New demos come in through the drop
  // zone, the library entries with enough of the roster are listed.
  let { s }: { s: ScoutState } = $props()

  let input: HTMLInputElement
  let over = $state(false)
  let pickId = $state('')
  let picking = $state(false)
  let pickError = $state('')
  let options = $state.raw<ManualRoster[]>([])
  let pickTeam = $state(-1)
  let showPicker = $state(false)

  const FORMATS = ['.dem', '.dem.gz', '.dem.bz2', '.dem.zst']

  const rosterIds = $derived(new Set(s.roster.map((p) => p.steamId)))
  const allOn = $derived(s.candidates.length > 0 && s.candidates.every((c) => !s.excluded.includes(c.entry.id)))
  const mapsSelected = $derived(new Set(s.selected.map((c) => c.entry.map)).size)
  const openPicker = $derived(showPicker || (!s.roster.length && s.loaded))

  // Server jobs that are not one of our own uploads, which show already.
  const otherJobs = $derived(
    s.jobs.filter((j) => !s.uploads.some((u) => u.name === j.name && (u.stage === 'uploading' || u.stage === 'reading')) && !j.id.startsWith('faceit-')),
  )
  const downloads = $derived(s.jobs.filter((j) => j.id.startsWith('faceit-')))

  function pick() {
    input.click()
  }

  function onPick() {
    const files = Array.from(input.files ?? [])
    if (files.length) s.addFiles(files)
    input.value = ''
  }

  // The page takes the files from any drop, this only lights up the zone.
  function onDrop() {
    over = false
  }

  async function choose() {
    pickError = ''
    options = []
    pickTeam = -1
    if (!pickId) return
    picking = true
    const id = pickId
    try {
      const r = await loadReplay(id)
      if (id !== pickId) return
      options = [0, 1].map((t) => ({
        replayId: id,
        team: t,
        name: r.teamName(t),
        map: r.match.map,
        players: r.teamPlayers[t]
          .map((p) => r.match.players[p])
          .filter((p) => p && !p.isBot && p.steamId && p.steamId !== '0')
          .map((p) => ({ steamId: p.steamId, name: p.name })),
      }))
    } catch (e) {
      pickError = (e as Error).message
    } finally {
      picking = false
    }
  }

  function useTeam() {
    const m = options[pickTeam]
    if (!m) return
    s.useManual(m)
    showPicker = false
  }

  function toggle(id: string) {
    s.excluded = s.excluded.includes(id) ? s.excluded.filter((x) => x !== id) : [...s.excluded, id]
  }

  function toggleAll() {
    s.excluded = allOn ? s.candidates.map((c) => c.entry.id) : []
  }

  // After an upload, say whether the team is in that demo at all.
  function fit(id: string | undefined): string {
    if (!id || !s.roster.length) return ''
    const e = s.replays.find((x) => x.id === id)
    if (!e) return ''
    const n = new Set((e.steamIds ?? []).filter((x) => rosterIds.has(x))).size
    if (n >= Math.min(3, s.roster.length)) return ''
    return n ? `only ${n} of ${s.rosterName || 'them'} in it` : `none of ${s.rosterName || 'them'} in it`
  }

  function pct(p: number): number {
    return Math.round(Math.max(0, Math.min(1, p)) * 100)
  }

  // A download waits its turn, a demo on disk is read right away.
  function jobLabel(j: Job): string {
    if (j.status === 'downloading') return 'Downloading'
    if (j.status === 'error') return 'Failed'
    if (j.status === 'queued' && j.id.startsWith('faceit-')) return 'Queued'
    return 'Reading'
  }

  function hide(e: Event) {
    ;(e.currentTarget as HTMLElement).style.visibility = 'hidden'
  }

  const STAGE: Record<string, string> = {
    waiting: 'Waiting',
    checking: 'Checking the file',
    uploading: 'Reading the demo',
    reading: 'Writing up the case',
    done: 'Added',
    known: 'Already in your case files',
    error: 'Failed',
  }
</script>

<div class="roster" class:none={!s.roster.length}>
  {#if s.roster.length}
    <span class="who">
      <span class="label">Scouting</span>
      <b title={s.rosterName}>{s.rosterName || 'Picked players'}</b>
      <span class="src">{s.source === 'replay' ? `From a demo on ${mapLabel(s.manual?.map ?? '')}` : 'From FACEIT'}</span>
    </span>
    <span class="names">
      {#each s.roster as p (p.steamId)}<span class="pchip">{p.name}</span>{/each}
    </span>
    <span class="grow"></span>
    {#if s.source === 'replay' && s.team}
      <button class="btn small" onclick={() => (s.source = 'faceit')}>Use {s.team.name}</button>
    {/if}
    <button class="btn small plain" onclick={() => (showPicker = !showPicker)}>{showPicker ? 'Close' : 'Pick from a demo'}</button>
  {:else}
    <ScoutIcon name="users" size={17} />
    <span>Pick the team in step 1, or pick it from one of their demos here.</span>
  {/if}
</div>

<div class="grid">
  <button
    class="drop"
    class:over
    onclick={pick}
    ondragover={(e) => {
      e.preventDefault()
      over = true
    }}
    ondragleave={() => (over = false)}
    ondrop={onDrop}
    aria-label="Choose demos to add"
  >
    <span class="corner tl"></span>
    <span class="corner tr"></span>
    <span class="corner bl"></span>
    <span class="corner br"></span>
    <span class="glyph"><Icon name="upload" size={18} /></span>
    <span class="call">{over ? 'Let go to add them' : 'Drop their demos here'}</span>
    <span class="sub">FACEIT demos straight from the room, several at once. Or click to choose files.</span>
    <span class="formats">{#each FORMATS as f (f)}<span>{f}</span>{/each}</span>
  </button>
  <input bind:this={input} type="file" accept=".dem,.gz,.bz2,.zst" multiple hidden onchange={onPick} />

  {#if openPicker}
    <div class="picker">
      <div class="phead">
        <b>No FACEIT? Pick the team from a demo</b>
        <span>Choose a demo they played, then their side of it.</span>
      </div>
      <div class="prow">
        <select bind:value={pickId} onchange={choose} aria-label="Demo">
          <option value="">Choose a demo</option>
          {#each s.replays as e (e.id)}
            <option value={e.id}>{mapLabel(e.map)}: {e.teams[0].name} {e.teams[0].score} - {e.teams[1].score} {e.teams[1].name}</option>
          {/each}
        </select>
      </div>
      {#if picking}
        <p class="faint pnote"><i class="spin"></i>Reading the demo</p>
      {:else if pickError}
        <p class="bad pnote">{pickError}</p>
      {:else if options.length}
        <div class="sides">
          {#each options as o, i (i)}
            <button class="side" class:on={pickTeam === i} aria-pressed={pickTeam === i} onclick={() => (pickTeam = i)}>
              <b title={o.name}>{o.name}</b>
              <span>{o.players.map((p) => p.name).join(', ') || 'No players'}</span>
            </button>
          {/each}
        </div>
        <div class="pfoot">
          <button class="btn primary small" disabled={pickTeam < 0 || !options[pickTeam]?.players.length} onclick={useTeam}>Scout this team</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="picker tips">
      <div class="phead">
        <b>Getting the demos</b>
      </div>
      <ol>
        <li>Open a match room from step 1.</li>
        <li>Click <span class="kbd">Watch demo</span> to download it.</li>
        <li>Drop the files here. No need to unzip them.</li>
      </ol>
    </div>
  {/if}
</div>

{#if s.uploads.length || otherJobs.length || downloads.length}
  <div class="activity">
    {#each s.uploads as u (u.key)}
      {@const live = u.stage === 'uploading' || u.stage === 'reading' || u.stage === 'checking' || u.stage === 'waiting'}
      {@const miss = u.stage === 'done' || u.stage === 'known' ? fit(u.id) : ''}
      <div class="act">
        {#if u.stage === 'error'}
          <span class="mk bad"><Icon name="x" size={11} /></span>
        {:else if live}
          <span class="mk"><i class="spin"></i></span>
        {:else}
          <span class="mk good"><Icon name="check" size={11} /></span>
        {/if}
        <span class="aname" title={u.name}>{u.name}</span>
        {#if u.stage === 'uploading' || u.stage === 'reading'}
          <span class="aprog"><span class="bar"><i style:width="{pct(u.progress)}%"></i></span><span class="num pct">{pct(u.progress)}%</span></span>
        {/if}
        <span class="astage" class:bad={u.stage === 'error'} class:warn={!!miss} title={u.error ?? miss}>
          {u.stage === 'error' ? (u.error ?? STAGE.error) : miss ? `${STAGE[u.stage]}, ${miss}` : STAGE[u.stage]}
        </span>
      </div>
    {/each}
    {#each [...downloads, ...otherJobs] as j (j.id)}
      <div class="act">
        {#if j.status === 'error'}
          <span class="mk bad"><Icon name="x" size={11} /></span>
        {:else}
          <span class="mk"><i class="spin"></i></span>
        {/if}
        <span class="aname" title={j.path ?? j.name}>{j.name}</span>
        {#if j.status !== 'error' && jobLabel(j) !== 'Queued'}
          <span class="aprog">
            <span class="bar" class:sweep={!(j.progress > 0)}><i style:width="{pct(j.progress)}%"></i></span>
            <span class="num pct">{j.progress > 0 ? `${pct(j.progress)}%` : ''}</span>
          </span>
        {/if}
        <span class="astage" class:bad={j.status === 'error'} title={j.error}>{j.status === 'error' ? (j.error ?? 'Failed') : jobLabel(j)}</span>
      </div>
    {/each}
    {#if !s.uploading && s.uploads.some((u) => !(u.stage === 'waiting' || u.stage === 'checking' || u.stage === 'uploading' || u.stage === 'reading'))}
      <div class="act clear"><button class="btn small plain" onclick={() => s.clearUploads()}>Clear finished</button></div>
    {/if}
  </div>
{/if}

<div class="list">
  <div class="lhead">
    {#if s.candidates.length}
      <label class="all">
        <input type="checkbox" checked={allOn} indeterminate={!allOn && s.selected.length > 0} onchange={toggleAll} />
        <span>Demos with this team</span>
      </label>
      <span class="faint">{s.selected.length} of {s.candidates.length} selected, {mapsSelected} {mapsSelected === 1 ? 'map' : 'maps'}</span>
    {:else}
      <span class="ltitle">Demos with this team</span>
    {/if}
  </div>
  {#each s.candidates as c (c.entry.id)}
    {@const e = c.entry}
    {@const on = !s.excluded.includes(e.id)}
    <label class="demo" class:off={!on}>
      <input type="checkbox" checked={on} onchange={() => toggle(e.id)} />
      <span class="thumb">
        <span class="ini">{mapLabel(e.map).slice(0, 2)}</span>
        <img src="/api/maps/{e.map}_radar_psd.png" alt="" loading="lazy" onerror={hide} />
      </span>
      <span class="dmap">
        <b>{mapLabel(e.map)}</b>
        <small title={e.name}>{e.name}</small>
      </span>
      <span class="dteams">
        <span class="tn" title={e.teams[0].name}>{e.teams[0].name}</span>
        <b class="num">{e.teams[0].score} - {e.teams[1].score}</b>
        <span class="tn" title={e.teams[1].name}>{e.teams[1].name}</span>
      </span>
      <span class="dcount" title={(e.players ?? []).filter((_, i) => rosterIds.has(e.steamIds?.[i] ?? '')).join(', ')}>
        <b class="num">{c.count}</b> of {s.roster.length}
      </span>
      <span class="dmeta faint">{e.rounds} rounds · {bytes(e.demoSize)}</span>
      <span class="dmeta faint r" title={new Date(e.created).toLocaleString()}>{ago(e.created)}</span>
      <a class="openr" href="#/replay/{e.id}" title="Open this demo" onclick={(ev) => ev.stopPropagation()}><ScoutIcon name="play" size={12} /></a>
    </label>
  {:else}
    <div class="empty">
      {#if !s.roster.length}
        <span>Once you pick a team, every demo in your case files with at least three of them shows up here.</span>
      {:else if !s.loaded}
        <span>Looking through your case files...</span>
      {:else}
        <span>None of your case files have three or more of these players yet. Add their demos above.</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .roster {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 54px;
    padding: 9px 12px 9px 16px;
    margin-bottom: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    min-width: 0;
    flex-wrap: wrap;
  }

  .roster.none {
    color: var(--text-2);
    gap: 10px;
  }

  .roster.none :global(.icon) {
    color: var(--text-3);
  }

  .who {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .who b {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    max-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .src {
    font-size: 12.5px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .pchip {
    height: 24px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grow {
    flex: 1;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .btn.small {
    height: 30px;
    padding: 0 12px;
    font-size: 13px;
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

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 12px;
  }

  /* Drop zone, framed like the one on the case files page. */

  .drop {
    position: relative;
    min-height: 176px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 22px 28px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background:
      radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.025), transparent 60%),
      var(--surface);
    text-align: center;
    font-weight: 400;
  }

  .drop:hover {
    border-color: var(--line-2);
    background:
      radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.035), transparent 60%),
      var(--surface);
  }

  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .corner {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 0 solid var(--text-3);
    transition: border-color 0.15s, transform 0.15s;
    pointer-events: none;
  }

  .corner.tl {
    top: 9px;
    left: 9px;
    border-top-width: 2px;
    border-left-width: 2px;
  }

  .corner.tr {
    top: 9px;
    right: 9px;
    border-top-width: 2px;
    border-right-width: 2px;
  }

  .corner.bl {
    bottom: 9px;
    left: 9px;
    border-bottom-width: 2px;
    border-left-width: 2px;
  }

  .corner.br {
    bottom: 9px;
    right: 9px;
    border-bottom-width: 2px;
    border-right-width: 2px;
  }

  .drop:hover .corner {
    border-color: var(--text-2);
  }

  .drop.over .corner {
    border-color: var(--accent);
  }

  .glyph {
    width: 38px;
    height: 38px;
    margin-bottom: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }

  .call {
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
  }

  .sub {
    color: var(--text-2);
  }

  .formats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 10px;
  }

  .formats span {
    padding: 1px 7px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text-3);
    font-size: 12px;
  }

  /* Team from a demo */

  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    min-width: 0;
  }

  .phead {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .phead b {
    font-family: var(--display);
    font-size: 15.5px;
    font-weight: 700;
  }

  .phead span {
    color: var(--text-2);
  }

  .prow select {
    width: 100%;
    height: 36px;
    padding: 0 10px;
  }

  .pnote {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    padding: 8px 10px;
    text-align: left;
    background: var(--bg);
    border-color: var(--line);
  }

  .side.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .side b {
    max-width: 100%;
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .side span {
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.35;
  }

  .pfoot {
    display: flex;
    justify-content: flex-end;
  }

  .tips ol {
    margin: 0;
    padding-left: 20px;
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .kbd {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--surface-3);
    border: 1px solid var(--line-2);
    color: var(--text);
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
  }

  /* Uploads and downloads */

  .activity {
    margin-top: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .act {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 42px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .act:last-child {
    border-bottom: none;
  }

  .act.clear {
    justify-content: flex-end;
    min-height: 38px;
    padding: 0 6px;
  }

  .mk {
    width: 18px;
    height: 18px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .mk.good {
    background: rgba(60, 203, 138, 0.16);
    color: var(--good);
  }

  .mk.bad {
    background: rgba(255, 100, 100, 0.14);
    color: var(--bad);
  }

  .aname {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .aprog {
    width: 200px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .bar {
    flex: 1;
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s;
  }

  .bar.sweep {
    position: relative;
  }

  .bar.sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1.2s ease-in-out infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  .pct {
    width: 34px;
    text-align: right;
    font-size: 12px;
    color: var(--text-2);
  }

  .astage.warn {
    color: var(--warn);
  }

  .astage {
    width: 320px;
    flex: none;
    text-align: right;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spin {
    display: inline-block;
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  /* Demo list */

  .list {
    margin-top: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .lhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 42px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .all {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .all span,
  .ltitle {
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 700;
  }

  input[type='checkbox'] {
    width: 15px;
    height: 15px;
    margin: 0;
    flex: none;
    accent-color: var(--accent);
  }

  .demo {
    display: grid;
    grid-template-columns: 15px 38px minmax(110px, 1fr) minmax(180px, 1.4fr) 64px 132px 80px 28px;
    gap: 12px;
    align-items: center;
    min-height: 58px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
  }

  .demo:last-child {
    border-bottom: none;
  }

  .demo:hover {
    background: var(--surface-2);
  }

  .demo.off > :not(input) {
    opacity: 0.45;
  }

  .thumb {
    position: relative;
    width: 38px;
    height: 38px;
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

  .dmap {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .dmap b {
    font-family: var(--display);
    font-size: 15.5px;
    font-weight: 700;
    line-height: 1.2;
  }

  small {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dteams {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
  }

  .tn {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dteams b {
    flex: none;
    color: var(--text);
    font-weight: 700;
  }

  .dcount {
    color: var(--text-3);
    white-space: nowrap;
  }

  .dcount b {
    font-family: var(--display);
    font-size: 15px;
    color: var(--text);
  }

  .dmeta {
    font-size: 12.5px;
    white-space: nowrap;
  }

  .r {
    text-align: right;
  }

  .openr {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .openr:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  .empty {
    padding: 20px 16px;
    color: var(--text-2);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 1000px) {
    .demo {
      grid-template-columns: 15px 38px minmax(100px, 1fr) minmax(150px, 1.4fr) 64px 28px;
    }

    .dmeta {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .demo {
      grid-template-columns: 15px 38px minmax(0, 1fr) 56px 28px;
    }

    .dteams {
      display: none;
    }

    .aprog,
    .astage {
      width: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin,
    .bar.sweep::after {
      animation: none;
    }
  }
</style>
