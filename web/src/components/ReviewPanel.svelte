<script lang="ts">
  import { money, pct } from '../lib/format'
  import type { Insight, SideRecord } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  let team = $state(0)
  let filter = $state<'all' | 'problems' | 'good'>('all')

  const ts = $derived(report.teams[team])
  const insights = $derived(
    report.insights.filter(
      (i: Insight) =>
        i.team === team &&
        (filter === 'all' || (filter === 'good' ? i.severity === 'positive' : i.severity !== 'positive')),
    ),
  )
  const teamLevel = $derived(insights.filter((i) => i.player < 0))
  const playerLevel = $derived(insights.filter((i) => i.player >= 0))

  const rec = (s: SideRecord | undefined) => (s && s.played ? `${s.won}/${s.played}` : '-')
  const rate = (s: SideRecord | undefined) => (s && s.played ? pct(s.won, s.played) : '')
</script>

<div class="review">
  <div class="teams">
    {#each [0, 1] as t (t)}
      <button class:active={team === t} onclick={() => (team = t)}>{r.teamName(t)}</button>
    {/each}
  </div>

  <div class="tiles">
    <div class="tile">
      <span class="label">Rounds</span>
      <span class="value">{r.match.teams[team].score}</span>
      <span class="sub"><span class="ct">CT {rec(ts.sides.CT)}</span> · <span class="t">T {rec(ts.sides.T)}</span></span>
    </div>
    <div class="tile">
      <span class="label">Opening duels</span>
      <span class="value">{ts.openingKills} - {ts.openingDeaths}</span>
      <span class="sub">won {pct(ts.openingKills, ts.openingKills + ts.openingDeaths)}</span>
    </div>
    <div class="tile">
      <span class="label">Deaths traded</span>
      <span class="value">{Math.round(ts.tradeRate)}%</span>
      <span class="sub">{ts.tradedDeaths} of {ts.deaths}, mate {Math.round(ts.avgTeammateDistance)}u away</span>
    </div>
    <div class="tile">
      <span class="label">After first kill</span>
      <span class="value">{rec(ts.advantageRounds)}</span>
      <span class="sub">after first death {rec(ts.disadvantageRounds)}</span>
    </div>
    <div class="tile">
      <span class="label">Pistols</span>
      <span class="value">{rec(ts.pistol)}</span>
      <span class="sub">anti eco {rec(ts.antiEco)}</span>
    </div>
    <div class="tile">
      <span class="label">Post plant / retake</span>
      <span class="value">{rec(ts.plants)} · {rec(ts.retakes)}</span>
      <span class="sub">{rate(ts.plants) || '-'} / {rate(ts.retakes) || '-'}</span>
    </div>
    <div class="tile">
      <span class="label">Utility per round</span>
      <span class="value">{ts.utilPerRound}</span>
      <span class="sub">{money(ts.unusedUtility)} died unused</span>
    </div>
    <div class="tile">
      <span class="label">Team flashes</span>
      <span class="value">{ts.teamFlashes}</span>
      <span class="sub">{ts.teamBlindTime}s of blind teammates</span>
    </div>
    <div class="tile wide">
      <span class="label">Buys won</span>
      <span class="buys">
        {#each ['pistol', 'eco', 'force', 'full'] as b (b)}
          <span><span class="muted">{b}</span> {rec(ts.buys[b])}</span>
        {/each}
      </span>
      <span class="sub">{ts.firstContact >= 0 ? `first contact after ${ts.firstContact}s on average` : 'no damage data in this demo'}</span>
    </div>
  </div>

  <div class="filters">
    <span class="muted">Findings</span>
    <span class="spacer"></span>
    {#each [['all', 'All'], ['problems', 'Problems'], ['good', 'Good']] as [id, label] (id)}
      <button class:active={filter === id} onclick={() => (filter = id as typeof filter)}>{label}</button>
    {/each}
  </div>

  {#if insights.length === 0}
    <p class="muted empty">Nothing stood out here.</p>
  {/if}
  {#each teamLevel as ins (ins.id + ins.player)}
    <InsightCard {v} {ins} />
  {/each}
  {#if playerLevel.length}
    <h3>Players</h3>
    {#each playerLevel as ins (ins.id + ins.player)}
      <InsightCard {v} {ins} />
    {/each}
  {/if}
</div>

<style>
  .review {
    padding: 10px 12px 20px;
  }

  .teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 10px;
  }

  .teams button {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .tile {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .tile.wide {
    grid-column: span 2;
  }

  .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .value {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .sub {
    font-size: 11.5px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .buys {
    display: flex;
    gap: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 2px 0;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 16px 0 8px;
  }

  .filters button {
    padding: 3px 9px;
    font-size: 12px;
  }

  .spacer {
    flex: 1;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
    margin: 16px 0 8px;
  }

  .empty {
    padding: 10px 0;
  }
</style>
