<script lang="ts">
  import type { HeatKind } from '../lib/render/heatmap'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v, level, reset }: { v: Viewer; level: () => number; reset: () => void } = $props()
  const r = $derived(v.replay)

  let heatOpen = $state(false)
  let who = $state('team:0')
  let kind = $state<HeatKind>('positions')
  let side = $state(0)

  const coneLabel = { all: 'cones', follow: 'cone 1', none: 'cones' }

  function cycleCones() {
    v.cones = v.cones === 'all' ? 'follow' : v.cones === 'follow' ? 'none' : 'all'
  }

  function cycleGhosts() {
    v.ghosts = v.ghosts === -1 ? 0 : v.ghosts === 0 ? 1 : -1
  }

  function applyHeat() {
    const [type, id] = who.split(':')
    const n = Number(id)
    const players = type === 'team' ? r.teamPlayers[n] : [n]
    const name = type === 'team' ? r.teamName(n) : r.playerName(n)
    v.heat = { label: `${name} ${kind}${side ? (side === 3 ? ' CT' : ' T') : ''}`, players, kind, side }
    heatOpen = false
  }

  function cycleLevel() {
    v.layer = v.layer < 0 ? (level() === 0 ? 1 : 0) : v.layer === 0 ? 1 : -1
  }
</script>

<div class="bar">
  <div class="group">
    <button class:on={v.names} onclick={() => (v.names = !v.names)} title="Player names (H)">names</button>
    <button class:on={v.cones !== 'none'} onclick={cycleCones} title="View cones: all, followed only or off">{coneLabel[v.cones]}</button>
    <button class:on={v.shots} onclick={() => (v.shots = !v.shots)} title="Shot tracers">shots</button>
    <button class:on={v.paths} onclick={() => (v.paths = !v.paths)} title="Grenade trajectories">nades</button>
    <button class:on={v.callouts} onclick={() => (v.callouts = !v.callouts)} title="Callout names (C)">callouts</button>
    <button class:on={v.evidence} onclick={() => (v.evidence = !v.evidence)} title="Evidence markers for blunders (E)">evidence</button>
  </div>
  <div class="group">
    <button class:on={v.teamVision} disabled={v.follow < 0} onclick={() => (v.teamVision = !v.teamVision)} title="Only show enemies the followed player's team could see (V)">vision</button>
    <button class:on={v.rotate} disabled={v.follow < 0} onclick={() => (v.rotate = !v.rotate)} title="Rotate the map with the followed player (R)">rotate</button>
    <button class:on={v.ghosts >= 0} onclick={cycleGhosts} title="Where a team stood at this moment in their other rounds on the same side (G)">
      {v.ghosts >= 0 ? `ghosts ${v.ghosts === 0 ? 'A' : 'B'}` : 'ghosts'}
    </button>
    <span class="heat">
      <button class:on={!!v.heat} onclick={() => (heatOpen = !heatOpen)} title="Heatmap">
        <span class="clip">{v.heat ? v.heat.label : 'heatmap'}</span>
      </button>
      {#if heatOpen}
        <div class="pop">
          <label>
            <span class="label">Who</span>
            <select bind:value={who}>
              <option value="team:0">{r.teamName(0)}</option>
              <option value="team:1">{r.teamName(1)}</option>
              {#each r.match.players as p (p.index)}
                <option value="player:{p.index}">{p.name}</option>
              {/each}
            </select>
          </label>
          <label>
            <span class="label">What</span>
            <select bind:value={kind}>
              <option value="positions">Positions</option>
              <option value="deaths">Deaths</option>
              <option value="kills">Kills</option>
            </select>
          </label>
          <label>
            <span class="label">Side</span>
            <select bind:value={side}>
              <option value={0}>Both</option>
              <option value={3}>CT</option>
              <option value={2}>T</option>
            </select>
          </label>
          <div class="row">
            <button onclick={applyHeat}>Show</button>
            {#if v.heat}<button class="plain" onclick={() => { v.heat = null; heatOpen = false }}>Clear</button>{/if}
          </div>
        </div>
      {/if}
    </span>
    {#if v.map.multiLevel}
      <button class:on={v.layer >= 0} onclick={cycleLevel} title="Floor (L)">{v.layer < 0 ? 'auto floor' : v.layer === 0 ? 'upper' : 'lower'}</button>
    {/if}
  </div>
  <div class="group">
    <button class:on={v.skipFreeze} onclick={() => (v.skipFreeze = !v.skipFreeze)} title="Skip freeze time and the gap between rounds">skip freeze</button>
    <button onclick={() => { v.follow = -1; reset() }} title="Reset the camera (double click the map)">reset</button>
  </div>
</div>

{#if v.map.layers.some((l) => l.generated)}
  <div class="note label">No radar image for this map, drawing where players walked instead</div>
{/if}

<style>
  .bar {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    pointer-events: none;
  }

  .group {
    display: flex;
    pointer-events: auto;
    background: rgba(14, 16, 19, 0.88);
    border: 1px solid var(--rule);
    border-radius: 3px;
    backdrop-filter: blur(4px);
  }

  .group > button,
  .heat > button {
    border: none;
    border-radius: 0;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--pencil);
    padding: 6px 9px;
    border-bottom: 2px solid transparent;
    background: transparent;
  }

  .group > button:hover,
  .heat > button:hover {
    color: var(--paper);
    background: var(--desk-3);
  }

  .group > button.on,
  .heat > button.on {
    color: var(--paper);
    border-bottom-color: var(--marker);
  }

  .group > button:disabled {
    opacity: 0.35;
  }

  .heat {
    position: relative;
    display: flex;
  }

  .clip {
    display: inline-block;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  .pop {
    position: absolute;
    bottom: 36px;
    left: 0;
    background: var(--desk);
    border: 1px solid var(--rule-2);
    border-radius: 3px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    width: 240px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
  }

  .pop label {
    display: grid;
    grid-template-columns: 46px 1fr;
    align-items: center;
    gap: 8px;
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .note {
    position: absolute;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(14, 16, 19, 0.85);
    padding: 4px 10px;
    border-radius: 2px;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
