<script lang="ts">
  import { deleteReplay, fingerprint, getEntry, listLocal, listReplays, parseLocal, upload } from '../lib/api'
  import { ago, bytes, duration, mapLabel, ms } from '../lib/format'
  import type { Entry, Job, LocalDemo } from '../lib/types'
  import Icon from './Icon.svelte'

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
    busy = { name: file.name, stage: 'Checking', progress: 0 }
    try {
      const id = await fingerprint(file)
      if (await getEntry(id)) return open(id)
      busy = { name: file.name, stage: 'Uploading and parsing', progress: 0 }
      const start = performance.now()
      const entry = await upload(file, (p) => {
        if (busy) busy.progress = p
        if (busy && p >= 1) busy.stage = 'Finishing'
      })
      console.info(`parsed ${file.name} in ${Math.round(performance.now() - start)} ms`)
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
    if (!confirm('Delete this replay? The demo file itself is not touched.')) return
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
    <div class="brand">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#161c25" /><circle cx="12" cy="13" r="5" fill="#5aa9ff" /><circle cx="21" cy="20" r="5" fill="#f5a524" /><path d="M12 13 L19 6" stroke="#5aa9ff" stroke-width="2.5" stroke-linecap="round" /></svg>
      <div>
        <h1>CerlockCS</h1>
        <p>CS2 demo review for teams</p>
      </div>
    </div>
  </header>

  <button class="drop" class:dragging class:busy={!!busy} onclick={() => !busy && input.click()}>
    {#if busy}
      <div class="busy">
        <strong>{busy.stage}</strong>
        <span class="muted">{busy.name}</span>
        <div class="bar"><div style="width: {Math.round(busy.progress * 100)}%"></div></div>
        <span class="mono muted">{Math.round(busy.progress * 100)}%</span>
      </div>
    {:else}
      <Icon name="upload" size={28} />
      <strong>Drop a demo here or click to pick one</strong>
      <span class="muted">.dem, .dem.gz, .dem.bz2 or .dem.zst. The demo is parsed while it uploads.</span>
    {/if}
  </button>
  <input bind:this={input} type="file" accept=".dem,.gz,.bz2,.zst" hidden onchange={onPick} />

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if jobs.length}
    <section>
      <h2>Parsing</h2>
      {#each jobs as job (job.id)}
        <div class="job">
          <span>{job.name}</span>
          {#if job.status === 'error'}
            <span class="error-text">{job.error}</span>
          {:else}
            <div class="bar small"><div style="width: {Math.round(job.progress * 100)}%"></div></div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  <section>
    <h2>Replays</h2>
    {#if loading}
      <p class="muted">Loading...</p>
    {:else if replays.length === 0}
      <p class="muted">Nothing here yet. Drop a demo above to get started.</p>
    {:else}
      <div class="grid">
        {#each replays as r (r.id)}
          <div class="card" role="button" tabindex="0" onclick={() => open(r.id)} onkeydown={(e) => e.key === 'Enter' && open(r.id)}>
            <div class="thumb">
              <img src="/api/maps/{r.map}_radar_psd.png" alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              <span class="map">{mapLabel(r.map)}</span>
            </div>
            <div class="body">
              <div class="score">
                <span class="team">{r.teams[0].name}</span>
                <span class="mono">{r.teams[0].score} : {r.teams[1].score}</span>
                <span class="team right">{r.teams[1].name}</span>
              </div>
              <div class="meta muted">
                <span>{r.rounds} rounds</span>
                <span>{duration(r.duration)}</span>
                <span title="demo size and parse time">{bytes(r.demoSize)} in {ms(r.parseMs)}</span>
              </div>
              <div class="meta muted">
                <span class="name" title={r.name}>{r.name}</span>
                <span>{ago(r.created)}</span>
                <button class="ghost icon" title="Delete replay" onclick={(e) => remove(e, r.id)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if dirs.length}
    <section>
      <h2>Demo folders</h2>
      <p class="muted small">{dirs.join(', ')}. New demos are parsed in the background.</p>
      {#if local.length === 0}
        <p class="muted">No demos found.</p>
      {:else}
        <table>
          <tbody>
            {#each local as d (d.path)}
              <tr>
                <td class="name" title={d.path}>{d.name}</td>
                <td class="muted num">{bytes(d.size)}</td>
                <td class="muted">{ago(d.modified)}</td>
                <td class="status">
                  {#if d.status === 'ready'}
                    <button onclick={() => open(d.id)}>Open</button>
                  {:else if d.status === 'parsing' || d.status === 'queued'}
                    <div class="bar small"><div style="width: {Math.round(d.progress * 100)}%"></div></div>
                  {:else if d.status === 'error'}
                    <span class="error-text" title={d.error}>Failed</span>
                    <button onclick={() => parse(d)}>Retry</button>
                  {:else}
                    <button onclick={() => parse(d)}>Parse</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 20px 60px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0.2px;
  }

  .brand p {
    margin: 0;
    color: var(--muted);
  }

  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-2);
    margin: 28px 0 12px;
  }

  .drop {
    width: 100%;
    min-height: 150px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1.5px dashed var(--line-2);
    border-radius: 12px;
    background: var(--panel);
    color: var(--text-2);
  }

  .drop:hover,
  .drop.dragging {
    border-color: var(--accent);
    background: #121a26;
    color: var(--text);
  }

  .drop.busy {
    cursor: default;
  }

  .busy {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: min(420px, 80%);
  }

  .bar {
    width: 100%;
    height: 6px;
    background: var(--panel-3);
    border-radius: 3px;
    overflow: hidden;
  }

  .bar.small {
    width: 140px;
    height: 4px;
  }

  .bar div {
    height: 100%;
    background: linear-gradient(90deg, var(--ct), var(--accent));
    transition: width 0.2s;
  }

  .error {
    background: rgba(255, 93, 93, 0.1);
    border: 1px solid rgba(255, 93, 93, 0.35);
    color: #ffb3b3;
    padding: 8px 12px;
    border-radius: 8px;
  }

  .error-text {
    color: var(--bad);
  }

  .job {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 14px;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
  }

  .card:hover {
    border-color: var(--line-2);
    transform: translateY(-1px);
  }

  .thumb {
    position: relative;
    height: 120px;
    background: radial-gradient(circle at 50% 40%, #1a2230, #0d1218);
    overflow: hidden;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.55;
    transform: scale(1.3);
  }

  .map {
    position: absolute;
    left: 12px;
    bottom: 8px;
    font-weight: 700;
    font-size: 16px;
    text-shadow: 0 1px 4px #000;
  }

  .body {
    padding: 10px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .score {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }

  .team {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right {
    text-align: right;
  }

  .meta {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 12px;
  }

  .meta .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    padding: 2px 4px;
    display: inline-flex;
  }

  .small {
    font-size: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--line);
  }

  td.name {
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  td.status {
    text-align: right;
    width: 180px;
  }

  td.status .bar {
    margin-left: auto;
  }
</style>
