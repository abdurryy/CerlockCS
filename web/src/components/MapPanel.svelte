<script lang="ts">
  import type { AreaStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import GameIcon from './GameIcon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)

  const SIDES = ['CT', 'T'] as const

  let team = $state(0)
  let side = $state<'CT' | 'T'>('CT')

  const areas = $derived((r.report.areas ?? []).filter((a) => a.team === team && a.side === side))
  const fights = $derived(areas.filter((a) => a.kills + a.deaths > 0).sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths)))
  const time = $derived(areas.reduce((s, a) => s + a.time, 0) || 1)
  const worst = $derived([...fights].filter((a) => a.deaths > a.kills).sort((a, b) => b.deaths - b.kills - (a.deaths - a.kills)).slice(0, 3))
  const best = $derived([...fights].filter((a) => a.kills > a.deaths).sort((a, b) => b.kills - b.deaths - (a.kills - a.deaths)).slice(0, 3))
  const maxFights = $derived(Math.max(1, ...fights.map((a) => Math.max(a.kills, a.deaths))))
  const presence = $derived([...areas].sort((a, b) => b.time - a.time).slice(0, 8))
  const record = $derived(r.report.teams[team]?.sides?.[side])
  const sideNum = $derived(side === 'CT' ? 3 : 2)

  function show(a: AreaStats, kind: 'deaths' | 'kills' | 'positions') {
    v.heat = {
      label: `${a.name} ${kind}`,
      players: r.teamPlayers[team],
      kind,
      side: sideNum,
      place: a.place,
    }
  }

  // The heatmap on the map comes from this place, for this team and side.
  function shown(a: AreaStats, kind?: string): boolean {
    const h = v.heat
    if (!h || h.place !== a.place || h.side !== sideNum || (kind && h.kind !== kind)) return false
    const mine = r.teamPlayers[team]
    return h.players.length === mine.length && h.players.every((p, i) => p === mine[i])
  }
</script>

