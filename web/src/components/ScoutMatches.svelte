<script lang="ts">
  import { scoutDownload } from '../lib/api'
  import { mapLabel } from '../lib/format'
  import type { Entry, FoundMatch } from '../lib/types'
  import Icon from './Icon.svelte'
  import ScoutIcon from './ScoutIcon.svelte'
  import type { ScoutState } from './ScoutPage.svelte'

  // The matches FACEIT found for the team: the map pool, the list with links
  // to the rooms, and downloading their demos.
  let { s }: { s: ScoutState } = $props()

  let busy = $state(false)
  let error = $state('')
  let note = $state('')

  const found = $derived(s.found!)
  const matches = $derived(found.matches.filter((m) => !s.mapFilter || m.map === s.mapFilter))
  const total = $derived(found.maps.reduce((n, m) => n + m.played, 0))
  const wonAll = $derived(found.maps.reduce((n, m) => n + m.won, 0))
  const names = $derived(s.faceitPlayers.map((p) => p.nickname))

  function entry(m: FoundMatch): Entry | undefined {
    return s.entryFor(m.matchId) ?? (m.replayId ? s.replays.find((e) => e.id === m.replayId) : undefined)
  }

  const missing = $derived(matches.filter((m) => m.demo && !entry(m) && !s.jobFor(m.matchId) && !s.pending.includes(m.matchId)))
  const inLibrary = $derived(matches.filter((m) => entry(m)).length)
  // The note about queued downloads stays while any of them still runs.
  const running = $derived(found.matches.some((m) => !entry(m) && (s.jobFor(m.matchId) || s.pending.includes(m.matchId))))

  async function download() {
    const ids = missing.map((m) => m.matchId)
    if (!ids.length) return
    busy = true
    error = ''
    note = ''
    try {
      const res = await scoutDownload(ids)
      s.downloadsAllowed = res.downloadsAllowed
      const failed = { ...s.failed }
      for (const f of res.failed) failed[f.matchId] = f.error
      for (const id of res.queued) delete failed[id]
      s.failed = failed
      s.requested = [...new Set([...s.requested, ...res.queued])]
      if (res.queued.length) note = `${res.queued.length} ${res.queued.length === 1 ? 'demo is' : 'demos are'} on the way. They download one at a time and show up in step 2 when they are read.`
      await s.refresh()
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function day(sec: number): string {
    if (!sec) return '-'
    const d = new Date(sec * 1000)
    const same = d.getFullYear() === new Date().getFullYear()
    return d.toLocaleDateString([], same ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function ago(sec: number): string {
    if (!sec) return ''
    const days = Math.floor((Date.now() / 1000 - sec) / 86400)
    if (days < 1) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 60) return `${days} days ago`
    return `${Math.round(days / 30)} months ago`
  }

  const KIND: Record<string, string> = { league: 'League', matchmaking: 'Matchmaking', other: 'Other' }

  function without(m: FoundMatch): string[] {
    const there = new Set(m.players.map((p) => p.toLowerCase()))
    return names.filter((n) => !there.has(n.toLowerCase()))
  }

  function pct(won: number, played: number): number {
    return played ? Math.round((won / played) * 100) : 0
  }

  function hide(e: Event) {
    ;(e.currentTarget as HTMLElement).style.visibility = 'hidden'
  }
</script>

{#snippet thumb(map: string, size: number)}
  <span class="thumb" style:width="{size}px" style:height="{size}px">
    <span class="ini">{mapLabel(map || '?').slice(0, 2)}</span>
    {#if map}<img src="/api/maps/{map}_radar_psd.png" alt="" loading="lazy" onerror={hide} />{/if}
  </span>
{/snippet}

{#snippet status(m: FoundMatch)}
  {@const e = entry(m)}
  {@const job = s.jobFor(m.matchId)}
  {#if e}
    <a class="state good" href="#/replay/{e.id}" title="Open this demo"><Icon name="check" size={13} />In library</a>
  {:else if job && job.status === 'error'}
    <span class="state bad" title={job.error}>Failed</span>
  {:else if job && (job.status === 'downloading' || !job.id.startsWith('faceit-'))}
    <!-- Some demos only report progress at the end, then the bar sweeps. -->
    <span class="state busy">
      <span class="word">{job.status === 'downloading' ? 'Downloading' : 'Reading'}</span>
      <span class="bar" class:sweep={!(job.progress > 0)}><i style:width="{Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%"></i></span>
    </span>
  {:else if job || s.pending.includes(m.matchId)}
    <span class="state busy"><span class="word">Queued</span></span>
  {:else if !m.demo}
    <span class="state faint" title="FACEIT has no demo for this match">No demo</span>
  {:else if s.failed[m.matchId] && s.downloadsAllowed !== false}
    <span class="state bad" title={s.failed[m.matchId]}>Failed</span>
  {:else}
    <span class="state">Not downloaded</span>
  {/if}
{/snippet}

<div class="found">
  <div class="pool">
    <button class="tile all" class:on={!s.mapFilter} onclick={() => (s.mapFilter = '')}>
      <span class="tmap">All maps</span>
      <span class="tnum"><b class="num">{total}</b> played <span class="dot">·</span> <b class="num">{wonAll}</b> won</span>
      <span class="wbar"><i style:width="{pct(wonAll, total)}%"></i></span>
    </button>
    {#each found.maps as mp (mp.map)}
      <button class="tile" class:on={s.mapFilter === mp.map} aria-pressed={s.mapFilter === mp.map} onclick={() => (s.mapFilter = s.mapFilter === mp.map ? '' : mp.map)}>
        <span class="trow">
          {@render thumb(mp.map, 28)}
          <span class="tmap">{mp.map ? mapLabel(mp.map) : 'Unknown'}</span>
        </span>
        <span class="tnum"><b class="num">{mp.played}</b> played <span class="dot">·</span> <b class="num">{mp.won}</b> won</span>
        <span class="wbar" title="{pct(mp.won, mp.played)}% won"><i style:width="{pct(mp.won, mp.played)}%"></i></span>
      </button>
    {/each}
  </div>

  <div class="table">
    <div class="cols th" aria-hidden="true">
      <span class="label">Map</span>
      <span class="label">Date</span>
      <span class="label">Event</span>
      <span class="label">Result</span>
      <span class="label">Players</span>
      <span class="label">Demo</span>
      <span></span>
    </div>
    {#each matches as m (m.matchId)}
      {@const miss = without(m)}
      <div class="cols row">
        <span class="map">
          {@render thumb(m.map, 34)}
          <b>{m.map ? mapLabel(m.map) : 'Unknown'}</b>
        </span>
        <span class="date">
          <span>{day(m.startedAt)}</span>
          <small>{ago(m.startedAt)}</small>
        </span>
        <span class="event">
          <span class="comp" title={m.competition}>{m.competition || '-'}</span>
          <small><span class="kind {m.kind}">{KIND[m.kind]}</span>{#if m.opponent}<span class="vs" title="Against {m.opponent}">vs {m.opponent}</span>{/if}</small>
        </span>
        <span class="result">
          {#if m.won === true}<span class="wl w">W</span>{:else if m.won === false}<span class="wl l">L</span>{:else}<span class="wl">-</span>{/if}
          <b class="num">{m.score || ''}</b>
        </span>
        <span class="who" title={m.players.join(', ')}>
          <span class="cnt"><b class="num">{m.players.length}</b> of {names.length}</span>
          <small>{miss.length ? `without ${miss.join(', ')}` : 'all of them'}</small>
        </span>
        <span class="st">{@render status(m)}</span>
        <span class="r">
          <a class="room" href={m.url} target="_blank" rel="noopener noreferrer" title="Open the match room on FACEIT">
            Room<ScoutIcon name="external" size={12} />
          </a>
        </span>
      </div>
    {:else}
      <div class="empty">
        <ScoutIcon name="users" size={18} />
        <span>No matches where {s.minTogether} or more of them played together. Try fewer players together.</span>
      </div>
    {/each}
  </div>

  {#if s.downloadsAllowed === false}
    <div class="note" role="note">
      <ScoutIcon name="info" size={17} />
      <div>
        <b>Your FACEIT key cannot download demos.</b>
        <p>
          FACEIT only gives demo downloads to approved apps. Open each room with the <span class="kbd">Room</span> link, click
          <span class="kbd">Watch demo</span> to download it, then drop the files into step 2. Cerlock matches them to the team by SteamID.
        </p>
      </div>
    </div>
  {/if}

  <div class="foot">
    <span class="faint">
      {matches.length} {matches.length === 1 ? 'match' : 'matches'}{s.mapFilter ? ` on ${mapLabel(s.mapFilter)}` : ''}, {inLibrary} in your case files
    </span>
    <span class="grow"></span>
    {#if error}<span class="bad small">{error}</span>{/if}
    {#if note && running}<span class="dim small">{note}</span>{/if}
    <button class="btn" class:primary={s.downloadsAllowed !== false && missing.length > 0} disabled={busy || !missing.length} onclick={download}>
      <ScoutIcon name="download" size={15} />
      <span>
        {#if busy}Asking FACEIT{:else if missing.length}Download {missing.length} {missing.length === 1 ? 'demo' : 'demos'}{:else}Nothing to download{/if}
      </span>
    </button>
  </div>
</div>

<style>
  .found {
    margin-top: 16px;
  }

  /* Map pool */

  .pool {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 10px 12px 11px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
    min-width: 0;
  }

  .tile:hover {
    background: var(--surface-2);
    border-color: var(--line-2);
  }

  .tile.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .tile.all {
    justify-content: space-between;
  }

  .trow {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .tmap {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tnum {
    font-size: 12.5px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .tnum b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }

  .dot {
    margin: 0 2px;
  }

  .wbar {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .wbar i {
    display: block;
    height: 100%;
    background: var(--good);
  }

  .thumb {
    position: relative;
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

  /* Matches */

  .table {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 92px minmax(150px, 1.5fr) 88px minmax(120px, 1.2fr) 132px 64px;
    gap: 14px;
    align-items: center;
    padding: 0 12px 0 14px;
  }

  .th {
    height: 34px;
    border-bottom: 1px solid var(--line);
  }

  .row {
    min-height: 56px;
    border-bottom: 1px solid var(--line);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .map {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .map b {
    font-family: var(--display);
    font-size: 15.5px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .date,
  .event,
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  small {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .comp {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }

  .event small {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .kind {
    flex: none;
    padding: 0 5px;
    border-radius: 3px;
    border: 1px solid var(--line-2);
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-2);
    line-height: 16px;
  }

  .kind.league {
    border-color: rgba(255, 194, 71, 0.4);
    color: var(--evidence);
  }

  .vs {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .result b {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
  }

  .wl {
    width: 20px;
    height: 20px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text-3);
    font-family: var(--display);
    font-size: 12px;
    font-weight: 700;
  }

  .wl.w {
    background: rgba(60, 203, 138, 0.16);
    color: var(--good);
  }

  .wl.l {
    background: rgba(255, 100, 100, 0.14);
    color: var(--bad);
  }

  .cnt {
    color: var(--text-2);
  }

  .cnt b {
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 700;
    color: var(--text);
  }

  .st {
    min-width: 0;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-3);
    white-space: nowrap;
    text-decoration: none;
  }

  a.state:hover {
    text-decoration: underline;
  }

  .state.good {
    color: var(--good);
  }

  .state.bad {
    color: var(--bad);
  }

  .state.faint {
    color: var(--text-3);
    font-weight: 500;
  }

  .state.busy {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    color: var(--text-2);
  }

  .bar {
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
    transition: width 0.3s;
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

  @media (prefers-reduced-motion: reduce) {
    .bar.sweep::after {
      animation: none;
    }
  }

  .r {
    justify-self: end;
  }

  .room {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-2);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }

  .room:hover {
    color: var(--text);
    background: var(--surface-3);
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 22px 18px;
    color: var(--text-2);
  }

  .note {
    display: flex;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 16px 13px;
    border: 1px solid rgba(255, 194, 71, 0.32);
    border-left: 3px solid var(--evidence);
    border-radius: var(--radius);
    background: rgba(255, 194, 71, 0.06);
  }

  .note :global(.icon) {
    color: var(--evidence);
    margin-top: 1px;
  }

  .note b {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
  }

  .note p {
    margin: 3px 0 0;
    color: var(--text-2);
    line-height: 1.5;
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
    white-space: nowrap;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 12px;
    min-width: 0;
  }

  .grow {
    flex: 1;
  }

  .small {
    font-size: 12.5px;
    text-align: right;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px 0 12px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
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

  @media (max-width: 1100px) {
    .cols {
      grid-template-columns: minmax(110px, 1fr) 84px minmax(130px, 1.4fr) 80px 120px 64px;
    }

    .who,
    .th > :nth-child(5) {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) 80px 110px 60px;
    }

    .date,
    .event,
    .th > :nth-child(2),
    .th > :nth-child(3) {
      display: none;
    }

    .foot {
      flex-wrap: wrap;
    }
  }
</style>
