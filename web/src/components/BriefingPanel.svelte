<script lang="ts">
  import { money } from '../lib/format'
  import type { Insight, SideRecord, TeamStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import GameIcon from './GameIcon.svelte'
  import Icon from './Icon.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  let team = $state(0)
  let filter = $state<'all' | 'problems' | 'good'>('all')

  const ts = $derived(report.teams[team])
  const them = $derived(report.teams[1 - team])
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
  const sideNow = (t: number) => r.sideOf(t, v.round)

  const rec = (s: SideRecord | undefined) => (s && s.played ? `${s.won}/${s.played}` : '-')
  const rate = (s: SideRecord | undefined) => (s && s.played ? (s.won / s.played) * 100 : NaN)

  interface Row {
    label: string
    value: string
    other?: string
    // Positive when this team does better than the other one.
    edge?: number
  }

  // A record compared with the other team. Only clear gaps get a colour.
  function record(label: string, get: (s: TeamStats) => SideRecord | undefined): Row {
    const a = rate(get(ts))
    const b = rate(get(them))
    const edge = Number.isNaN(a) || Number.isNaN(b) || Math.abs(a - b) < 10 ? 0 : Math.sign(a - b)
    return { label, value: rec(get(ts)), other: rec(get(them)), edge }
  }

  // A plain number compared with the other team. lower says when less is
  // better. Percentages compare in points, other numbers relative to size.
  function amount(label: string, a: number, b: number, show: (n: number) => string, lower = false, points = false): Row {
    const d = points ? (a - b) / 8 : (a - b) / (0.15 * Math.max(Math.abs(a), Math.abs(b), 1e-9))
    const edge = Math.abs(d) < 1 ? 0 : Math.sign(d) * (lower ? -1 : 1)
    return { label, value: show(a), other: show(b), edge }
  }

  const tiles = $derived([
    { label: 'Won', won: r.match.teams[team].score, of: r.match.rounds.length, cls: '' },
    { label: 'CT side', won: ts.sides.CT?.won ?? 0, of: ts.sides.CT?.played ?? 0, cls: 'ct' },
    { label: 'T side', won: ts.sides.T?.won ?? 0, of: ts.sides.T?.played ?? 0, cls: 't' },
    { label: 'Pistols', won: ts.pistol.won, of: ts.pistol.played, cls: '' },
  ])

  const groups = $derived<{ label: string; rows: Row[] }[]>([
    {
      label: 'Duels',
      rows: [
        record('Opening duels won', (s) => ({ won: s.openingKills, played: s.openingKills + s.openingDeaths })),
        record('Rounds won after first kill', (s) => s.advantageRounds),
        record('Rounds won after first death', (s) => s.disadvantageRounds),
        amount('Deaths traded', ts.tradeRate, them.tradeRate, (n) => `${Math.round(n)}%`, false, true),
        amount('Closest teammate at death', ts.avgTeammateDistance, them.avgTeammateDistance, (n) => `${Math.round(n)} u`, true),
      ],
    },
    {
      label: 'Economy',
      rows: [
        record('Eco rounds won', (s) => s.buys.eco),
        record('Force buys won', (s) => s.buys.force),
        record('Full buys won', (s) => s.buys.full),
        record('Full buy against eco or force', (s) => s.antiEco),
      ],
    },
    {
      label: 'Bomb and utility',
      rows: [
        record('Post plants won', (s) => s.plants),
        record('Retakes won', (s) => s.retakes),
        amount('Grenades per round', ts.utilPerRound, them.utilPerRound, (n) => `${n}`),
        {
          ...amount('Teammates flashed', ts.teamFlashes, them.teamFlashes, (n) => `${n}`, true),
          value: `${ts.teamFlashes} · ${ts.teamBlindTime} s`,
          other: `${them.teamFlashes} · ${them.teamBlindTime} s`,
        },
        amount('Utility that died unused', ts.unusedUtility, them.unusedUtility, money, true),
        { label: 'First contact', value: ts.firstContact >= 0 ? `${ts.firstContact} s in` : '-' },
      ],
    },
  ])

  const filters = [
    ['all', 'All'],
    ['problems', 'Problems'],
    ['good', 'Good'],
  ] as const
</script>

<div class="briefing">
  <div class="teams" role="tablist" aria-label="Team">
    {#each [0, 1] as t (t)}
      {@const side = sideNow(t)}
      <button role="tab" aria-selected={team === t} class:active={team === t} onclick={() => (team = t)}>
        <GameIcon name={side === 3 ? 'kill/ct' : 'kill/t'} h={20} title={side === 3 ? 'CT' : 'T'} />
        <span class="name">{r.teamName(t)}</span>
        <span class="score num" class:ct={side === 3} class:t={side === 2}>{r.match.teams[t].score}</span>
      </button>
    {/each}
  </div>

  <section class="verdict">
    <span class="label">Verdict</span>
    <p class="lead">{headline ? `${headline.title}.` : 'Nothing serious stood out.'}</p>
    <div class="counts">
      <button class="count high" class:zero={!counts.high} onclick={() => (filter = 'problems')} title="Show problems">
        <b class="num">{counts.high}</b>Serious
      </button>
      <button class="count medium" class:zero={!counts.medium} onclick={() => (filter = 'problems')} title="Show problems">
        <b class="num">{counts.medium}</b>Look at
      </button>
      <button class="count good" class:zero={!counts.good} onclick={() => (filter = 'good')} title="Show what went well">
        <b class="num">{counts.good}</b>Went well
      </button>
    </div>
    <button class="evlink" onclick={() => (v.tab = 'evidence')} title="Win chance lost to single mistakes, added up. Open the Evidence tab.">
      <span class="marker num">{blunders.length}</span>
      <span class="evtext">
        {blunders.length === 1 ? 'piece' : 'pieces'} of evidence <i>·</i> <b class="num">{thrown.toFixed(1)}</b>
        {thrown.toFixed(1) === '1.0' ? 'round' : 'rounds'} thrown
      </span>
      <Icon name="back" size={14} />
    </button>
  </section>

  <section>
    <h3 class="label">Rounds</h3>
    <div class="strip">
      {#each tiles as x (x.label)}
        <div class="cell">
          <b class="num">{x.of ? x.won : '-'}<small>{x.of ? `/${x.of}` : ''}</small></b>
          <span class={x.cls}>{x.label}</span>
        </div>
      {/each}
    </div>
  </section>

  {#each groups as g (g.label)}
    <section>
      <div class="ghead">
        <h3 class="label">{g.label}</h3>
        <span class="label vs" title="{r.teamName(1 - team)}, the other team">
          <GameIcon name={sideNow(1 - team) === 3 ? 'kill/ct' : 'kill/t'} h={13} />Them
        </span>
      </div>
      <dl>
        {#each g.rows as row (row.label)}
          <div class="row">
            <dt>{row.label}</dt>
            <dd class="num" class:good={row.edge === 1} class:bad={row.edge === -1}>{row.value}</dd>
            <dd class="num other" title={row.other !== undefined ? `${r.teamName(1 - team)}: ${row.other}` : undefined}>{row.other ?? ''}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}

  <div class="fhead">
    <h3 class="label">Findings <span class="num">{insights.length}</span></h3>
    <div class="seg" role="group" aria-label="Filter findings">
      {#each filters as [id, label] (id)}
        <button class:on={filter === id} aria-pressed={filter === id} onclick={() => (filter = id)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if insights.length === 0}
    <p class="dim empty">Nothing here.</p>
  {/if}
  {#each teamLevel as ins (ins.id + ins.player)}
    <InsightCard {v} {ins} />
  {/each}
  {#if playerLevel.length}
    <h3 class="label sub">Players</h3>
    {#each playerLevel as ins (ins.id + ins.player)}
      <InsightCard {v} {ins} />
    {/each}
  {/if}
  <p class="foot">Win chance comes from a simple model of players alive and the bomb, so treat the percentages as estimates.</p>
</div>

<style>
  .briefing {
    padding: 14px 16px 24px;
  }

  /* Team switcher. */
  .teams {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .teams button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 38px;
    padding: 0 10px 0 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .teams button:hover {
    background: var(--surface-2);
    border-color: transparent;
    color: var(--text-2);
  }

  .teams button.active {
    background: var(--surface-3);
    border-color: var(--line-2);
    color: var(--text);
  }

  .teams button:not(.active) :global(img) {
    opacity: 0.5;
  }

  .teams .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .teams .score {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
  }

  .teams button:not(.active) .score {
    opacity: 0.6;
  }

  section {
    margin-top: 20px;
  }

  h3.label {
    font-size: 11px;
    font-weight: 600;
    margin: 0;
  }

  /* Verdict. */
  .verdict {
    margin-top: 18px;
  }

  .lead {
    font-family: var(--display);
    font-size: 23px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: 0.002em;
    margin: 4px 0 12px;
    text-wrap: balance;
  }

  /* A row of numbers split by hairlines. */
  .strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-top: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px 8px;
    text-align: left;
  }

  .cell + .cell {
    border-left: 1px solid var(--line);
  }

  .cell b {
    font-family: var(--display);
    font-size: 21px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }

  .cell small {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-3);
    margin-left: 1px;
  }

  .cell span {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell span.ct {
    color: var(--ct);
  }

  .cell span.t {
    color: var(--t);
  }

  /* Problem counts, they filter the findings. */
  .counts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .count {
    --c: var(--text-2);
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
    background: var(--surface-2);
    border-color: var(--line);
    line-height: 26px;
  }

  .count b {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0;
    color: var(--c);
  }

  .count.high {
    --c: var(--accent);
  }

  .count.medium {
    --c: var(--warn);
  }

  .count.good {
    --c: var(--good);
  }

  .count.zero {
    --c: var(--text-3);
    color: var(--text-3);
  }

  .evlink {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 9px 10px;
    text-align: left;
    font-weight: 400;
    font-size: 13px;
    color: var(--text-2);
    background: var(--surface-2);
    border-color: var(--line);
    border-radius: var(--radius);
  }

  .evlink:hover {
    color: var(--text);
  }

  .evlink .marker {
    flex: none;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--evidence);
    color: var(--bg);
    font-family: var(--display);
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }

  .evtext {
    flex: 1;
    min-width: 0;
  }

  .evtext i {
    font-style: normal;
    color: var(--text-3);
    margin: 0 2px;
  }

  .evtext b {
    font-weight: 600;
    color: var(--text);
  }

  .evlink :global(svg) {
    transform: rotate(180deg);
    color: var(--text-3);
  }

  /* Stat rows. */
  .ghead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 66px;
    gap: 10px;
    align-items: baseline;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }

  .ghead .vs {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    font-size: 10.5px;
    white-space: nowrap;
  }

  .ghead .vs :global(img) {
    opacity: 0.75;
  }

  dl {
    margin: 0;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 66px;
    gap: 10px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }

  dt {
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
    color: var(--text);
  }

  dd.good {
    color: var(--good);
  }

  dd.bad {
    color: var(--bad);
  }

  dd.other {
    font-weight: 400;
    font-size: 12px;
    color: var(--text-3);
  }

  /* Findings. */
  .fhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 28px 0 10px;
  }

  .fhead .num {
    color: var(--text-2);
    margin-left: 4px;
  }

  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .seg button {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 10px;
    background: transparent;
    border-color: transparent;
    color: var(--text-3);
  }

  .seg button:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }

  .seg button.on {
    background: var(--surface-3);
    border-color: var(--line-2);
    color: var(--text);
  }

  .sub {
    margin: 22px 0 0;
    padding-bottom: 2px;
  }

  .empty {
    padding: 8px 0;
    margin: 0;
  }

  .foot {
    font-size: 11.5px;
    color: var(--text-3);
    margin: 18px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
</style>
