<script lang="ts">
  import type { HeatKind } from '../lib/render/heatmap'
  import type { Viewer } from '../lib/viewer.svelte'
  import Icon from './Icon.svelte'

  let { v, level, reset }: { v: Viewer; level: () => number; reset: () => void } = $props()
  const r = $derived(v.replay)

  let heatOpen = $state(false)
  let who = $state('team:0')
  let kind = $state<HeatKind>('positions')
  let side = $state(0)

  const coneLabel = { all: 'All', follow: 'Followed', none: 'Off' }

  function cycleCones() {
    v.cones = v.cones === 'all' ? 'follow' : v.cones === 'follow' ? 'none' : 'all'
  }

  function applyHeat() {
    const [type, id] = who.split(':')
    const n = Number(id)
    const players = type === 'team' ? r.teamPlayers[n] : [n]
    const name = type === 'team' ? r.teamName(n) : r.playerName(n)
    v.heat = { label: `${name}, ${kind}${side ? (side === 3 ? ' as CT' : ' as T') : ''}`, players, kind, side }
    heatOpen = false
  }

  function cycleLevel() {
    v.layer = v.layer < 0 ? (level() === 0 ? 1 : 0) : v.layer === 0 ? 1 : -1
  }
</script>

<div class="toolbar">
  <button class:active={v.names} onclick={() => (v.names = !v.names)} title="Player names (H)">Names</button>
  <button class:active={v.cones !== 'none'} onclick={cycleCones} title="View cones">Cones: {coneLabel[v.cones]}</button>
  <button class:active={v.shots} onclick={() => (v.shots = !v.shots)} title="Shot tracers">Shots</button>
  <button class:active={v.paths} onclick={() => (v.paths = !v.paths)} title="Grenade trajectories">Nades</button>
  <button class:active={v.teamVision} disabled={v.follow < 0} onclick={() => (v.teamVision = !v.teamVision)} title="Only show enemies the followed player's team could see (V)">Team vision</button>
  <button class:active={v.rotate} disabled={v.follow < 0} onclick={() => (v.rotate = !v.rotate)} title="Rotate the map with the followed player (R)">Rotate</button>
  <select class:active={v.ghosts >= 0} bind:value={v.ghosts} title="Show where a team stood at this time in their other rounds on the same side (G)">
    <option value={-1}>Ghosts off</option>
    <option value={0}>Ghosts: {r.teamName(0)}</option>
    <option value={1}>Ghosts: {r.teamName(1)}</option>
  </select>
  <div class="heat">
    <button class:active={!!v.heat} onclick={() => (heatOpen = !heatOpen)} title="Heatmap"><Icon name="fire" size={14} /> <span class="label">{v.heat ? v.heat.label : 'Heatmap'}</span></button>
    {#if heatOpen}
      <div class="pop">
        <label>
          Who
          <select bind:value={who}>
            <option value="team:0">{r.teamName(0)}</option>
            <option value="team:1">{r.teamName(1)}</option>
            {#each r.match.players as p (p.index)}
              <option value="player:{p.index}">{p.name}</option>
            {/each}
          </select>
        </label>
        <label>
          What
          <select bind:value={kind}>
            <option value="positions">Positions</option>
            <option value="deaths">Deaths</option>
            <option value="kills">Kills</option>
          </select>
        </label>
        <label>
          Side
          <select bind:value={side}>
            <option value={0}>Both</option>
            <option value={3}>CT</option>
            <option value={2}>T</option>
          </select>
        </label>
        <div class="row">
          <button onclick={applyHeat}>Show</button>
          {#if v.heat}<button onclick={() => { v.heat = null; heatOpen = false }}>Clear</button>{/if}
        </div>
      </div>
    {/if}
  </div>
  {#if v.map.multiLevel}
    <button class:active={v.layer >= 0} onclick={cycleLevel} title="Floor (L)"><Icon name="layers" size={14} /> {v.layer < 0 ? 'Auto floor' : v.layer === 0 ? 'Upper' : 'Lower'}</button>
  {/if}
  <button class:active={v.skipFreeze} onclick={() => (v.skipFreeze = !v.skipFreeze)} title="Skip freeze time and the gap between rounds">Skip freeze</button>
  <button onclick={() => { v.follow = -1; reset() }} title="Reset camera (double click the map)"><Icon name="compass" size={14} /></button>
</div>

{#if !v.map.known || v.map.layers.some((l) => l.generated)}
  <div class="note">No radar image for this map, showing where players walked instead.</div>
{/if}

<style>
  .toolbar {
    position: absolute;
    left: 10px;
    bottom: 10px;
    right: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-items: center;
    pointer-events: none;
  }

  .toolbar > :global(*) {
    pointer-events: auto;
  }

  button,
  select {
    background: rgba(17, 22, 29, 0.9);
    font-size: 12px;
    padding: 4px 7px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  select {
    max-width: 150px;
  }

  .label {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heat {
    position: relative;
  }

  .pop {
    position: absolute;
    bottom: 34px;
    left: 0;
    background: var(--panel-2);
    border: 1px solid var(--line-2);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 230px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  }

  label {
    display: grid;
    grid-template-columns: 50px 1fr;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    font-size: 12px;
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .note {
    position: absolute;
    top: 74px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 12px;
    color: var(--text-2);
    background: rgba(17, 22, 29, 0.85);
    padding: 4px 10px;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
