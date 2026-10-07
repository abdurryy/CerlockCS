<script module lang="ts">
  import { fingerprint, getEntry, getSettings, listReplays, upload } from '../lib/api'
  import type { RosterPlayer } from '../lib/scout/types'
  import type { Entry, FindResult, Job, ScoutLookup, Settings } from '../lib/types'

  const STORE = 'cerlock.scout'

  // The team picked from a demo when there is no FACEIT lookup.
  export interface ManualRoster {
    replayId: string
    team: number
    name: string
    map: string
    players: RosterPlayer[]
  }

  export interface Upload {
    key: string
    name: string
    stage: 'waiting' | 'checking' | 'uploading' | 'reading' | 'done' | 'known' | 'error'
    progress: number
    error?: string
    id?: string
  }

  export interface Candidate {
    entry: Entry
    // How many of the roster played in it.
    count: number
  }

  const validSteam = (id: string) => /^\d{15,20}$/.test(id) && id !== '0'

  // ScoutState holds everything the three steps share. The parts worth
  // keeping (lookup, picks, found matches) survive a reload.
  export class ScoutState {
    settings = $state<Settings | null>(null)
    url = $state('')
    lookup = $state<ScoutLookup | null>(null)
    teamIndex = $state(-1)
    // Players of the FACEIT team left out, by FACEIT id.
    off = $state<string[]>([])
    minTogether = $state(4)
    found = $state<FindResult | null>(null)
    // The team the found matches belong to.
    foundFor = $state('')
    mapFilter = $state('')
    downloadsAllowed = $state<boolean | null>(null)
    failed = $state<Record<string, string>>({})
    requested = $state<string[]>([])
    manual = $state<ManualRoster | null>(null)
    source = $state<'faceit' | 'replay'>('faceit')
    // Library entries unticked in step 2.
    excluded = $state<string[]>([])
    replays = $state<Entry[]>([])
    jobs = $state<Job[]>([])
    uploads = $state<Upload[]>([])
    loaded = $state(false)
    listError = $state('')

    team = $derived(this.lookup?.teams[this.teamIndex] ?? null)
    teamKey = $derived(this.team ? this.team.id || this.team.name : '')
    faceitPlayers = $derived(this.team?.players.filter((p) => !this.off.includes(p.faceitId || p.nickname)) ?? [])

    roster = $derived.by((): RosterPlayer[] => {
      if (this.source === 'replay') return this.manual?.players ?? []
      return this.faceitPlayers.filter((p) => validSteam(p.steamId)).map((p) => ({ steamId: p.steamId, name: p.nickname || p.steamId }))
    })

    rosterName = $derived(this.source === 'replay' ? (this.manual?.name ?? '') : (this.team?.name ?? ''))

    candidates = $derived.by((): Candidate[] => {
      const ids = new Set(this.roster.map((p) => p.steamId))
      if (!ids.size) return []
      const need = Math.min(3, ids.size)
      return this.replays
        .map((entry) => ({ entry, count: new Set((entry.steamIds ?? []).filter((id) => ids.has(id))).size }))
        .filter((c) => c.count >= need)
    })

    selected = $derived(this.candidates.filter((c) => !this.excluded.includes(c.entry.id)))

    uploading = $derived(this.uploads.some((u) => u.stage === 'waiting' || u.stage === 'checking' || u.stage === 'uploading' || u.stage === 'reading'))

    // Downloads asked for that have not shown up in the library yet.
    pending = $derived(this.requested.filter((id) => !this.entryFor(id) && !this.failed[id]))

    busy = $derived(this.jobs.length > 0 || this.uploading || this.pending.length > 0)

    constructor() {
      this.restore()
    }

    entryFor(matchId: string): Entry | undefined {
      const id = matchId.toLowerCase()
      return id ? this.replays.find((e) => e.name.toLowerCase().includes(id)) : undefined
    }

    jobFor(matchId: string): Job | undefined {
      const id = matchId.toLowerCase()
      return this.jobs.find((j) => j.id === `faceit-${id}` || j.name.toLowerCase().includes(id))
    }

    async refresh() {
      try {
        const r = await listReplays()
        this.replays = (r.replays ?? []).slice().sort((a, b) => b.created.localeCompare(a.created))
        this.jobs = r.jobs ?? []
        this.listError = ''
      } catch (e) {
        this.listError = (e as Error).message
      } finally {
        this.loaded = true
      }
    }

    async loadSettings() {
      try {
        this.settings = await getSettings()
      } catch {
        this.settings = { faceitKey: false, faceitKeyHint: '' }
      }
    }

    pickTeam(i: number) {
      const t = this.lookup?.teams[i]
      if (!t) return
      this.teamIndex = i
      this.source = 'faceit'
      // FACEIT looks up at most 10 players at a time.
      this.off = t.players.slice(10).map((p) => p.faceitId || p.nickname)
      this.minTogether = Math.min(this.minTogether || 4, Math.max(1, t.players.length))
    }

    useManual(m: ManualRoster) {
      this.manual = m
      this.source = 'replay'
      this.excluded = []
    }

    // addFiles uploads demos one after the other. They are parsed while
    // they upload, and show up in the list when done.
    addFiles(files: File[]) {
      const ok = files.filter((f) => /\.dem(\.gz|\.bz2|\.zst)?$/i.test(f.name))
      for (const f of files) {
        if (!ok.includes(f)) this.uploads.push({ key: `${f.name}-${Date.now()}-${Math.random()}`, name: f.name, stage: 'error', progress: 0, error: 'Not a CS2 demo (.dem, .dem.gz, .dem.bz2 or .dem.zst)' })
      }
      const start = this.uploads.length
      for (const f of ok) this.uploads.push({ key: `${f.name}-${Date.now()}-${Math.random()}`, name: f.name, stage: 'waiting', progress: 0 })
      // Read back through the state so changes to them show.
      const items = this.uploads.slice(start)
      if (ok.length) this.queue = this.queue.then(() => this.sendAll(ok, items))
    }

    // Uploads run one at a time, files dropped later wait their turn.
    private queue: Promise<void> = Promise.resolve()

    private async sendAll(files: File[], items: Upload[]) {
      for (let k = 0; k < files.length; k++) {
        await this.send(files[k], items[k])
        await this.refresh()
      }
    }

    private async send(file: File, u: Upload) {
      try {
        u.stage = 'checking'
        const id = await fingerprint(file)
        const known = await getEntry(id)
        if (known) {
          u.stage = 'known'
          u.id = id
          this.excluded = this.excluded.filter((x) => x !== id)
          return
        }
        u.stage = 'uploading'
        const entry = await upload(file, (p) => {
          u.progress = p
          if (p >= 1) u.stage = 'reading'
        })
        u.stage = 'done'
        u.id = entry.id
      } catch (e) {
        u.stage = 'error'
        u.error = (e as Error).message
      }
    }

    clearUploads() {
      this.uploads = this.uploads.filter((u) => u.stage === 'waiting' || u.stage === 'checking' || u.stage === 'uploading' || u.stage === 'reading')
    }

    save() {
      const data = {
        url: this.url,
        lookup: this.lookup,
        teamIndex: this.teamIndex,
        off: this.off,
        minTogether: this.minTogether,
        found: this.found,
        foundFor: this.foundFor,
        mapFilter: this.mapFilter,
        downloadsAllowed: this.downloadsAllowed,
        requested: this.requested,
        manual: this.manual,
        source: this.source,
        excluded: this.excluded,
      }
      try {
        localStorage.setItem(STORE, JSON.stringify(data))
      } catch {
        // private window or full storage, the page works without it
      }
    }

    private restore() {
      let d: Record<string, unknown> | null = null
      try {
        d = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      } catch {
        d = null
      }
      if (!d || typeof d !== 'object') return
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      this.url = str(d.url)
      const l = d.lookup as ScoutLookup | null
      if (l && Array.isArray(l.teams)) {
        this.lookup = l
        this.teamIndex = typeof d.teamIndex === 'number' && d.teamIndex < l.teams.length ? d.teamIndex : -1
      }
      this.off = strs(d.off)
      this.minTogether = typeof d.minTogether === 'number' ? d.minTogether : 4
      const f = d.found as FindResult | null
      if (f && Array.isArray(f.matches) && Array.isArray(f.maps)) this.found = f
      this.foundFor = str(d.foundFor)
      this.mapFilter = str(d.mapFilter)
      this.downloadsAllowed = typeof d.downloadsAllowed === 'boolean' ? d.downloadsAllowed : null
      this.requested = strs(d.requested)
      const m = d.manual as ManualRoster | null
      if (m && Array.isArray(m.players)) this.manual = m
      this.source = d.source === 'replay' ? 'replay' : 'faceit'
      this.excluded = strs(d.excluded)
    }

    reset() {
      this.url = ''
      this.lookup = null
      this.teamIndex = -1
      this.off = []
      this.found = null
      this.foundFor = ''
      this.mapFilter = ''
      this.failed = {}
      this.requested = []
      this.manual = null
      this.source = 'faceit'
      this.excluded = []
    }
  }
