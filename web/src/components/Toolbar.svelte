<script lang="ts">
  import type { HeatKind } from '../lib/render/heatmap'
  import type { Viewer } from '../lib/viewer.svelte'
  import Icon from './Icon.svelte'

  let { v, level, reset }: { v: Viewer; level: () => number; reset: () => void } = $props()
  const r = $derived(v.replay)

  let heatOpen = $state(false)
  let heatBox: HTMLSpanElement | undefined = $state()
  let who = $state('team:0')
  let kind = $state<HeatKind>('positions')
  let side = $state(0)

  const KINDS: { id: HeatKind; label: string }[] = [
    { id: 'positions', label: 'Positions' },
    { id: 'deaths', label: 'Deaths' },
    { id: 'kills', label: 'Kills' },
  ]
  const SIDES = [
    { id: 0, label: 'Both' },
    { id: 3, label: 'CT' },
    { id: 2, label: 'T' },
  ]

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

  // Close the heatmap popover on a click outside it or on Escape.
  function outside(e: PointerEvent) {
    if (heatOpen && heatBox && !heatBox.contains(e.target as Node)) heatOpen = false
  }

  function key(e: KeyboardEvent) {
    if (heatOpen && e.key === 'Escape') heatOpen = false
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="bar">
  {#if v.heat}
    <div class="legend">
      <Icon name="fire" size={13} />
      <span class="label">Heatmap</span>
      <span class="clip">{v.heat.label}</span>
      <button class="plain" onclick={() => (v.heat = null)} title="Clear the heatmap" aria-label="Clear the heatmap"><Icon name="x" size={12} /></button>
    </div>
  {/if}
  <div class="group" role="group" aria-label="Layers">
    <button class:on={v.names} onclick={() => (v.names = !v.names)} title="Player names (H)">
      <Icon name="names" size={15} /><span class="txt">Names</span>
    </button>
    <button class:on={v.cones !== 'none'} onclick={cycleCones} title="View cones: all, followed player only or off">
      <Icon name="cone" size={15} /><span class="txt">Cones</span>
      {#if v.cones === 'follow'}<span class="mode">1</span>{/if}
    </button>
    <button class:on={v.shots} onclick={() => (v.shots = !v.shots)} title="Shot tracers">
      <Icon name="target" size={15} /><span class="txt">Shots</span>
    </button>
    <button class:on={v.paths} onclick={() => (v.paths = !v.paths)} title="Grenade trajectories">
      <Icon name="nade" size={15} /><span class="txt">Nades</span>
    </button>
    <button class:on={v.callouts} onclick={() => (v.callouts = !v.callouts)} title="Callout names (C)">
      <Icon name="pin" size={15} /><span class="txt">Callouts</span>
    </button>
    <button class:on={v.evidence} onclick={() => (v.evidence = !v.evidence)} title="Evidence markers for blunders (E)">
      <Icon name="search" size={15} /><span class="txt">Evidence</span>
    </button>
  </div>

  <div class="group" role="group" aria-label="View">
    <button class:on={v.teamVision} disabled={v.follow < 0} onclick={() => (v.teamVision = !v.teamVision)} title="Only show enemies the followed player's team could see (V)">
      <Icon name="eye" size={15} /><span class="txt">Vision</span>
    </button>
    <button class:on={v.rotate} disabled={v.follow < 0} onclick={() => (v.rotate = !v.rotate)} title="Rotate the map with the followed player (R)">
      <Icon name="rotate" size={15} /><span class="txt">Rotate</span>
    </button>
    <button class:on={v.ghosts >= 0} onclick={cycleGhosts} title="Where a team stood at this moment in their other rounds on the same side (G)">
      <Icon name="ghost" size={15} /><span class="txt">Ghosts</span>
      {#if v.ghosts >= 0}<span class="mode">{v.ghosts === 0 ? 'A' : 'B'}</span>{/if}
    </button>
    <span class="heat" bind:this={heatBox}>
      <button class:on={!!v.heat} class:open={heatOpen} onclick={() => (heatOpen = !heatOpen)} title="Heatmap" aria-expanded={heatOpen}>
        <Icon name="fire" size={15} /><span class="txt">Heatmap</span>
      </button>
      {#if heatOpen}
        <div class="pop" role="dialog" aria-label="Heatmap">
          <div class="pop-head">
            <span class="label">Heatmap</span>
            <button class="plain close" onclick={() => (heatOpen = false)} title="Close"><Icon name="x" size={13} /></button>
          </div>
          <label class="field">
            <span class="label">Who</span>
            <select bind:value={who}>
              <optgroup label="Teams">
                <option value="team:0">{r.teamName(0)}</option>
                <option value="team:1">{r.teamName(1)}</option>
              </optgroup>
              <optgroup label="Players">
                {#each r.match.players as p (p.index)}
                  <option value="player:{p.index}">{p.name}</option>
                {/each}
              </optgroup>
            </select>
          </label>
          <div class="field">
            <span class="label">What</span>
            <div class="seg" role="radiogroup" aria-label="What">
              {#each KINDS as k (k.id)}
                <button role="radio" aria-checked={kind === k.id} class:sel={kind === k.id} onclick={() => (kind = k.id)}>{k.label}</button>
              {/each}
            </div>
          </div>
          <div class="field">
            <span class="label">Side</span>
            <div class="seg" role="radiogroup" aria-label="Side">
              {#each SIDES as s (s.id)}
                <button role="radio" aria-checked={side === s.id} class="{s.id === 3 ? 'is-ct' : s.id === 2 ? 'is-t' : ''}" class:sel={side === s.id} onclick={() => (side = s.id)}>{s.label}</button>
              {/each}
            </div>
          </div>
          <div class="actions">
            {#if v.heat}<button class="plain" onclick={() => { v.heat = null; heatOpen = false }}>Clear</button>{/if}
            <button class="go" onclick={applyHeat}>Show heatmap</button>
          </div>
        </div>
      {/if}
    </span>
    {#if v.map.multiLevel}
      <button class="floor" class:on={v.layer >= 0} onclick={cycleLevel} title="Floor: automatic, upper or lower (L)">
        <span class="levels" aria-hidden="true">
          <i class:lit={v.layer === 0}></i>
          <i class:lit={v.layer === 1}></i>
        </span>
        <span>{v.layer < 0 ? 'Auto' : v.layer === 0 ? 'Upper' : 'Lower'}</span>
      </button>
    {/if}
  </div>

  <div class="group" role="group" aria-label="Camera">
    <button class="only" onclick={() => { v.follow = -1; reset() }} title="Reset the camera (double click the map)" aria-label="Reset the camera">
      <Icon name="frame" size={15} />
    </button>
  </div>
</div>

{#if v.map.layers.some((l) => l.generated)}
  <div class="note">No radar image for this map, drawing where players walked instead</div>
{/if}

<style>
  .bar {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px;
    pointer-events: none;
    container-type: inline-size;
  }

  .group {
    display: flex;
    gap: 2px;
    padding: 3px;
    pointer-events: auto;
    background: rgba(12, 14, 18, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .group > button,
  .heat > button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 7px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text-3);
    white-space: nowrap;
  }

  .group > button:hover,
  .heat > button:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .group > button.on,
  .heat > button.on {
    color: var(--text);
    background: rgba(255, 255, 255, 0.1);
  }

  .heat > button.open {
    background: rgba(255, 255, 255, 0.1);
  }

  .group > button.only {
    width: 30px;
    padding: 0;
    justify-content: center;
  }

  .group > button:disabled,
  .group > button:disabled:hover {
    color: var(--text-3);
    background: transparent;
    opacity: 0.4;
  }

  .mode {
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    margin-left: -1px;
    border-radius: 3px;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }

  .heat {
    position: relative;
    display: flex;
  }

  /* The heatmap on show, above the toolbar. */
  .legend {
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 3px 0 10px;
    max-width: 100%;
    pointer-events: auto;
    background: rgba(12, 14, 18, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: var(--radius);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: var(--text-2);
  }

  .legend .label {
    font-size: 10px;
  }

  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--display);
    font-weight: 600;
    font-size: 12.5px;
    color: var(--text);
  }

  .legend button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--text-3);
  }

  .legend button:hover {
    color: var(--text);
  }

  .levels {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .levels i {
    width: 12px;
    height: 4px;
    border-radius: 1px;
    box-shadow: inset 0 0 0 1px currentColor;
    opacity: 0.8;
  }

  .levels i.lit {
    background: var(--accent);
    box-shadow: none;
    opacity: 1;
  }

  .floor span:last-child {
    min-width: 34px;
    text-align: left;
  }

  .pop {
    position: absolute;
    bottom: calc(100% + 10px);
    left: -3px;
    width: 264px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }

  .pop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px -4px 0 0;
  }

  .pop-head .label {
    color: var(--text-2);
  }

  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--text-3);
  }

  .close:hover {
    color: var(--text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field .label {
    font-size: 10px;
  }

  .field select {
    width: 100%;
    height: 30px;
  }

  .seg {
    display: flex;
    padding: 2px;
    gap: 2px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .seg button {
    flex: 1;
    height: 26px;
    padding: 0 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    font-family: var(--display);
    font-weight: 600;
    font-size: 12.5px;
    color: var(--text-3);
  }

  .seg button:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .seg button.sel {
    color: var(--text);
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .seg button.is-ct.sel {
    color: var(--ct);
  }

  .seg button.is-t.sel {
    color: var(--t);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 2px;
  }

  .actions button {
    height: 30px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 13px;
  }

  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    padding: 0 14px;
  }

  .go:hover {
    background: #f6636a;
    border-color: #f6636a;
  }

  .note {
    position: absolute;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    background: rgba(12, 14, 18, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 12px;
    color: var(--text-2);
    pointer-events: none;
    white-space: nowrap;
  }

  /* Narrow stages keep the icons and drop the words. */
  @container (max-width: 860px) {
    .txt {
      display: none;
    }

    .group > button,
    .heat > button {
      padding: 0 7px;
    }
  }
</style>
