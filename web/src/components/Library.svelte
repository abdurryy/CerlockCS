<script lang="ts">
  import { deleteReplay, fingerprint, getEntry, listLocal, listReplays, parseLocal, upload } from '../lib/api'
  import { ago, bytes, duration, mapLabel, ms } from '../lib/format'
  import type { Entry, Job, LocalDemo } from '../lib/types'
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'

  let replays = $state<Entry[]>([])
  let jobs = $state<Job[]>([])
  let local = $state<LocalDemo[]>([])
  let dirs = $state<string[]>([])
  let loading = $state(true)
  let dragging = $state(false)
  let busy = $state<{ name: string; stage: string; progress: number } | null>(null)
  let error = $state('')
  let input: HTMLInputElement

  const FORMATS = ['.dem', '.dem.gz', '.dem.bz2', '.dem.zst']

  const totals = $derived({
    rounds: replays.reduce((n, c) => n + c.rounds, 0),
    time: replays.reduce((n, c) => n + c.duration, 0),
  })

  async function refresh() {
    try {
      const [r, l] = await Promise.all([listReplays(), listLocal()])
      replays = r.replays ?? []
      jobs = r.jobs ?? []
      local = l.demos ?? []
      dirs = l.dirs ?? []
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  $effect(() => {
    refresh()
    const timer = setInterval(() => {
      if (jobs.length || local.some((d) => d.status === 'queued' || d.status === 'parsing')) refresh()
    }, 1200)
    return () => clearInterval(timer)
  })

  function open(id: string) {
    location.hash = `#/replay/${id}`
  }

  function pick() {
    if (!busy) input.click()
  }

  async function handle(file: File) {
    error = ''
    busy = { name: file.name, stage: 'Checking the file', progress: 0 }
    try {
      const id = await fingerprint(file)
      if (await getEntry(id)) return open(id)
      busy = { name: file.name, stage: 'Reading the demo', progress: 0 }
      const entry = await upload(file, (p) => {
        if (!busy) return
        busy.progress = p
        if (p >= 1) busy.stage = 'Writing up the case'
      })
      open(entry.id)
    } catch (e) {
      error = (e as Error).message
      busy = null
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const file = e.dataTransfer?.files?.[0]
    if (file && !busy) handle(file)
  }

  function onPick() {
    const file = input.files?.[0]
    if (file) handle(file)
    input.value = ''
  }

  async function remove(e: MouseEvent, c: Entry) {
    e.stopPropagation()
    if (!confirm(`Delete the ${mapLabel(c.map)} case? The demo file itself is not touched.`)) return
    await deleteReplay(c.id)
    refresh()
  }

  async function parse(d: LocalDemo) {
    try {
      await parseLocal(d.path)
      d.status = 'queued'
      refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  function pct(p: number): number {
    return Math.round(Math.max(0, Math.min(1, p)) * 100)
  }

  function hideImage(e: Event) {
    ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
  }
</script>

<svelte:head>
  <title>Case files · Cerlock</title>
</svelte:head>

<svelte:window
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false
  }}
  ondrop={onDrop}
/>

<div class="page">
  <header class="top">
    <div class="wrap top-in">
      <a class="brand" href="#/" aria-label="Cerlock, case files"><Logo size={30} full /></a>
      <span class="tag">CS2 demo review</span>
      <span class="spacer"></span>
      <a class="scout" href="#/scout" title="Heatmaps and habits of a team over all their demos">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.5-3.6 3-5.5 6.5-5.5s6 1.9 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18.5 14.8c1.8.7 2.8 2.4 3 5.2" />
        </svg>
        <span>Scout a team</span>
      </a>
      <button class="primary" onclick={pick} disabled={!!busy}>
        <Icon name="upload" size={15} />
        <span>Open a demo</span>
      </button>
    </div>
  </header>

  <main class="wrap">
    <section class="intro">
      <div class="pitch">
        <h1>Every round leaves evidence.</h1>
        <p>
          Drop a CS2 demo and Cerlock reads it in seconds. Every position, grenade and duel goes on the map, and the mistakes
          worth talking about are marked so you can go straight to them.
        </p>
        {#if replays.length}
          <dl class="totals">
            <div><dt>Case files</dt><dd class="num">{replays.length}</dd></div>
            <div><dt>Rounds</dt><dd class="num">{totals.rounds}</dd></div>
            <div><dt>Game time</dt><dd class="num">{duration(totals.time)}</dd></div>
          </dl>
        {/if}
      </div>

      <button class="drop" class:dragging class:busy={!!busy} onclick={pick} aria-label={busy ? busy.stage : 'Choose a demo to open'}>
        <span class="corner tl"></span>
        <span class="corner tr"></span>
        <span class="corner bl"></span>
        <span class="corner br"></span>
        {#if busy}
          <span class="glyph spinning"><i></i></span>
          <span class="call">{busy.stage}</span>
          <span class="file" title={busy.name}>{busy.name}</span>
          <span class="progress">
            <span class="bar"><i style="width: {pct(busy.progress)}%"></i></span>
            <span class="num pct">{pct(busy.progress)}%</span>
          </span>
        {:else}
          <span class="glyph"><Icon name="upload" size={20} /></span>
          <span class="call">{dragging ? 'Let go to open the case' : 'Drop a demo here'}</span>
          <span class="sub">or click to choose a file. Parsing starts while it uploads.</span>
          <span class="formats">
            {#each FORMATS as f (f)}<span>{f}</span>{/each}
          </span>
        {/if}
      </button>
      <input bind:this={input} type="file" accept=".dem,.gz,.bz2,.zst" hidden onchange={onPick} />
    </section>

    {#if error}
      <div class="error" role="alert">
        <span>{error}</span>
        <button class="plain" aria-label="Dismiss" title="Dismiss" onclick={() => (error = '')}><Icon name="x" size={14} /></button>
      </div>
    {/if}

    <section class="block">
      <div class="head">
        <h2>Case files</h2>
        {#if replays.length}<span class="chip num">{replays.length}</span>{/if}
      </div>

      {#if jobs.length}
        <div class="panel jobs">
          {#each jobs as job (job.id)}
            <div class="job">
              {#if job.status === 'error'}
                <span class="glyph small failed"><Icon name="x" size={11} /></span>
              {:else}
                <span class="glyph small spinning"><i></i></span>
              {/if}
              <span class="job-name" title={job.path ?? job.name}>{job.name}</span>
              {#if job.status === 'error'}
                <span class="bad small">{job.error}</span>
              {:else}
                <span class="dim small jstate">{job.status === 'downloading' ? 'Downloading' : job.status === 'queued' ? 'Queued' : 'Reading'}</span>
                <span class="progress">
                  <span class="bar"><i style="width: {pct(job.progress)}%"></i></span>
                  <span class="num pct">{pct(job.progress)}%</span>
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="panel">
        <div class="cols case th" aria-hidden="true">
          <span class="label">Map</span>
          <span class="label">Match</span>
          <span class="label r">Rounds</span>
          <span class="label r hide-md">Length</span>
          <span class="label r hide-md">Demo</span>
          <span class="label r hide-md">Read in</span>
          <span class="label r hide-sm">Added</span>
          <span></span>
        </div>
        {#if loading}
          {#each [0, 1, 2] as i (i)}
            <div class="cols case skeleton"><span class="thumb"></span><span class="line"></span></div>
          {/each}
        {:else if replays.length === 0}
          <div class="empty">
            <Icon name="search" size={20} />
            <span>No cases yet. Drop a demo above to open the first one.</span>
          </div>
        {:else}
          {#each replays as c (c.id)}
            {@const won = c.teams[0].score === c.teams[1].score ? -1 : c.teams[0].score > c.teams[1].score ? 0 : 1}
            <div class="cols case row">
              <span class="map">
                <span class="thumb"><img src="/api/maps/{c.map}_radar_psd.png" alt="" loading="lazy" onerror={hideImage} /></span>
                <span class="map-text">
                  <a class="open" href="#/replay/{c.id}" aria-label="Open {mapLabel(c.map)}, {c.teams[0].name} {c.teams[0].score} to {c.teams[1].score} {c.teams[1].name}">
                    {mapLabel(c.map)}
                  </a>
                  <span class="code">{c.map}</span>
                </span>
              </span>
              <span class="match">
                {#each c.teams as t, i (i)}
                  <span class="side" class:won={won === i} class:lost={won >= 0 && won !== i}>
                    <span class="tname" title={t.name}>{t.name}</span>
                    <b class="num">{t.score}</b>
                  </span>
                {/each}
              </span>
              <span class="num r val">{c.rounds}</span>
              <span class="num r val dim hide-md">{duration(c.duration)}</span>
              <span class="num r val dim hide-md">{bytes(c.demoSize)}</span>
              <span class="num r val dim hide-md">{ms(c.parseMs)}</span>
              <span class="r val dim hide-sm" title={new Date(c.created).toLocaleString()}>{ago(c.created)}</span>
              <span class="r">
                <button class="plain del" title="Delete case" aria-label="Delete the {mapLabel(c.map)} case" onclick={(e) => remove(e, c)}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    {#if dirs.length}
      <section class="block">
        <div class="head">
          <h2>Watched folders</h2>
          <span class="dirs">
            {#each dirs as d (d)}
              <span class="dir" title={d}><Icon name="folder" size={13} /><span>{d}</span></span>
            {/each}
          </span>
        </div>
        <div class="panel">
          {#if local.length === 0}
            <div class="empty">
              <Icon name="folder" size={20} />
              <span>No demos found. New .dem files in these folders show up here.</span>
            </div>
          {:else}
            {#each local as d (d.path)}
              <div class="demo">
                <span class="dname" title={d.path}>{d.name}</span>
                <span class="num dim small r">{bytes(d.size)}</span>
                <span class="dim small r hide-sm" title={new Date(d.modified).toLocaleString()}>{ago(d.modified)}</span>
                <span class="status">
                  {#if d.status === 'ready'}
                    <span class="state good">Ready</span>
                    <button class="small-btn" onclick={() => open(d.id)}>Open</button>
                  {:else if d.status === 'parsing' || d.status === 'queued'}
                    {#if d.status === 'queued'}
                      <span class="state">Queued</span>
                    {:else}
                      <span class="progress tight">
                        <span class="bar"><i style="width: {pct(d.progress)}%"></i></span>
                        <span class="num pct">{pct(d.progress)}%</span>
                      </span>
                    {/if}
                  {:else if d.status === 'error'}
                    <span class="state bad" title={d.error}>Failed</span>
                    <button class="small-btn" onclick={() => parse(d)}>Retry</button>
                  {:else}
                    <span class="state">Not read</span>
                    <button class="small-btn" onclick={() => parse(d)}>Read</button>
                  {/if}
                </span>
              </div>
            {/each}
          {/if}
        </div>
      </section>
    {/if}
  </main>

  {#if dragging && !busy}
    <div class="drag-veil" aria-hidden="true">
      <span class="corner tl"></span>
      <span class="corner tr"></span>
      <span class="corner bl"></span>
      <span class="corner br"></span>
      <span class="veil-text">Drop the demo to open a new case</span>
    </div>
  {/if}
</div>

<style>
  .page {
    min-height: 100%;
    background: var(--bg);
  }

  .wrap {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 32px;
  }

  /* Top bar */

  .top {
    position: sticky;
    top: 0;
    z-index: 5;
    border-bottom: 1px solid var(--line);
    background: rgba(11, 13, 17, 0.92);
    backdrop-filter: blur(8px);
  }

  .top-in {
    height: 60px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .brand {
    display: inline-flex;
    text-decoration: none;
  }

  .tag {
    padding-left: 16px;
    border-left: 1px solid var(--line-2);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-3);
    line-height: 20px;
  }

  .spacer {
    flex: 1;
  }

  .scout {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px 0 12px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-decoration: none;
    transition: background 0.12s, border-color 0.12s;
  }

  .scout:hover {
    background: var(--surface-3);
    border-color: #414a55;
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
    letter-spacing: 0.01em;
  }

  .primary:hover {
    background: #f6636a;
    border-color: #f6636a;
  }

  /* Intro */

  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 48px;
    align-items: center;
    padding: 64px 0 56px;
  }

  h1 {
    font-size: 50px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.012em;
    text-wrap: balance;
  }

  .pitch p {
    margin: 18px 0 0;
    max-width: 470px;
    color: var(--text-2);
    font-size: 15.5px;
    line-height: 1.55;
  }

  .totals {
    display: flex;
    gap: 36px;
    margin: 32px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .totals dt {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .totals dd {
    margin: 4px 0 0;
    font-family: var(--display);
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }

  /* Drop zone, framed like a scope */

  .drop {
    position: relative;
    width: 100%;
    min-height: 236px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background:
      radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.025), transparent 60%),
      var(--surface);
    text-align: center;
    font-weight: 400;
  }

  .drop:hover {
    background:
      radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.035), transparent 60%),
      var(--surface);
    border-color: var(--line-2);
  }

  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .drop.busy {
    cursor: default;
  }

  .corner {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 0 solid var(--text-3);
    transition: border-color 0.15s, transform 0.15s;
    pointer-events: none;
  }

  .corner.tl {
    top: 10px;
    left: 10px;
    border-top-width: 2px;
    border-left-width: 2px;
  }

  .corner.tr {
    top: 10px;
    right: 10px;
    border-top-width: 2px;
    border-right-width: 2px;
  }

  .corner.bl {
    bottom: 10px;
    left: 10px;
    border-bottom-width: 2px;
    border-left-width: 2px;
  }

  .corner.br {
    bottom: 10px;
    right: 10px;
    border-bottom-width: 2px;
    border-right-width: 2px;
  }

  .drop:hover .corner {
    border-color: var(--text-2);
  }

  .drop.dragging .corner,
  .drop.busy .corner {
    border-color: var(--accent);
  }

  .drop:hover:not(.busy) .tl {
    transform: translate(-2px, -2px);
  }

  .drop:hover:not(.busy) .tr {
    transform: translate(2px, -2px);
  }

  .drop:hover:not(.busy) .bl {
    transform: translate(-2px, 2px);
  }

  .drop:hover:not(.busy) .br {
    transform: translate(2px, 2px);
  }

  .glyph {
    width: 44px;
    height: 44px;
    margin-bottom: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    position: relative;
  }

  .drop.dragging .glyph {
    border-color: var(--accent);
    color: var(--accent);
  }

  .glyph i {
    display: none;
  }

  .glyph.spinning {
    border-color: var(--line-2);
  }

  .glyph.spinning i {
    display: block;
    position: absolute;
    inset: -1px;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  .glyph.spinning::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .glyph.small {
    width: 18px;
    height: 18px;
    margin: 0;
    flex: none;
    background: transparent;
  }

  .glyph.small.failed {
    border-color: rgba(255, 100, 100, 0.45);
    color: var(--bad);
  }

  .glyph.small.spinning::after {
    width: 4px;
    height: 4px;
  }

  .call {
    font-family: var(--display);
    font-size: 21px;
    font-weight: 700;
    color: var(--text);
  }

  .sub {
    color: var(--text-2);
    font-size: 13.5px;
  }

  .formats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 14px;
  }

  .formats span {
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 500;
  }

  .file {
    max-width: 100%;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(340px, 100%);
    margin-top: 12px;
  }

  .progress.tight {
    width: 150px;
    margin: 0;
  }

  .bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
    display: block;
  }

  .bar i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.2s;
  }

  .pct {
    width: 34px;
    text-align: right;
    font-size: 12px;
    color: var(--text-2);
  }

  .error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
    padding: 8px 8px 8px 14px;
    border: 1px solid rgba(255, 100, 100, 0.35);
    border-radius: var(--radius);
    background: rgba(255, 100, 100, 0.08);
    color: var(--bad);
  }

  .error button {
    color: var(--bad);
    width: 26px;
    height: 26px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Sections */

  .block {
    margin-bottom: 48px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    min-width: 0;
  }

  h2 {
    font-size: 18px;
    font-weight: 700;
    flex: none;
  }

  .chip {
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
  }

  .panel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .panel.jobs {
    margin-bottom: 12px;
  }

  .small {
    font-size: 12.5px;
  }

  .r {
    text-align: right;
    justify-self: end;
  }

  /* Case rows */

  .cols {
    display: grid;
    grid-template-columns: minmax(170px, 1fr) minmax(220px, 1.5fr) 64px 76px 84px 72px 92px 36px;
    gap: 16px;
    align-items: center;
    padding: 0 12px 0 14px;
  }

  .th {
    height: 36px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  .row {
    position: relative;
    min-height: 68px;
    border-bottom: 1px solid var(--line);
    transition: background 0.12s;
  }

  .row:last-child {
    border-bottom: none;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: transparent;
    transition: background 0.12s;
  }

  .row:hover::before {
    background: var(--accent);
  }

  .map {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .thumb {
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.45);
    filter: saturate(0.85) brightness(0.95);
    transition: transform 0.25s;
  }

  .row:hover .thumb img {
    transform: scale(1.6);
  }

  .map-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .open {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--text);
    text-decoration: none;
  }

  /* The link covers the whole row, the delete button sits above it. */
  .open::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .open:focus-visible {
    outline: none;
  }

  .row:has(.open:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .code {
    font-size: 12px;
    color: var(--text-3);
  }

  /* Names in one column, scores right next to the longest name. */
  .match {
    display: grid;
    grid-template-columns: minmax(0, max-content) auto;
    justify-content: start;
    align-items: baseline;
    column-gap: 12px;
    row-gap: 2px;
    min-width: 0;
  }

  .side {
    display: contents;
    color: var(--text-2);
  }

  .tname {
    min-width: 0;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .side b {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    color: var(--text-2);
    text-align: right;
  }

  .side.won .tname,
  .side.won b {
    color: var(--text);
  }

  .side.lost .tname {
    color: var(--text-3);
  }

  .side.lost b {
    color: var(--text-3);
  }

  .val {
    font-size: 13px;
    white-space: nowrap;
  }

  .del {
    position: relative;
    z-index: 1;
    width: 30px;
    height: 30px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    opacity: 0;
  }

  .row:hover .del,
  .del:focus-visible {
    opacity: 1;
  }

  .del:hover {
    color: var(--bad);
    background: rgba(255, 100, 100, 0.1);
  }

  .skeleton {
    height: 68px;
    border-bottom: 1px solid var(--line);
    grid-template-columns: 44px 1fr;
  }

  .skeleton:last-child {
    border-bottom: none;
  }

  .skeleton .thumb,
  .skeleton .line {
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    box-shadow: none;
  }

  .skeleton .line {
    width: 40%;
    height: 12px;
    border-radius: 3px;
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 24px 18px;
    color: var(--text-2);
  }

  .empty :global(.icon) {
    color: var(--text-3);
  }

  /* Jobs */

  .job {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .job:last-child {
    border-bottom: none;
  }

  .job-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .job .progress {
    width: 240px;
    margin: 0;
  }

  .jstate {
    font-family: var(--display);
    font-weight: 600;
  }

  /* Watched folders */

  .dirs {
    display: flex;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .dir {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 520px;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    color: var(--text-3);
    font-size: 12px;
  }

  .dir span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }

  .demo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 84px 92px 200px;
    gap: 16px;
    align-items: center;
    min-height: 46px;
    padding: 0 12px 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .demo:last-child {
    border-bottom: none;
  }

  .demo:hover {
    background: var(--surface-2);
  }

  .dname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .status {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    align-items: center;
  }

  .state {
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-3);
  }

  .state.good {
    color: var(--good);
  }

  .state.bad {
    color: var(--bad);
  }

  .small-btn {
    height: 28px;
    min-width: 64px;
    padding: 0 12px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
  }

  /* Drag veil */

  .drag-veil {
    position: fixed;
    inset: 12px;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    background: rgba(11, 13, 17, 0.72);
    pointer-events: none;
  }

  .drag-veil .corner {
    width: 28px;
    height: 28px;
    border-color: var(--accent);
  }

  .drag-veil .corner.tl,
  .drag-veil .corner.tr {
    top: 0;
  }

  .drag-veil .corner.bl,
  .drag-veil .corner.br {
    bottom: 0;
  }

  .drag-veil .corner.tl,
  .drag-veil .corner.bl {
    left: 0;
  }

  .drag-veil .corner.tr,
  .drag-veil .corner.br {
    right: 0;
  }

  .veil-text {
    font-family: var(--display);
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @media (max-width: 960px) {
    .intro {
      grid-template-columns: minmax(0, 1fr);
      gap: 32px;
      padding: 40px 0;
    }

    .cols {
      grid-template-columns: minmax(150px, 1fr) minmax(180px, 1.4fr) 56px 80px 36px;
    }

    .hide-md {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .wrap {
      padding: 0 16px;
    }

    .tag {
      display: none;
    }

    .scout span {
      display: none;
    }

    .scout {
      padding: 0 9px;
    }

    h1 {
      font-size: 36px;
    }

    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px;
      gap: 12px;
    }

    .cols > .r:not(:last-child),
    .hide-sm {
      display: none;
    }

    .demo {
      grid-template-columns: minmax(0, 1fr) 70px 150px;
    }

    .del {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .glyph.spinning i,
    .skeleton .thumb,
    .skeleton .line {
      animation: none;
    }
  }
</style>
