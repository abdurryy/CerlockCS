<script lang="ts">
  import { money } from '../lib/format'
  import type { PlayerStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  type Key = 'kills' | 'deaths' | 'assists' | 'adr' | 'kast' | 'rating' | 'hs'
  let sortBy = $state<Key>('rating')

  const value = (s: PlayerStats, k: Key) => (k === 'hs' ? (s.kills ? s.headshots / s.kills : 0) : s[k])
  const rows = $derived(
    [...report.players]
      .filter((s) => s.rounds > 0)
      .sort((a, b) => value(b, sortBy) - value(a, sortBy) || a.player - b.player),
  )

  const selected = $derived(v.inspect >= 0 ? v.inspect : v.follow)
  const st = $derived(selected >= 0 ? report.players[selected] : null)
  const insights = $derived(report.insights.filter((i) => i.player === selected))

  const cols: { key: Key; label: string; title: string }[] = [
    { key: 'kills', label: 'K', title: 'Kills' },
    { key: 'deaths', label: 'D', title: 'Deaths' },
    { key: 'assists', label: 'A', title: 'Assists' },
    { key: 'adr', label: 'ADR', title: 'Average damage per round' },
    { key: 'kast', label: 'KAST', title: 'Rounds with a kill, assist, survival or trade' },
    { key: 'hs', label: 'HS', title: 'Headshot kills' },
    { key: 'rating', label: 'Rating', title: 'HLTV 1.0 rating' },
  ]

  function pick(p: number) {
    v.inspect = v.inspect === p ? -1 : p
  }

  function heat(kind: 'positions' | 'deaths' | 'kills') {
    if (selected < 0) return
    v.heat = { label: `${r.playerName(selected)}, ${kind}`, players: [selected], kind, side: 0 }
  }
</script>

<div class="players">
  <table>
    <thead>
      <tr>
        <th class="name">Player</th>
        {#each cols as c (c.key)}
          <th class:sorted={sortBy === c.key} title={c.title} onclick={() => (sortBy = c.key)}>{c.label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as s (s.player)}
        {@const team = r.match.players[s.player].team}
        <tr class:selected={selected === s.player} onclick={() => pick(s.player)}>
          <td class="name"><span class="dot {r.sideOf(team, 0) === 3 ? 'ct' : 't'}"></span>{r.playerName(s.player)}</td>
          <td>{s.kills}</td>
          <td>{s.deaths}</td>
          <td>{s.assists}</td>
          <td>{s.adr.toFixed(0)}</td>
          <td>{s.kast.toFixed(0)}%</td>
          <td>{s.kills ? Math.round((s.headshots / s.kills) * 100) : 0}%</td>
          <td class="rating" class:good={s.rating >= 1.15} class:bad={s.rating < 0.85}>{s.rating.toFixed(2)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if st}
    <section class="detail">
      <header>
        <strong>{r.playerName(st.player)}</strong>
        <span class="actions">
          <button onclick={() => v.setFollow(st.player)}>{v.follow === st.player ? 'Following' : 'Follow'}</button>
          <button onclick={() => { v.inspect = st.player; v.tab = 'aim' }}>Aim</button>
        </span>
      </header>
      <div class="grid">
        <div><span>Opening duels</span><b>{st.openingKills} - {st.openingDeaths}</b></div>
        <div><span>Trade kills</span><b>{st.tradeKills}</b></div>
        <div><span>Deaths traded</span><b>{st.tradedDeaths} / {st.deaths}</b></div>
        <div><span>Isolated deaths</span><b>{st.isolatedDeaths}</b></div>
        <div><span>Early deaths</span><b>{st.earlyDeaths}</b></div>
        <div><span>Died blind</span><b>{st.blindDeaths}</b></div>
        <div><span>Clutches</span><b>{st.clutchesWon} / {st.clutchesPlayed}</b></div>
        <div><span>Multi kills</span><b>{Object.entries(st.multiKills).map(([n, c]) => `${c}x${n}k`).join(' ') || '-'}</b></div>
        <div><span>Accuracy</span><b>{st.accuracy}%</b></div>
        <div><span>Utility damage</span><b>{st.utilityDamage}</b></div>
        <div><span>Flashes</span><b>{st.enemiesFlashed} enemies / {st.flashesThrown}</b></div>
        <div><span>Flash assists</span><b>{st.flashAssists}</b></div>
        <div><span>Team flashed</span><b>{st.teammatesFlashed} ({st.teammateBlindTime}s)</b></div>
        <div><span>Nades thrown</span><b>{st.smokesThrown}S {st.flashesThrown}F {st.heThrown}H {st.molotovsThrown}M</b></div>
        <div><span>Unused utility</span><b>{money(st.unusedUtilityValue)}</b></div>
        <div><span>Damage</span><b>{st.damage}</b></div>
      </div>
      <div class="heat">
        <span class="muted">Heatmap</span>
        <button onclick={() => heat('positions')}>Positions</button>
        <button onclick={() => heat('deaths')}>Deaths</button>
        <button onclick={() => heat('kills')}>Kills</button>
        {#if v.heat}<button onclick={() => (v.heat = null)}>Clear</button>{/if}
      </div>
      {#if insights.length}
        <h3>What to work on</h3>
        {#each insights as ins (ins.id)}
          <InsightCard {v} {ins} />
        {/each}
      {:else}
        <p class="muted">No findings for this player.</p>
      {/if}
    </section>
  {:else}
    <p class="muted hint">Pick a player for their full report.</p>
  {/if}
</div>

<style>
  .players {
    padding: 8px 10px 20px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-align: right;
    padding: 6px 4px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--line);
  }

  th.sorted {
    color: var(--text);
  }

  td {
    text-align: right;
    padding: 5px 4px;
    border-bottom: 1px solid var(--line);
  }

  .name {
    text-align: left;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 6px;
  }

  .dot.ct {
    background: var(--ct);
  }

  .dot.t {
    background: var(--t);
  }

  .rating.good {
    color: var(--good);
  }

  .rating.bad {
    color: var(--bad);
  }

  .detail {
    margin-top: 14px;
  }

  .detail header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
    font-size: 12px;
  }

  .grid div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px dashed var(--line);
  }

  .grid span {
    color: var(--muted);
  }

  .heat {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 12px 0;
    font-size: 12px;
  }

  .heat button {
    padding: 3px 8px;
    font-size: 12px;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
    margin: 14px 0 8px;
  }

  .hint {
    padding: 12px 2px;
  }
</style>