<div class="map">
  <div class="seg teams" role="group" aria-label="Team">
    {#each [0, 1] as t (t)}
      <button class:on={team === t} aria-pressed={team === t} title={r.teamName(t)} onclick={() => (team = t)}>
        <span class="tn">{r.teamName(t)}</span>
      </button>
    {/each}
  </div>
  <div class="pick">
    <div class="seg sides" role="group" aria-label="Side">
      {#each SIDES as s (s)}
        <button class={s === 'CT' ? 'ct' : 't'} class:on={side === s} aria-pressed={side === s} title="{s} side" onclick={() => (side = s)}>
          <GameIcon name={s === 'CT' ? 'kill/ct' : 'kill/t'} h={16} />{s}
        </button>
      {/each}
    </div>
    {#if record?.played}
      <p class="record">
        Won <b class="num">{record.won}</b> of <b class="num">{record.played}</b> <span class={side === 'CT' ? 'ct' : 't'}>{side}</span> rounds
      </p>
    {/if}
  </div>

  {#if !fights.length}
    <p class="dim empty">No fights recorded for this side. Older demos may not have callout names.</p>
  {:else}
    <div class="summary">
      <div>
        <h3 class="label">Losing ground</h3>
        {#each worst as a (a.place)}
          <button class="spot" class:on={shown(a, 'deaths')} onclick={() => show(a, 'deaths')} title="Show deaths at {a.name} on the map">
            <span class="name">{a.name}</span><b class="num bad">{a.kills}<span class="sep">-</span>{a.deaths}</b>
          </button>
        {:else}
          <p class="faint none">Nowhere in particular.</p>
        {/each}
      </div>
      <div>
        <h3 class="label">Owned</h3>
        {#each best as a (a.place)}
          <button class="spot" class:on={shown(a, 'kills')} onclick={() => show(a, 'kills')} title="Show kills at {a.name} on the map">
            <span class="name">{a.name}</span><b class="num good">{a.kills}<span class="sep">-</span>{a.deaths}</b>
          </button>
        {:else}
          <p class="faint none">Nowhere in particular.</p>
        {/each}
      </div>
    </div>

    <div class="head">
      <h3 class="label">Fights by callout</h3>
      {#if v.heat}<button class="plain clear" onclick={() => (v.heat = null)}>Clear heatmap</button>{/if}
    </div>
    <div class="cols" aria-hidden="true">
      <span></span>
      <span class="label k">K</span>
      <span></span>
      <span class="label d">D</span>
      <span class="label o" title="Opening kills / opening deaths">Open</span>
    </div>
    {#each fights as a (a.place)}
      <button class="area" class:on={shown(a)} onclick={() => show(a, 'deaths')} title="Show deaths at {a.name} on the map">
        <span class="name">{a.name}</span>
        <b class="num k" class:zero={!a.kills}>{a.kills}</b>
        <span class="bars">
          <span class="half left"><i class="kb" style:width="{(a.kills / maxFights) * 100}%"></i></span>
          <span class="half"><i class="db" style:width="{(a.deaths / maxFights) * 100}%"></i></span>
        </span>
        <b class="num d" class:zero={!a.deaths}>{a.deaths}</b>
        <span class="num o" title="Opening kills / opening deaths">{a.openingKills || a.openingDeaths ? `${a.openingKills}/${a.openingDeaths}` : ''}</span>
      </button>
    {/each}

    <div class="head">
      <h3 class="label">Where they spend time</h3>
    </div>
    {#each presence as a (a.place)}
      <button class="time" class:on={shown(a, 'positions')} onclick={() => show(a, 'positions')} title="Show positions at {a.name} on the map">
        <span class="name">{a.name}</span>
        <span class="tbar"><i style:width="{(a.time / time) * 100}%"></i></span>
        <span class="num pct">{Math.round((a.time / time) * 100)}%</span>
      </button>
    {/each}
    <p class="foot">Kills count where the killer stood, deaths where the player fell. Open shows first duels of the round. Click a callout to see it on the map.</p>
  {/if}
</div>

<style>
  .map {
    padding: 14px 16px 24px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
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
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 0 10px;
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

  .teams button {
    flex: 1;
    min-width: 0;
  }

  .tn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sides button {
    padding: 0 9px 0 7px;
    letter-spacing: 0.04em;
  }

  .sides button:not(.on) :global(img) {
    opacity: 0.45;
    filter: grayscale(0.7);
  }

  .sides button.on.ct {
    color: var(--ct);
  }

  .sides button.on.t {
    color: var(--t);
  }

  .record {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 13px;
    color: var(--text-3);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .record span {
    font-family: var(--display);
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .record b {
    font-weight: 600;
    color: var(--text-2);
  }

  .empty {
    margin: 16px 0 0;
  }

  h3.label {
    font-size: 11px;
    font-weight: 600;
  }

  /* Best and worst places. */
  .summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 18px;
  }

  .summary h3 {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }

  .spot {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 4px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    text-align: left;
  }

  .spot:hover {
    background: var(--surface-2);
  }

  .spot .name {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .spot b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }

  .sep {
    margin: 0 3px;
    color: var(--text-3);
    font-weight: 600;
  }

  .none {
    margin: 0;
    padding: 8px 0;
    font-size: 12.5px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
    margin: 24px 0 0;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }

  .clear {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    padding: 1px 6px;
  }

  .clear:hover {
    color: var(--text);
  }

  /* Fights: kills grow left and deaths right from a centre line. */
  .cols,
  .area {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) 24px minmax(0, 1fr) 24px 34px;
    gap: 8px;
    align-items: center;
  }

  .cols {
    height: 24px;
    padding: 0 6px 0 4px;
  }

  .cols .label {
    font-size: 10.5px;
  }

  .cols .k,
  .cols .o {
    text-align: right;
  }

  .area,
  .time {
    width: 100%;
    height: 30px;
    padding: 0 6px 0 4px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    text-align: left;
    font-size: 13px;
  }

  .area:hover,
  .time:hover {
    background: var(--surface-2);
  }

  .area.on,
  .time.on,
  .spot.on {
    background: var(--surface-3);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .name {
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .area.on .name,
  .time.on .name {
    color: var(--text);
  }

  .area b {
    font-weight: 600;
  }

  .area .k {
    text-align: right;
  }

  .area .k,
  .area .d {
    color: var(--text);
  }

  .area .zero {
    color: var(--text-3);
    font-weight: 500;
  }

  .bars {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    height: 8px;
  }

  .bars::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -4px;
    bottom: -4px;
    width: 1px;
    margin-left: -0.5px;
    background: var(--line-2);
  }

  .half {
    display: flex;
    height: 100%;
  }

  .half.left {
    justify-content: flex-end;
  }

  .half i {
    display: block;
    height: 100%;
  }

  .kb {
    background: var(--good);
    border-radius: 1px 0 0 1px;
  }

  .db {
    background: var(--bad);
    opacity: 0.9;
    border-radius: 0 1px 1px 0;
  }

  .o {
    text-align: right;
    font-size: 11.5px;
    color: var(--text-3);
  }

  /* Presence. */
  .time {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) 40px;
    gap: 8px;
    align-items: center;
  }

  .tbar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .tbar i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--text-2);
  }

  .pct {
    text-align: right;
    font-size: 12.5px;
    color: var(--text-2);
  }

  .foot {
    font-size: 11.5px;
    color: var(--text-3);
    margin: 18px 0 0;
  }
</style>
