<script lang="ts">
  import type { AreaStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)

  let team = $state(0)
  let side = $state<'CT' | 'T'>('CT')
  let picked = $state('')

  const areas = $derived((r.report.areas ?? []).filter((a) => a.team === team && a.side === side))
  const fights = $derived(areas.filter((a) => a.kills + a.deaths > 0).sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths)))
  const time = $derived(areas.reduce((s, a) => s + a.time, 0) || 1)
  const worst = $derived([...fights].filter((a) => a.deaths > a.kills).sort((a, b) => b.deaths - b.kills - (a.deaths - a.kills)).slice(0, 3))
  const best = $derived([...fights].filter((a) => a.kills > a.deaths).sort((a, b) => b.kills - b.deaths - (a.kills - a.deaths)).slice(0, 3))
  const maxFights = $derived(Math.max(1, ...fights.map((a) => Math.max(a.kills, a.deaths))))
  const presence = $derived([...areas].sort((a, b) => b.time - a.time).slice(0, 8))

  function show(a: AreaStats, kind: 'deaths' | 'kills' | 'positions') {
    picked = a.place + kind
    v.heat = {
      label: `${a.name} ${kind}`,
      players: r.teamPlayers[team],
      kind,
      side: side === 'CT' ? 3 : 2,
      place: a.place,
    }
  }
</script>

<div class="map">
  <div class="pick">
    <select bind:value={team}>
      <option value={0}>{r.teamName(0)}</option>
      <option value={1}>{r.teamName(1)}</option>
    </select>
    <div class="sides">
      <button class="ct" class:on={side === 'CT'} onclick={() => (side = 'CT')}>CT</button>
      <button class="t" class:on={side === 'T'} onclick={() => (side = 'T')}>T</button>
    </div>
  </div>

  {#if !fights.length}
    <p class="dim">No fights recorded for this side. Older demos may not have callout names.</p>
  {:else}
    <div class="summary">
      <div>
        <span class="label">Losing ground</span>
        {#each worst as a (a.place)}
          <button class="spot" onclick={() => show(a, 'deaths')}><span>{a.name}</span><b class="mono bad">{a.kills} - {a.deaths}</b></button>
        {:else}
          <p class="faint">Nowhere in particular.</p>
        {/each}
      </div>
      <div>
        <span class="label">Owned</span>
        {#each best as a (a.place)}
          <button class="spot" onclick={() => show(a, 'kills')}><span>{a.name}</span><b class="mono good">{a.kills} - {a.deaths}</b></button>
        {:else}
          <p class="faint">Nowhere in particular.</p>
        {/each}
      </div>
    </div>

    <span class="label head">Fights by callout</span>
    <div class="table">
      {#each fights as a (a.place)}
        <button class="area" class:on={picked.startsWith(a.place)} onclick={() => show(a, 'deaths')} title="Show deaths here on the map">
          <span class="name">{a.name}</span>
          <span class="bars">
            <i class="k" style="width: {(a.kills / maxFights) * 50}%"></i>
            <i class="d" style="width: {(a.deaths / maxFights) * 50}%"></i>
          </span>
          <span class="mono kd">{a.kills} - {a.deaths}</span>
          <span class="mono open" title="Opening kills - opening deaths">{a.openingKills || a.openingDeaths ? `${a.openingKills}/${a.openingDeaths}` : ''}</span>
        </button>
      {/each}
    </div>

    <span class="label head">Where they spend time</span>
    {#each presence as a (a.place)}
      <button class="time" onclick={() => show(a, 'positions')}>
        <span class="name">{a.name}</span>
        <span class="tbar"><i style="width: {(a.time / time) * 100}%"></i></span>
        <span class="mono">{Math.round((a.time / time) * 100)}%</span>
      </button>
    {/each}
    <p class="foot faint">Kills count where the killer stood, deaths where the player fell. Opening shows first duels of the round.</p>
  {/if}
</div>

<style>
  .map {
    padding: 14px 16px 24px;
  }

  .pick {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }

  .pick select {
    flex: 1;
  }

  .sides {
    display: flex;
  }

  .sides button {
    font-family: var(--mono);
    font-size: 11px;
    border-radius: 0;
    padding: 3px 12px;
    color: var(--pencil);
  }

  .sides button.on.ct {
    color: var(--ct);
    border-color: var(--ct);
  }

  .sides button.on.t {
    color: var(--t);
    border-color: var(--t);
  }

  .summary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    padding: 12px 0;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }

  .spot {
    width: 100%;
    display: flex;
    justify-content: space-between;
    border: none;
    border-radius: 0;
    padding: 3px 2px;
    text-align: left;
  }

  .spot span {
    font-family: var(--serif);
    font-weight: 600;
  }

  .head {
    display: block;
    margin: 16px 0 6px;
  }

  .area,
  .time {
    width: 100%;
    display: grid;
    grid-template-columns: 110px 1fr 52px 36px;
    gap: 8px;
    align-items: center;
    border: none;
    border-radius: 0;
    padding: 4px 2px;
    text-align: left;
    font-size: 12.5px;
  }

  .time {
    grid-template-columns: 110px 1fr 40px;
  }

  .area.on {
    background: var(--desk-2);
  }

  .name {
    color: var(--graphite);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bars {
    display: flex;
    height: 8px;
  }

  .bars i {
    display: block;
    height: 100%;
  }

  .bars .k {
    background: var(--verdigris);
  }

  .bars .d {
    background: var(--marker);
    opacity: 0.85;
  }

  .kd {
    text-align: right;
    font-size: 11.5px;
  }

  .open {
    text-align: right;
    font-size: 10.5px;
    color: var(--pencil);
  }

  .tbar {
    height: 4px;
    background: var(--desk-3);
  }

  .tbar i {
    display: block;
    height: 100%;
    background: var(--graphite);
  }

  .time .mono {
    text-align: right;
    font-size: 11px;
    color: var(--pencil);
  }

  .foot {
    font-size: 11px;
    margin-top: 14px;
  }
</style>
