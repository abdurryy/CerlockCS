<script lang="ts">
  import { money } from '../lib/format'
  import type { Insight, SideRecord } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  let team = $state(0)
  let filter = $state<'all' | 'problems' | 'good'>('all')

  const ts = $derived(report.teams[team])
  const mine = $derived(report.insights.filter((i: Insight) => i.team === team))
  const insights = $derived(mine.filter((i) => filter === 'all' || (filter === 'good' ? i.severity === 'positive' : i.severity !== 'positive')))
  const teamLevel = $derived(insights.filter((i) => i.player < 0))
  const playerLevel = $derived(insights.filter((i) => i.player >= 0))
  const counts = $derived({
    high: mine.filter((i) => i.severity === 'high').length,
    medium: mine.filter((i) => i.severity === 'medium').length,
    good: mine.filter((i) => i.severity === 'positive').length,
  })
  const blunders = $derived(r.blunders.filter((b) => b.team === team))
  const thrown = $derived(blunders.reduce((a, b) => a + (b.cost > 0 ? b.cost : 0), 0))
  const headline = $derived(mine.find((i) => i.severity === 'high') ?? mine.find((i) => i.severity === 'medium'))

  const buys = [
    ['eco', 'Eco rounds won'],
    ['force', 'Force buys won'],
    ['full', 'Full buys won'],
  ]
  const rec = (s: SideRecord | undefined) => (s && s.played ? `${s.won} / ${s.played}` : '-')
</script>

<div class="briefing">
  <div class="teams">
    {#each [0, 1] as t (t)}
      <button class:active={team === t} onclick={() => (team = t)}>{r.teamName(t)}</button>
    {/each}
  </div>

  <section class="verdict">
    <span class="label">Verdict</span>
    {#if headline}
      <p class="lead">{headline.title}.</p>
    {:else}
      <p class="lead">Nothing serious stood out.</p>
    {/if}
    <p class="dim">
      {counts.high} serious {counts.high === 1 ? 'problem' : 'problems'}, {counts.medium} to look at and {counts.good} {counts.good === 1 ? 'thing' : 'things'} that went well.
      {blunders.length} blunders, worth about {thrown.toFixed(1)} {thrown.toFixed(1) === '1.0' ? 'round' : 'rounds'} of win chance added up.
    </p>
  </section>

  <section class="ledger">
    <div class="group">
      <span class="label">Rounds</span>
      <div class="entry"><span>Won</span><i></i><b>{r.match.teams[team].score} of {r.match.rounds.length}</b></div>
      <div class="entry"><span class="ct">CT side</span><i></i><b>{rec(ts.sides.CT)}</b></div>
      <div class="entry"><span class="t">T side</span><i></i><b>{rec(ts.sides.T)}</b></div>
      <div class="entry"><span>Pistol rounds</span><i></i><b>{rec(ts.pistol)}</b></div>
    </div>
    <div class="group">
      <span class="label">Duels</span>
      <div class="entry"><span>Opening duels won</span><i></i><b>{ts.openingKills} of {ts.openingKills + ts.openingDeaths}</b></div>
      <div class="entry"><span>Rounds won after first kill</span><i></i><b>{rec(ts.advantageRounds)}</b></div>
      <div class="entry"><span>Rounds won after first death</span><i></i><b>{rec(ts.disadvantageRounds)}</b></div>
      <div class="entry"><span>Deaths traded</span><i></i><b>{Math.round(ts.tradeRate)}%</b></div>
      <div class="entry"><span>Closest teammate at death</span><i></i><b>{Math.round(ts.avgTeammateDistance)} u</b></div>
    </div>
    <div class="group">
      <span class="label">Economy</span>
      {#each buys as [b, label] (b)}
        <div class="entry"><span>{label}</span><i></i><b>{rec(ts.buys[b])}</b></div>
      {/each}
      <div class="entry"><span>Full buy against eco or force</span><i></i><b>{rec(ts.antiEco)}</b></div>
    </div>
    <div class="group">
      <span class="label">Bomb and utility</span>
      <div class="entry"><span>Post plants won</span><i></i><b>{rec(ts.plants)}</b></div>
      <div class="entry"><span>Retakes won</span><i></i><b>{rec(ts.retakes)}</b></div>
      <div class="entry"><span>Grenades per round</span><i></i><b>{ts.utilPerRound}</b></div>
      <div class="entry"><span>Teammates flashed</span><i></i><b>{ts.teamFlashes} · {ts.teamBlindTime} s</b></div>
      <div class="entry"><span>Utility that died unused</span><i></i><b>{money(ts.unusedUtility)}</b></div>
      <div class="entry"><span>First contact</span><i></i><b>{ts.firstContact >= 0 ? `${ts.firstContact} s in` : '-'}</b></div>
    </div>
  </section>

  <div class="filters">
    <span class="label">Findings · {insights.length}</span>
    <span class="spacer"></span>
    {#each [['all', 'All'], ['problems', 'Problems'], ['good', 'Good']] as [id, label] (id)}
      <button class:on={filter === id} onclick={() => (filter = id as typeof filter)}>{label}</button>
    {/each}
  </div>

  {#if insights.length === 0}
    <p class="dim empty">Nothing here.</p>
  {/if}
  {#each teamLevel as ins (ins.id + ins.player)}
    <InsightCard {v} {ins} />
  {/each}
  {#if playerLevel.length}
    <div class="sub label">Players</div>
    {#each playerLevel as ins (ins.id + ins.player)}
      <InsightCard {v} {ins} />
    {/each}
  {/if}
  <p class="foot faint">Win chance comes from a simple model of players alive and the bomb, so treat the percentages as estimates.</p>
</div>

<style>
  .briefing {
    padding: 14px 16px 24px;
  }

  .teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 16px;
  }

  .teams button {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    font-family: var(--serif);
    font-size: 15px;
    font-weight: 600;
    color: var(--pencil);
    padding: 6px 4px 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .teams button:hover {
    background: transparent;
    color: var(--graphite);
  }

  .teams button.active {
    color: var(--paper);
    border-bottom-color: var(--marker);
  }

  .verdict {
    margin-bottom: 18px;
  }

  .lead {
    font-family: var(--serif);
    font-size: 21px;
    line-height: 1.25;
    font-weight: 500;
    margin: 6px 0 6px;
    font-variation-settings: 'opsz' 60;
  }

  .verdict .dim {
    margin: 0;
    font-size: 12.5px;
  }

  .ledger {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 14px 0 6px;
    border-top: 1px solid var(--rule);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .group .label {
    margin-bottom: 2px;
  }

  .entry {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
  }

  .entry span {
    color: var(--graphite);
    white-space: nowrap;
  }

  .entry i {
    flex: 1;
    border-bottom: 1px dotted var(--rule-2);
    transform: translateY(-3px);
  }

  .entry b {
    font-family: var(--mono);
    font-weight: 500;
    font-size: 12px;
    white-space: nowrap;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 22px 0 10px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
  }

  .filters button {
    font-size: 11.5px;
    padding: 2px 8px;
  }

  .spacer {
    flex: 1;
  }

  .sub {
    margin: 18px 0 6px;
  }

  .empty {
    padding: 8px 0;
  }

  .foot {
    font-size: 11px;
    margin-top: 18px;
  }
</style>
