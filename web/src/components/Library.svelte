<script lang="ts">
  import { deleteReplay, fingerprint, getEntry, listLocal, listReplays, parseLocal, upload } from '../lib/api'
  import { ago, bytes, duration, mapLabel, ms } from '../lib/format'
  import type { Entry, Job, LocalDemo } from '../lib/types'
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
    if (file) handle(file)
  }

  function onPick() {
    const file = input.files?.[0]
    if (file) handle(file)
    input.value = ''
  }

  async function remove(e: MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Delete this case? The demo file itself is not touched.')) return
    await deleteReplay(id)
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
</script>

<svelte:window ondragover={(e) => { e.preventDefault(); dragging = true }} ondragleave={(e) => { if (!e.relatedTarget) dragging = false }} ondrop={onDrop} />

<main>
  <header>
    <Logo size={30} word />
    <span class="label">CS2 demo review</span>
  </header>

  <section class="hero">
    <h1>Every round leaves evidence.</h1>
    <p>
      Drop a CS2 demo and Cerlock reads it in seconds. Every position, grenade and duel goes on the map, and the mistakes worth
      talking about are marked so you can go straight to them.
    </p>
  </section>

  <button class="drop" class:dragging class:busy={!!busy} onclick={() => !busy && input.click()}>
    {#if busy}
      <span class="label">{busy.stage}</span>
      <span class="file">{busy.name}</span>
      <span class="bar"><i style="width: {Math.round(busy.progress * 100)}%"></i></span>
      <span class="mono pct">{Math.round(busy.progress * 100)}%</span>
    {:else}
      <span class="label">Open a new case</span>
      <span class="call">Drop a demo here, or click to choose one</span>
      <span class="faint small">.dem, .dem.gz, .dem.bz2 or .dem.zst. Parsing starts while it uploads.</span>
    {/if}
  </button>
  <input bind:this={input} type="file" accept=".dem,.gz,.bz2,.zst" hidden onchange={onPick} />

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if jobs.length}
    <section>
      <div class="section-head"><span class="label">Being read</span></div>
      {#each jobs as job (job.id)}
        <div class="job">
          <span>{job.name}</span>
          {#if job.status === 'error'}
            <span class="bad">{job.error}</span>
          {:else}
            <span class="bar small"><i style="width: {Math.round(job.progress * 100)}%"></i></span>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  <section>
    <div class="section-head">
      <span class="label">Case files</span>
      <span class="faint mono small">{replays.length}</span>
    </div>
    {#if loading}
      <p class="dim">Loading...</p>
    {:else if replays.length === 0}
      <p class="dim">No cases yet. Drop a demo above to open the first one.</p>
    {:else}
      <div class="cases">
        {#each replays as c, i (c.id)}
          <div class="case" role="button" tabindex="0" onclick={() => open(c.id)} onkeydown={(e) => e.key === 'Enter' && open(c.id)}>
            <span class="no mono">{String(replays.length - i).padStart(3, '0')}</span>
            <span class="thumb">
              <img src="/api/maps/{c.map}_radar_psd.png" alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
            </span>
            <span class="what">
              <span class="map">{mapLabel(c.map)}</span>
              <span class="teams">{c.teams[0].name} <b class="mono">{c.teams[0].score} : {c.teams[1].score}</b> {c.teams[1].name}</span>
            </span>
            <span class="meta mono">
              <span>{c.rounds} rds · {duration(c.duration)}</span>
              <span class="faint">{bytes(c.demoSize)} read in {ms(c.parseMs)}</span>
            </span>
            <span class="when faint">{ago(c.created)}</span>
            <button class="plain del" title="Delete case" onclick={(e) => remove(e, c.id)}>delete</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if dirs.length}
    <section>
      <div class="section-head">
        <span class="label">Watched folders</span>
        <span class="faint small">{dirs.join(', ')}</span>
      </div>
      {#if local.length === 0}
        <p class="dim">No demos found.</p>
      {:else}
        {#each local as d (d.path)}
          <div class="demo">
            <span class="name" title={d.path}>{d.name}</span>
            <span class="mono faint small">{bytes(d.size)}</span>
            <span class="faint small">{ago(d.modified)}</span>
            <span class="status">
              {#if d.status === 'ready'}
                <button onclick={() => open(d.id)}>open</button>
              {:else if d.status === 'parsing' || d.status === 'queued'}
                <span class="bar small"><i style="width: {Math.round(d.progress * 100)}%"></i></span>
              {:else if d.status === 'error'}
                <span class="bad small" title={d.error}>failed</span>
                <button onclick={() => parse(d)}>retry</button>
              {:else}
                <button onclick={() => parse(d)}>read</button>
              {/if}
            </span>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 1040px;
    margin: 0 auto;
    padding: 28px 28px 80px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--rule);
  }

  .hero {
    padding: 56px 0 30px;
    max-width: 680px;
  }

  h1 {
    font-size: 52px;
    line-height: 1.02;
    font-weight: 500;
    letter-spacing: -0.02em;
    font-variation-settings: 'opsz' 144;
  }

  .hero p {
    color: var(--graphite);
    font-size: 15px;
    line-height: 1.55;
    margin: 18px 0 0;
  }

  .drop {
    width: 100%;
    min-height: 150px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 8px;
    padding: 26px 30px;
    border: 1px dashed #4a4f57;
    border-radius: 3px;
    background: repeating-linear-gradient(135deg, rgba(236, 230, 218, 0.015) 0 10px, transparent 10px 20px), var(--desk);
    text-align: left;
  }

  .drop:hover,
  .drop.dragging {
    border-color: var(--paper);
    background: var(--desk-2);
  }

  .drop.busy {
    cursor: default;
  }

  .call {
    font-family: var(--serif);
    font-size: 24px;
    font-weight: 500;
    color: var(--paper);
  }

  .file {
    font-family: var(--serif);
    font-size: 20px;
  }

  .small {
    font-size: 12px;
  }

  .bar {
    width: min(460px, 100%);
    height: 3px;
    background: var(--rule-2);
    display: block;
  }

  .bar.small {
    width: 140px;
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--marker);
    transition: width 0.2s;
  }

  .pct {
    font-size: 12px;
    color: var(--graphite);
  }

  .error {
    color: var(--marker);
    border-left: 2px solid var(--marker);
    padding: 4px 10px;
  }

  section {
    margin-top: 44px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }

  .job {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
  }

  .case {
    display: grid;
    grid-template-columns: 40px 46px minmax(0, 1fr) 190px 90px 60px;
    gap: 16px;
    align-items: center;
    padding: 12px 6px;
    border-bottom: 1px solid var(--rule);
    cursor: pointer;
  }

  .case:hover {
    background: var(--desk);
  }

  .no {
    font-size: 11px;
    color: var(--pencil);
  }

  .thumb {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--desk-3);
    box-shadow: inset 0 0 0 1px var(--rule-2);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.5);
    filter: saturate(0.7) sepia(0.15) brightness(0.85);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .map {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 18px;
  }

  .teams {
    color: var(--graphite);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .teams b {
    color: var(--paper);
    font-weight: 500;
    margin: 0 4px;
  }

  .meta {
    display: flex;
    flex-direction: column;
    font-size: 11.5px;
    gap: 2px;
  }

  .when {
    font-size: 12px;
  }

  .del {
    font-family: var(--mono);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--pencil);
    opacity: 0;
  }

  .case:hover .del {
    opacity: 1;
  }

  .del:hover {
    color: var(--marker);
  }

  .demo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px 90px 160px;
    gap: 12px;
    align-items: center;
    padding: 9px 4px;
    border-bottom: 1px solid var(--rule);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    align-items: center;
  }

  .status button {
    font-family: var(--mono);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  @media (max-width: 760px) {
    h1 {
      font-size: 36px;
    }

    .case {
      grid-template-columns: 46px minmax(0, 1fr) 60px;
    }

    .no,
    .meta,
    .when {
      display: none;
    }
  }
</style>
