<script lang="ts">
  import { tick } from 'svelte'
  import { weaponIcon } from '../lib/icons.svelte'
  import type { Engagement } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'
  import AimChart from './AimChart.svelte'
  import GameIcon from './GameIcon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  let filter = $state<'all' | 'won' | 'lost'>('all')

  const players = $derived(r.match.players.filter((p) => (report.aim[p.index]?.engagements ?? 0) > 0))
  const player = $derived(v.inspect >= 0 ? v.inspect : v.follow >= 0 ? v.follow : (players[0]?.index ?? 0))
  const summary = $derived(report.aim[player])
  const stats = $derived(report.players[player])
  // Some demos have no damage events, so hits and time to damage are unknown.
  const hasHits = $derived((r.match.damages?.length ?? 0) > 0)

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

  const all = $derived(r.engagements.filter((e) => e.attacker === player))
  const counts = $derived({ all: all.length, won: all.filter((e) => e.killed).length, lost: all.filter((e) => e.died).length })
  const list = $derived(all.filter((e) => filter === 'all' || (filter === 'won' ? e.killed : e.died)))
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

  // compare says how far a number is from the lobby, in words.
  function compare(n: number, ref: number, unit: string, digits: number, words: [string, string]): string {
    if (n < 0 || ref < 0) return ''
    const d = Number((n - ref).toFixed(digits))
    if (d === 0) return ''
    return `${Math.abs(d).toFixed(digits)}${unit} ${d < 0 ? words[0] : words[1]}`
  }

  const lobbyRef = (n: number, unit: string, digits = 0) => (n < 0 ? 'No data' : `Lobby ${fmt(n, unit, digits)}`)

  const metrics = $derived(
    summary
      ? [
          {
            label: 'Crosshair placement',
            title: 'How far the crosshair was from the enemy head when they showed up',
            value: fmt(summary.crosshairErrorDeg, '°', 1),
            cls: lower(summary.crosshairErrorDeg, lobby.crosshair),
            delta: compare(summary.crosshairErrorDeg, lobby.crosshair, '°', 1, ['tighter', 'wider']),
            ref: lobbyRef(lobby.crosshair, '°', 1),
          },
          {
            label: 'Reaction',
            title: 'Time from spotting the enemy to the first shot',
            value: fmt(summary.reactionMs, ' ms'),
            cls: lower(summary.reactionMs, lobby.reaction),
            delta: compare(summary.reactionMs, lobby.reaction, ' ms', 0, ['faster', 'slower']),
            ref: lobbyRef(lobby.reaction, ' ms'),
          },
          {
            label: 'Time to damage',
            title: 'Time from spotting the enemy to the first hit',
            value: fmt(summary.timeToDamageMs, ' ms'),
            cls: lower(summary.timeToDamageMs, lobby.ttd),
            delta: compare(summary.timeToDamageMs, lobby.ttd, ' ms', 0, ['faster', 'slower']),
            ref: hasHits ? lobbyRef(lobby.ttd, ' ms') : 'No hit data in this demo',
          },
          {
            label: 'First shot error',
            title: 'How far the first shot was from the enemy head',
            value: fmt(summary.firstShotErrorDeg, '°', 1),
            cls: lower(summary.firstShotErrorDeg, lobby.firstShot),
            delta: compare(summary.firstShotErrorDeg, lobby.firstShot, '°', 1, ['tighter', 'wider']),
            ref: lobbyRef(lobby.firstShot, '°', 1),
          },
          {
            label: 'Shots while still',
            title: 'Shots fired while standing still or counter strafed',
            value: fmt(stats?.counterStrafe ?? -1, '%'),
            cls: higher(stats?.counterStrafe ?? -1, lobby.still),
            delta: compare(lobby.still, stats?.counterStrafe ?? -1, ' pts', 0, ['higher', 'lower']),
            ref: lobbyRef(lobby.still, '%'),
          },
        ]
      : [],
  )

  const sideIn = (p: number, round: number) => r.sideOf(r.match.players[p]?.team ?? -1, round)
  const sideClass = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')
</script>

