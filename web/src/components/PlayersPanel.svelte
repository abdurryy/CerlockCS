<script lang="ts">
  import { money } from '../lib/format'
  import type { PlayerStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  type Key = 'kills' | 'deaths' | 'adr' | 'kast' | 'rating' | 'swing' | 'blunders'
  let sortBy = $state<Key>('rating')

  const rows = $derived([...report.players].filter((s) => s.rounds > 0).sort((a, b) => b[sortBy] - a[sortBy] || a.player - b.player))
  const selected = $derived(v.inspect >= 0 ? v.inspect : v.follow)
  const st = $derived(selected >= 0 ? report.players[selected] : null)
  const insights = $derived(report.insights.filter((i) => i.player === selected))

  const cols: { key: Key; label: string; title: string }[] = [
    { key: 'kills', label: 'K', title: 'Kills' },
    { key: 'deaths', label: 'D', title: 'Deaths' },
    { key: 'adr', label: 'ADR', title: 'Average damage per round' },
    { key: 'kast', label: 'KAST', title: 'Rounds with a kill, assist, survival or trade' },
    { key: 'swing', label: 'Swing', title: 'Round win chance added per round' },
    { key: 'blunders', label: 'Ev', title: 'Blunders (evidence)' },
    { key: 'rating', label: 'Rtg', title: 'HLTV 1.0 rating' },
  ]

  function pick(p: number) {
    v.inspect = v.inspect === p ? -1 : p
  }

  function heat(kind: 'positions' | 'deaths' | 'kills') {
    if (selected < 0) return
    v.heat = { label: `${r.playerName(selected)} ${kind}`, players: [selected], kind, side: 0 }
  }

  function top(m: Record<string, number> | null | undefined, n = 4): [string, number][] {
    return Object.entries(m ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
  }

  const signed = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`
  const teamSide = (s: PlayerStats) => r.sideOf(r.match.players[s.player].team, 0)
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
        <tr class:selected={selected === s.player} onclick={() => pick(s.player)}>
          <td class="name"><i class={teamSide(s) === 3 ? 'ct' : 't'}></i>{r.playerName(s.player)}</td>
          <td>{s.kills}</td>
          <td>{s.deaths}</td>
          <td>{s.adr.toFixed(0)}</td>
          <td>{s.kast.toFixed(0)}</td>
          <td class:good={s.swing >= 3} class:bad={s.swing <= -3}>{signed(s.swing)}</td>
          <td class:warn={s.blunders >= 4}>{s.blunders}</td>
          <td class:good={s.rating >= 1.15} class:bad={s.rating < 0.85}>{s.rating.toFixed(2)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if st}
    <section class="file">
      <header>
        <div>
          <span class="label">Player file</span>
          <h2>{r.playerName(st.player)}</h2>
        </div>
        <span class="actions">
          <button class:on={v.follow === st.player} onclick={() => v.setFollow(st.player)}>{v.follow === st.player ? 'following' : 'follow'}</button>
          <button onclick={() => { v.inspect = st.player; v.tab = 'ballistics' }}>ballistics</button>
        </span>
      </header>

      <div class="sides">
        <span></span><span class="label">K</span><span class="label">D</span><span class="label">ADR</span><span class="label">KAST</span>
        {#each ['CT', 'T'] as side (side)}
          {@const s = st.sides?.[side]}
          {#if s}
            <span class={side === 'CT' ? 'ct' : 't'}>{side} · {s.rounds} rds</span>
            <span class="mono">{s.kills}</span><span class="mono">{s.deaths}</span><span class="mono">{s.adr.toFixed(0)}</span><span class="mono">{s.kast.toFixed(0)}%</span>
          {/if}
        {/each}
      </div>

      <div class="cols">
        <div class="group">
          <span class="label">Impact</span>
          <div class="entry"><span>Round swing</span><i></i><b>{signed(st.swing)}%</b></div>
          <div class="entry"><span>Kills / deaths per round</span><i></i><b>{st.kpr} / {st.dpr}</b></div>
          <div class="entry"><span>Opening duels</span><i></i><b>{st.openingKills} - {st.openingDeaths}</b></div>
          <div class="entry"><span>Clutches won</span><i></i><b>{st.clutchesWon} / {st.clutchesPlayed}</b></div>
          <div class="entry"><span>Multi kills</span><i></i><b>{Object.entries(st.multiKills).map(([n, c]) => `${c}×${n}k`).join(' ') || '-'}</b></div>
          <div class="entry"><span>Damage</span><i></i><b>{st.damage}</b></div>
        </div>
        <div class="group">
          <span class="label">Teamwork</span>
          <div class="entry"><span>Trade kills</span><i></i><b>{st.tradeKills}{st.avgTradeTime ? ` · ${st.avgTradeTime}s` : ''}</b></div>
          <div class="entry"><span>Deaths traded</span><i></i><b>{st.tradedDeaths} / {st.deaths}</b></div>
          <div class="entry"><span>Isolated deaths</span><i></i><b>{st.isolatedDeaths}</b></div>
          <div class="entry"><span>Early deaths</span><i></i><b>{st.earlyDeaths}</b></div>
          <div class="entry"><span>Time alive per round</span><i></i><b>{st.timeAlive}s</b></div>
          <div class="entry"><span>Moved per round</span><i></i><b>{Math.round(st.travel / 52.5)} m</b></div>
        </div>
        <div class="group">
          <span class="label">Shooting</span>
          <div class="entry"><span>Shots while still</span><i></i><b>{st.counterStrafe}%</b></div>
          <div class="entry"><span>Shots on the run</span><i></i><b>{st.runningShots}</b></div>
          <div class="entry"><span>Accuracy</span><i></i><b>{st.accuracy}%</b></div>
          <div class="entry"><span>Headshot kills</span><i></i><b>{st.kills ? Math.round((st.headshots / st.kills) * 100) : 0}%</b></div>
          <div class="entry"><span>Kill distance</span><i></i><b>{st.avgKillDistance ? `${st.avgKillDistance} m` : '-'}</b></div>
          <div class="entry"><span>Died blind</span><i></i><b>{st.blindDeaths}</b></div>
        </div>
        <div class="group">
          <span class="label">Utility</span>
          <div class="entry"><span>Thrown</span><i></i><b>{st.smokesThrown}s {st.flashesThrown}f {st.heThrown}h {st.molotovsThrown}m</b></div>
          <div class="entry"><span>Enemies flashed</span><i></i><b>{st.enemiesFlashed} · {st.blindPerFlash}s per flash</b></div>
          <div class="entry"><span>Flash assists</span><i></i><b>{st.flashAssists}</b></div>
          <div class="entry"><span>HE / molotov damage</span><i></i><b>{st.heDamagePerNade} / {st.fireDamagePerNade} per nade</b></div>
          <div class="entry"><span>Teammates flashed</span><i></i><b>{st.teammatesFlashed} · {st.teammateBlindTime}s</b></div>
          <div class="entry"><span>Died unused</span><i></i><b>{money(st.unusedUtilityValue)}</b></div>
        </div>
      </div>

      <div class="cols two">
        <div class="group">
          <span class="label">Kills by weapon</span>
          {#each top(st.weaponKills, 5) as [w, n] (w)}
            <div class="entry"><span>{w}</span><i></i><b>{n}</b></div>
          {/each}
        </div>
        <div class="group">
          <span class="label">Where they fight</span>
          {#each top(st.killPlaces, 3) as [p, n] (p)}
            <div class="entry"><span>Kills at {p}</span><i></i><b>{n}</b></div>
          {/each}
          {#each top(st.deathPlaces, 3) as [p, n] (p)}
            <div class="entry"><span>Deaths at {p}</span><i></i><b class="bad">{n}</b></div>
          {/each}
        </div>
      </div>

      <div class="heat">
        <span class="label">Heatmap</span>
        <button onclick={() => heat('positions')}>positions</button>
        <button onclick={() => heat('deaths')}>deaths</button>
        <button onclick={() => heat('kills')}>kills</button>
        {#if v.heat}<button class="plain" onclick={() => (v.heat = null)}>clear</button>{/if}
      </div>

      {#if st.blunders}
        <button class="evidence" onclick={() => (v.tab = 'evidence')}>
          {st.blunders} pieces of evidence, about {Math.round(st.blunderCost)}% of a round thrown away
        </button>
      {/if}

      <span class="label findings">What to work on</span>
      {#each insights as ins (ins.id)}
        <InsightCard {v} {ins} />
      {:else}
        <p class="dim">No findings for this player.</p>
      {/each}
    </section>
  {:else}
    <p class="dim hint">Pick a player to open their file.</p>
  {/if}
</div>

<style>
  .players {
    padding: 10px 14px 24px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  th {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--pencil);
    text-align: right;
    padding: 8px 4px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--rule);
  }

  th.sorted {
    color: var(--paper);
    box-shadow: inset 0 -2px 0 var(--marker);
  }

  td {
    text-align: right;
    padding: 6px 4px;
    border-bottom: 1px solid var(--rule);
  }

  .name {
    text-align: left;
    font-family: var(--sans);
    max-width: 118px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  td.name i {
    display: inline-block;
    width: 2px;
    height: 10px;
    margin-right: 7px;
    vertical-align: -1px;
  }

  i.ct {
    background: var(--ct);
  }

  i.t {
    background: var(--t);
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

  .warn {
    color: var(--evidence);
  }

  .file {
    margin-top: 18px;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 12px;
  }

  h2 {
    font-size: 22px;
    font-variation-settings: 'opsz' 60;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .actions button {
    font-family: var(--mono);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .sides {
    display: grid;
    grid-template-columns: 1fr 40px 40px 48px 52px;
    gap: 4px 8px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
    text-align: right;
  }

  .sides > :nth-child(5n + 1) {
    text-align: left;
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 14px 0;
  }

  .cols.two {
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--rule);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .group .label {
    margin-bottom: 3px;
  }

  .entry {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
    min-width: 0;
  }

  .entry span {
    color: var(--graphite);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entry i {
    flex: 1;
    min-width: 8px;
    border-bottom: 1px dotted var(--rule-2);
    transform: translateY(-3px);
  }

  .entry b {
    font-family: var(--mono);
    font-weight: 500;
    font-size: 12px;
    white-space: nowrap;
  }

  .heat {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }

  .heat .label {
    margin-right: 6px;
  }

  .heat button {
    font-family: var(--mono);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 3px 8px;
  }

  .evidence {
    width: 100%;
    text-align: left;
    margin: 6px 0 4px;
    border-color: rgba(242, 193, 78, 0.35);
    color: var(--evidence);
  }

  .findings {
    display: block;
    margin: 16px 0 4px;
  }

  .hint {
    padding: 14px 2px;
  }
</style>
