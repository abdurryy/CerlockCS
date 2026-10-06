<script lang="ts">
  import { tick } from 'svelte'
  import type { Engagement } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'
  import AimChart from './AimChart.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  let filter = $state<'all' | 'won' | 'lost'>('all')

  const players = $derived(r.match.players.filter((p) => (report.aim[p.index]?.engagements ?? 0) > 0))
  const player = $derived(v.inspect >= 0 ? v.inspect : v.follow >= 0 ? v.follow : (players[0]?.index ?? 0))
  const summary = $derived(report.aim[player])
  const stats = $derived(report.players[player])

  function median(values: number[]): number {
    if (!values.length) return -1
    const s = [...values].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  // Everyone in the demo, to give the numbers some context.
  const lobby = $derived({
    reaction: median(r.engagements.filter((e) => e.reactionMs >= 80).map((e) => e.reactionMs)),
    crosshair: median(r.engagements.filter((e) => e.crosshairErrorDeg >= 0).map((e) => e.crosshairErrorDeg)),
    firstShot: median(r.engagements.filter((e) => e.firstShotErrorDeg >= 0).map((e) => e.firstShotErrorDeg)),
    ttd: median(r.engagements.filter((e) => e.timeToDamageMs >= 0).map((e) => e.timeToDamageMs)),
    still: median(report.players.filter((p) => p.shotsFired >= 30).map((p) => p.counterStrafe)),
  })

  const list = $derived(r.engagements.filter((e) => e.attacker === player && (filter === 'all' || (filter === 'won' ? e.killed : e.died))))
  const selected = $derived(r.engagements[v.engagement] && r.engagements[v.engagement].attacker === player ? r.engagements[v.engagement] : null)

  let chart: HTMLElement | undefined = $state()

  function open(e: Engagement) {
    v.engagement = e.id
    tick().then(() => chart?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    v.seek(Math.max(e.startTick, (e.firstSeenTick >= 0 ? e.firstSeenTick : e.startTick) - r.rate))
    v.follow = e.attacker
    v.focus = [e.attacker, e.victim]
    v.speed = 0.25
    v.playing = true
  }

  const fmt = (n: number, unit: string, digits = 0) => (n < 0 ? '-' : `${n.toFixed(digits)}${unit}`)
  // Lower is better for the timing and angle numbers.
  const lower = (n: number, ref: number) => (n < 0 || ref < 0 ? '' : n <= ref * 0.9 ? 'good' : n >= ref * 1.25 ? 'bad' : '')
  const higher = (n: number, ref: number) => (n < 0 || ref < 0 ? '' : n >= ref + 5 ? 'good' : n <= ref - 8 ? 'bad' : '')
</script>

<div class="ballistics">
  <div class="pick">
    <span class="label">Shooter</span>
    <select value={player} onchange={(e) => (v.inspect = Number((e.currentTarget as HTMLSelectElement).value))}>
      {#each players as p (p.index)}<option value={p.index}>{p.name}</option>{/each}
    </select>
  </div>

  {#if summary}
    <div class="metrics">
      <div class="m">
        <span class="label">Crosshair placement</span>
        <b class="mono {lower(summary.crosshairErrorDeg, lobby.crosshair)}">{fmt(summary.crosshairErrorDeg, '°', 1)}</b>
        <span class="ref">game {fmt(lobby.crosshair, '°', 1)}</span>
      </div>
      <div class="m">
        <span class="label">Reaction</span>
        <b class="mono {lower(summary.reactionMs, lobby.reaction)}">{fmt(summary.reactionMs, ' ms')}</b>
        <span class="ref">game {fmt(lobby.reaction, ' ms')}</span>
      </div>
      <div class="m">
        <span class="label">Time to damage</span>
        <b class="mono {lower(summary.timeToDamageMs, lobby.ttd)}">{fmt(summary.timeToDamageMs, ' ms')}</b>
        <span class="ref">game {fmt(lobby.ttd, ' ms')}</span>
      </div>
      <div class="m">
        <span class="label">First shot error</span>
        <b class="mono {lower(summary.firstShotErrorDeg, lobby.firstShot)}">{fmt(summary.firstShotErrorDeg, '°', 1)}</b>
        <span class="ref">game {fmt(lobby.firstShot, '°', 1)}</span>
      </div>
      <div class="m">
        <span class="label">Shots while still</span>
        <b class="mono {higher(stats?.counterStrafe ?? -1, lobby.still)}">{fmt(stats?.counterStrafe ?? -1, '%')}</b>
        <span class="ref">game {fmt(lobby.still, '%')}</span>
      </div>
      <div class="m">
        <span class="label">Duels</span>
        <b class="mono">{summary.duelsWon} - {summary.duelsLost}</b>
        <span class="ref">{summary.noShotDeaths} lost without a shot</span>
      </div>
    </div>
    <p class="row dim">
      <span class="mono">{summary.duelAccuracy}%</span> of shots hit inside duels, <span class="mono">{summary.headshotRate}%</span> of kills were headshots,
      <span class="mono">{summary.prefires}</span> prefires.
    </p>
  {/if}

  <p class="note faint">
    Crosshair placement is how far the crosshair was from the enemy's head the moment they showed up. Reaction is the time from spotting
    to the first shot. Spotting comes from the game's radar, so it can trail real line of sight by a few ticks.
  </p>

  {#if selected}
    <section class="chart" bind:this={chart}>
      <div class="chart-head">
        <span class="label">Duel</span>
        <strong>Round {selected.round + 1} vs {r.playerName(selected.victim)}</strong>
        <span class="mono faint">{weaponName(selected.weapon)}</span>
      </div>
      <AimChart {r} e={selected} tick={v.tick} />
    </section>
  {/if}

  <div class="filters">
    <span class="label">{list.length} duels</span>
    <span class="spacer"></span>
    {#each [['all', 'All'], ['won', 'Won'], ['lost', 'Lost']] as [id, label] (id)}
      <button class:on={filter === id} onclick={() => (filter = id as typeof filter)}>{label}</button>
    {/each}
  </div>
  <table>
    <thead>
      <tr><th>Rd</th><th class="l">Opponent</th><th>Result</th><th title="Crosshair distance when spotted">Xhair</th><th title="Spotted to first shot, ms">React</th><th title="Hits / shots">Hits</th></tr>
    </thead>
    <tbody>
      {#each list as e (e.id)}
        <tr class:selected={selected?.id === e.id} onclick={() => open(e)}>
          <td>{e.round + 1}</td>
          <td class="l">{r.playerName(e.victim)}</td>
          <td class={e.killed ? 'good' : e.died ? 'bad' : ''}>{e.killed ? (e.headshot ? 'kill hs' : 'kill') : e.died ? 'died' : 'dmg'}</td>
          <td>{e.crosshairErrorDeg >= 0 ? `${e.crosshairErrorDeg.toFixed(1)}°` : '-'}</td>
          <td>{e.reactionMs >= 0 ? Math.round(e.reactionMs) : '-'}</td>
          <td>{e.hits}/{e.shots}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .ballistics {
    padding: 14px 16px 24px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }

  .pick select {
    flex: 1;
  }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--rule);
  }

  .m {
    display: flex;
    flex-direction: column;
    padding: 10px 0 10px;
    border-bottom: 1px solid var(--rule);
  }

  .m:nth-child(odd) {
    padding-right: 12px;
    border-right: 1px solid var(--rule);
  }

  .m:nth-child(even) {
    padding-left: 14px;
  }

  .m b {
    font-size: 20px;
    font-weight: 500;
    margin: 2px 0 0;
  }

  .ref {
    font-size: 11.5px;
    color: var(--pencil);
  }

  .row {
    font-size: 12.5px;
    margin: 10px 0 0;
  }

  .note {
    font-size: 11.5px;
    margin: 10px 0 14px;
  }

  .chart {
    padding: 12px 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    margin-bottom: 8px;
  }

  .chart-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin-bottom: 8px;
  }

  .chart-head strong {
    font-family: var(--serif);
    font-weight: 600;
    flex: 1;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 12px 0 4px;
  }

  .filters button {
    font-size: 11.5px;
    padding: 2px 8px;
  }

  .spacer {
    flex: 1;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  th {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--pencil);
    font-weight: 500;
    text-align: right;
    padding: 6px 4px;
    border-bottom: 1px solid var(--rule);
  }

  td {
    text-align: right;
    padding: 5px 4px;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
  }

  .l {
    text-align: left;
    font-family: var(--sans);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--desk-2);
  }

  tr.selected {
    background: var(--desk-3) !important;
  }
</style>