<div class="ballistics">
  <label class="pick">
    <span class="label">Shooter</span>
    <select value={player} onchange={(e) => (v.inspect = Number((e.currentTarget as HTMLSelectElement).value))}>
      {#each players as p (p.index)}<option value={p.index}>{p.name}</option>{/each}
    </select>
  </label>

  {#if summary}
    <div class="metrics">
      {#each metrics as m (m.label)}
        <div class="m" title={m.title}>
          <span class="mlabel">{m.label}</span>
          <b class="num {m.cls}" class:none={m.value === '-'}>{m.value}</b>
          <span class="cmp">
            {#if m.delta}<span class="delta {m.cls}">{m.delta}</span>{/if}
            <span class="ref num">{m.ref}</span>
          </span>
        </div>
      {/each}
      <div class="m" title="Duels won and lost">
        <span class="mlabel">Duels</span>
        <b class="num">{summary.duelsWon}<span class="sep">-</span>{summary.duelsLost}</b>
        <span class="cmp"><span class="ref" class:bad={summary.noShotDeaths >= 3}>{summary.noShotDeaths} lost without a shot</span></span>
      </div>
    </div>
    <p class="row">
      {#if hasHits}<span><b class="num">{summary.duelAccuracy}%</b> of shots hit inside duels,</span>{/if}
      <span><b class="num">{summary.headshotRate}%</b> of kills were headshots,</span>
      <span><b class="num">{summary.prefires}</b> {summary.prefires === 1 ? 'prefire' : 'prefires'}.</span>
    </p>
  {/if}

  {#if selected}
    {@const vs = sideIn(selected.victim, selected.round)}
    <section class="chart" bind:this={chart}>
      <div class="chart-head">
        <span class="label">Duel</span>
        <span class="rd num">R{selected.round + 1}</span>
        <span class="vs">vs <b class={sideClass(vs)}>{r.playerName(selected.victim)}</b></span>
        <span class="gun">
          <GameIcon name={weaponIcon(selected.weapon, sideIn(selected.attacker, selected.round))} h={16} title={weaponName(selected.weapon)} fallback={weaponName(selected.weapon)} />
        </span>
        <span class="res {selected.killed ? 'good' : selected.died ? 'bad' : ''}">
          {selected.killed ? 'Kill' : selected.died ? 'Died' : 'Damage'}
          {#if selected.killed && selected.headshot}<GameIcon name="kill/headshot" h={14} title="Headshot" fallback="HS" />{/if}
        </span>
      </div>
      <AimChart {r} e={selected} tick={v.tick} />
    </section>
  {/if}

  <div class="filters">
    <h3 class="label">Duels <span class="num">{list.length}</span></h3>
    <div class="seg" role="group" aria-label="Filter duels">
      {#each [['all', 'All'], ['won', 'Won'], ['lost', 'Lost']] as [id, label] (id)}
        <button class:on={filter === id} aria-pressed={filter === id} onclick={() => (filter = id as typeof filter)}>
          {label}<span class="n num">{counts[id as keyof typeof counts]}</span>
        </button>
      {/each}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th title="Round">Rd</th>
        <th class="l" title="Weapon">Gun</th>
        <th class="l">Opponent</th>
        <th class="l">Result</th>
        <th title="Crosshair distance from the head when spotted">Xhair</th>
        <th title="Spotted to first shot, ms">React</th>
        {#if hasHits}<th title="Hits / shots">Hits</th>{:else}<th title="Shots fired">Shots</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each list as e (e.id)}
        {@const vs = sideIn(e.victim, e.round)}
        <tr class:selected={selected?.id === e.id} onclick={() => open(e)} title="Watch this duel">
          <td class="num faint">{e.round + 1}</td>
          <td class="l gun"><GameIcon name={weaponIcon(e.weapon, sideIn(e.attacker, e.round))} h={13} title={weaponName(e.weapon)} fallback={weaponName(e.weapon)} /></td>
          <td class="l opp"><span class={sideClass(vs)}>{r.playerName(e.victim)}</span></td>
          <td class="l">
            <span class="res {e.killed ? 'good' : e.died ? 'bad' : 'faint'}">
              {e.killed ? 'Kill' : e.died ? 'Died' : 'Dmg'}
              {#if e.killed && e.headshot}<GameIcon name="kill/headshot" h={13} title="Headshot" fallback="HS" />{/if}
            </span>
          </td>
          <td class="num">{e.crosshairErrorDeg >= 0 ? `${e.crosshairErrorDeg.toFixed(1)}°` : '-'}</td>
          <td class="num">{e.reactionMs >= 0 ? Math.round(e.reactionMs) : '-'}</td>
          {#if hasHits}<td class="num">{e.hits}<span class="faint">/{e.shots}</span></td>{:else}<td class="num">{e.shots}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !list.length}
    <p class="dim empty">No duels here.</p>
  {/if}

  <p class="foot">
    Crosshair placement is how far the crosshair was from the enemy's head the moment they showed up. Reaction is the time from spotting
    to the first shot. Spotting comes from the game's radar, so it can trail real line of sight by a few ticks.
  </p>
</div>

<style>
  .ballistics {
    padding: 14px 16px 24px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .pick select {
    flex: 1;
    min-width: 0;
    height: 32px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  /* Metric tiles, two per row split by hairlines. */
  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
  }

  .m {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 10px 12px 10px;
    border-top: 1px solid var(--line);
  }

  .m:nth-child(-n + 2) {
    border-top: none;
  }

  .m:nth-child(even) {
    border-left: 1px solid var(--line);
  }

  .mlabel {
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

  .m b {
    font-family: var(--display);
    font-size: 23px;
    font-weight: 700;
    line-height: 1.05;
    color: var(--text);
  }

  .m b.good {
    color: var(--good);
  }

  .m b.bad {
    color: var(--bad);
  }

  .m b.none {
    color: var(--text-3);
  }

  .sep {
    margin: 0 4px;
    color: var(--text-3);
    font-weight: 600;
  }

  .cmp {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
    align-items: baseline;
    min-width: 0;
    font-size: 12px;
    white-space: nowrap;
  }

  .delta {
    color: var(--text-2);
    font-weight: 500;
  }

  .delta.good {
    color: var(--good);
  }

  .delta.bad {
    color: var(--bad);
  }

  .ref {
    max-width: 100%;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ref.bad {
    color: var(--bad);
  }

  .row {
    font-size: 13px;
    color: var(--text-2);
    margin: 12px 0 0;
  }

  .row span {
    white-space: nowrap;
  }

  .row b {
    font-weight: 600;
    color: var(--text);
  }

  /* Selected duel. */
  .chart {
    margin-top: 20px;
    scroll-margin: 12px;
  }

  .chart-head {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    margin-bottom: 8px;
  }

  .chart-head .label {
    margin-right: 2px;
  }

  .rd {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    padding: 4px 6px 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text);
  }

  .vs {
    flex: 1;
    min-width: 0;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vs b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .vs b.ct {
    color: var(--ct);
  }

  .vs b.t {
    color: var(--t);
  }

  .chart-head .gun {
    display: inline-flex;
    color: var(--text);
  }

  .res {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--display);
    font-weight: 600;
    white-space: nowrap;
  }

  .chart-head .res {
    font-size: 13px;
  }

  /* Duel list. */
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 22px 0 6px;
  }

  .filters h3 {
    font-size: 11px;
    font-weight: 600;
  }

  .filters h3 .num {
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
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 9px;
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

  .seg .n {
    font-size: 11px;
    color: var(--text-3);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  th {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    text-align: right;
    padding: 6px 4px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  td {
    height: 30px;
    padding: 0 4px;
    text-align: right;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    color: var(--text-2);
  }

  .l {
    text-align: left;
  }

  td.gun {
    width: 56px;
    color: var(--text);
  }

  td.opp {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
  }

  td.opp span {
    color: var(--text);
  }

  td.opp span.ct {
    color: var(--ct);
  }

  td.opp span.t {
    color: var(--t);
  }

  td .res.good {
    color: var(--good);
  }

  td .res.bad {
    color: var(--bad);
  }

  td .res.faint {
    color: var(--text-3);
  }

  .res :global(.icon) {
    color: var(--text);
  }

  td .faint {
    color: var(--text-3);
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--surface-2);
  }

  tr.selected {
    background: var(--surface-3) !important;
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .empty {
    margin: 0;
    padding: 10px 0;
  }

  .foot {
    font-size: 11.5px;
    color: var(--text-3);
    margin: 18px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
</style>
