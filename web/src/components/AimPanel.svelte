<script lang="ts">
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
  })

  const list = $derived(
    r.engagements.filter(
      (e) => e.attacker === player && (filter === 'all' || (filter === 'won' ? e.killed : e.died)),
    ),
  )
  const selected = $derived(r.engagements[v.engagement] && r.engagements[v.engagement].attacker === player ? r.engagements[v.engagement] : null)

  function open(e: Engagement) {
    v.engagement = e.id
    v.seek(Math.max(e.startTick, (e.firstSeenTick >= 0 ? e.firstSeenTick : e.startTick) - r.rate))
    v.follow = e.attacker
    v.focus = [e.attacker, e.victim]
    v.speed = 0.25
    v.playing = true
  }

  const fmt = (n: number, unit: string, digits = 0) => (n < 0 ? '-' : `${n.toFixed(digits)}${unit}`)
  // lower is better for all of these, colour against the lobby median
  const tone = (n: number, ref: number) => (n < 0 || ref < 0 ? '' : n <= ref * 0.9 ? 'good' : n >= ref * 1.25 ? 'bad' : '')
</script>

<div class="aim">
  <label class="pick">
    <span class="muted">Player</span>
    <select value={player} onchange={(e) => (v.inspect = Number((e.currentTarget as HTMLSelectElement).value))}>
      {#each players as p (p.index)}<option value={p.index}>{p.name}</option>{/each}
    </select>
  </label>

  {#if summary}
    <div class="metrics">
      <div class="metric">
        <span class="label">Crosshair placement</span>
        <span class="value {tone(summary.crosshairErrorDeg, lobby.crosshair)}">{fmt(summary.crosshairErrorDeg, '°', 1)}</span>
        <span class="ref">game {fmt(lobby.crosshair, '°', 1)}</span>
      </div>
      <div class="metric">
        <span class="label">Reaction</span>
        <span class="value {tone(summary.reactionMs, lobby.reaction)}">{fmt(summary.reactionMs, ' ms')}</span>
        <span class="ref">game {fmt(lobby.reaction, ' ms')}</span>
      </div>
      <div class="metric">
        <span class="label">Time to damage</span>
        <span class="value {tone(summary.timeToDamageMs, lobby.ttd)}">{fmt(summary.timeToDamageMs, ' ms')}</span>
        <span class="ref">game {fmt(lobby.ttd, ' ms')}</span>
      </div>
      <div class="metric">
        <span class="label">First shot error</span>
        <span class="value {tone(summary.firstShotErrorDeg, lobby.firstShot)}">{fmt(summary.firstShotErrorDeg, '°', 1)}</span>
        <span class="ref">game {fmt(lobby.firstShot, '°', 1)}</span>
      </div>
      <div class="metric">
        <span class="label">Duels</span>
        <span class="value">{summary.duelsWon} - {summary.duelsLost}</span>
        <span class="ref">{summary.noShotDeaths} lost without a shot</span>
      </div>
      <div class="metric">
        <span class="label">Duel accuracy</span>
        <span class="value">{summary.duelAccuracy}%</span>
        <span class="ref">{summary.headshotRate}% headshot kills · {summary.prefires} prefires</span>
      </div>
    </div>
  {/if}

  <p class="note">
    Crosshair placement is how far the crosshair was from the enemy's head the moment they showed up. Reaction is the time from
    the enemy being spotted to the first shot. Spotting comes from the game's own radar, so it can trail real line of sight by a
    few ticks.
  </p>

  {#if selected}
    <div class="chart">
      <div class="chart-head">
        <strong>R{selected.round + 1} vs {r.playerName(selected.victim)}</strong>
        <span class="muted">{weaponName(selected.weapon)}</span>
      </div>
      <AimChart {r} e={selected} tick={v.tick} />
    </div>
  {/if}

  <div class="filters">
    <span class="muted">{list.length} duels</span>
    <span class="spacer"></span>
    {#each [['all', 'All'], ['won', 'Won'], ['lost', 'Lost']] as [id, label] (id)}
      <button class:active={filter === id} onclick={() => (filter = id as typeof filter)}>{label}</button>
    {/each}
  </div>
  <table>
    <thead>
      <tr><th>Rd</th><th class="l">Opponent</th><th>Result</th><th title="Crosshair distance when spotted">Xhair</th><th title="Spotted to first shot">React</th><th title="Hits / shots">Hits</th></tr>
    </thead>
    <tbody>
      {#each list as e (e.id)}
        <tr class:selected={selected?.id === e.id} onclick={() => open(e)}>
          <td>{e.round + 1}</td>
          <td class="l">{r.playerName(e.victim)} <span class="muted">{weaponName(e.weapon)}</span></td>
          <td class={e.killed ? 'won' : e.died ? 'lost' : ''}>{e.killed ? (e.headshot ? 'kill HS' : 'kill') : e.died ? 'died' : 'damage'}</td>
          <td class="mono">{e.crosshairErrorDeg >= 0 ? `${e.crosshairErrorDeg.toFixed(1)}°` : '-'}</td>
          <td class="mono">{e.reactionMs >= 0 ? `${Math.round(e.reactionMs)}` : '-'}</td>
          <td class="mono">{e.hits}/{e.shots}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .aim {
    padding: 10px 12px 20px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .pick select {
    flex: 1;
  }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .metric {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
  }

  .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .value {
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .value.good {
    color: var(--good);
  }

  .value.bad {
    color: var(--bad);
  }

  .ref {
    font-size: 11px;
    color: var(--text-2);
  }

  .note {
    font-size: 11.5px;
    color: var(--muted);
    margin: 10px 0;
  }

  .chart {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }

  .chart-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 6px 0;
  }

  .filters button {
    padding: 3px 9px;
    font-size: 12px;
  }

  .spacer {
    flex: 1;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  th {
    font-size: 11px;
    color: var(--muted);
    font-weight: 600;
    text-align: right;
    padding: 5px 4px;
    border-bottom: 1px solid var(--line);
  }

  td {
    text-align: right;
    padding: 4px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  .l {
    text-align: left;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--panel-2);
  }

  tr.selected {
    background: #1d2633 !important;
  }

  .won {
    color: var(--good);
  }

  .lost {
    color: var(--bad);
  }
</style>