</script>

<script lang="ts">
  import Logo from './Logo.svelte'
  import Icon from './Icon.svelte'
  import ScoutDemos from './ScoutDemos.svelte'
  import ScoutFaceit from './ScoutFaceit.svelte'
  import ScoutReport from './ScoutReport.svelte'

  const s = new ScoutState()
  let dragging = $state(false)

  $effect(() => {
    s.loadSettings()
    s.refresh()
    // Downloads and uploads show their progress, so poll while they run.
    // Otherwise a slow look now and then picks up demos added elsewhere.
    let idle = 0
    const timer = setInterval(() => {
      idle = s.busy ? 0 : idle + 1
      if (s.busy || idle % 8 === 0) s.refresh()
    }, 2000)
    return () => clearInterval(timer)
  })

  $effect(() => {
    s.save()
  })

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) s.addFiles(files)
  }
</script>

<svelte:head>
  <title>Scout a team · Cerlock</title>
</svelte:head>

<svelte:window
  ondragover={(e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
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
      <span class="tag">Scout a team</span>
      <span class="spacer"></span>
      <a class="back" href="#/"><Icon name="back" size={14} /><span>Case files</span></a>
    </div>
  </header>

  <main class="wrap">
    <section class="intro">
      <h1>Scout a team.</h1>
      <p>
        Find the matches a team played together, even pugs where they five stacked, and read their demos. You get per map heatmaps of every
        player, where they stand early on CT and how they hit sites on T, as PNG images ready to share.
      </p>
    </section>

    <ol class="steps">
      <li class="step">
        <span class="no">1</span>
        <div class="body">
          <div class="shead">
            <h2>Find their matches</h2>
            <span class="opt">FACEIT, optional</span>
          </div>
          <ScoutFaceit {s} />
        </div>
      </li>
      <li class="step">
        <span class="no">2</span>
        <div class="body">
          <div class="shead">
            <h2>Pick the demos</h2>
            {#if s.selected.length}<span class="opt">{s.selected.length} selected</span>{/if}
          </div>
          <ScoutDemos {s} />
        </div>
      </li>
      <li class="step">
        <span class="no">3</span>
        <div class="body">
          <div class="shead">
            <h2>Report</h2>
            <span class="opt">Heatmaps per map</span>
          </div>
          <ScoutReport {s} />
        </div>
      </li>
    </ol>
  </main>

  {#if dragging}
    <div class="drag-veil" aria-hidden="true">
      <span class="corner tl"></span>
      <span class="corner tr"></span>
      <span class="corner bl"></span>
      <span class="corner br"></span>
      <span class="veil-text">Drop the demos to add them</span>
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

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px 0 10px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.12s;
  }

  .back:hover {
    background: var(--surface-3);
  }

  .intro {
    padding: 48px 0 36px;
    max-width: 760px;
  }

  h1 {
    font-size: 44px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.012em;
  }

  .intro p {
    margin: 16px 0 0;
    text-wrap: pretty;
    color: var(--text-2);
    font-size: 15.5px;
    line-height: 1.55;
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0 0 64px;
  }

  .step {
    position: relative;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 20px;
    padding-bottom: 44px;
  }

  /* A thin line joins the step numbers. */
  .step:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 38px;
    bottom: 8px;
    width: 1px;
    background: var(--line);
  }

  .no {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    font-family: var(--display);
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
  }

  .body {
    min-width: 0;
  }

  .shead {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-height: 30px;
    margin-bottom: 12px;
    padding-top: 2px;
  }

  h2 {
    font-size: 21px;
    font-weight: 700;
  }

  .opt {
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-3);
  }

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

  .corner {
    position: absolute;
    width: 28px;
    height: 28px;
    border: 0 solid var(--accent);
  }

  .corner.tl {
    top: 0;
    left: 0;
    border-top-width: 2px;
    border-left-width: 2px;
  }

  .corner.tr {
    top: 0;
    right: 0;
    border-top-width: 2px;
    border-right-width: 2px;
  }

  .corner.bl {
    bottom: 0;
    left: 0;
    border-bottom-width: 2px;
    border-left-width: 2px;
  }

  .corner.br {
    bottom: 0;
    right: 0;
    border-bottom-width: 2px;
    border-right-width: 2px;
  }

  .veil-text {
    font-family: var(--display);
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
  }

  @media (max-width: 640px) {
    .wrap {
      padding: 0 16px;
    }

    .tag {
      display: none;
    }

    h1 {
      font-size: 34px;
    }

    .step {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }

    .step::before {
      display: none;
    }
  }
</style>
