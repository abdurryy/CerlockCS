<script lang="ts">
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)

  // Kills from the last few seconds, like the in game feed.
  const recent = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    return r.roundKills[round].filter((k) => k.tick <= tick && tick - k.tick < 6 * r.rate).slice(-6)
  })

  const cls = (side: number) => (side === 3 ? 'ct' : 't')
</script>

<div class="feed">
  {#each recent as k (k.tick * 100 + k.victim)}
    <div class="row {cls(k.killerSide)}" class:mine={v.follow >= 0 && (k.killer === v.follow || k.victim === v.follow)}>
      {#if k.killer >= 0}
        <span class={cls(k.killerSide)}>{r.playerName(k.killer)}</span>
        {#if k.assister >= 0}
          <span class="faint">+</span>
          <span class={cls(k.killerSide)} class:flash={k.flashAssist}>{r.playerName(k.assister)}</span>
        {/if}
      {/if}
      <span class="weapon mono">
        {#if k.attackerBlind}<span class="tag">blind</span>{/if}
        {weaponName(k.weapon)}
        {#if k.wallbang}<span class="tag">wall</span>{/if}
        {#if k.throughSmoke}<span class="tag">smoke</span>{/if}
        {#if k.noScope}<span class="tag">noscope</span>{/if}
        {#if k.headshot}<span class="hs">hs</span>{/if}
      </span>
      <span class={cls(k.victimSide)}>{r.playerName(k.victim)}</span>
    </div>
  {/each}
</div>

<style>
  .feed {
    position: absolute;
    top: 78px;
    right: 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    pointer-events: none;
    max-width: 46%;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    background: rgba(14, 16, 19, 0.86);
    padding: 3px 9px;
    border-radius: 2px;
    font-weight: 500;
    font-size: 12px;
    white-space: nowrap;
    border-left: 2px solid transparent;
  }

  .row.ct {
    border-left-color: var(--ct);
  }

  .row.t {
    border-left-color: var(--t);
  }

  .row.mine {
    box-shadow: inset 0 0 0 1px var(--marker);
  }

  .weapon {
    color: var(--graphite);
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .tag {
    font-size: 9.5px;
    color: var(--pencil);
  }

  .hs {
    font-size: 10px;
    color: var(--marker);
    font-weight: 600;
  }

  .flash {
    text-decoration: underline dotted;
  }
</style>
