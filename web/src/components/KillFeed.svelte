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
    <div class="row" class:mine={v.follow >= 0 && (k.killer === v.follow || k.victim === v.follow)}>
      {#if k.killer >= 0}
        <span class={cls(k.killerSide)}>{r.playerName(k.killer)}</span>
        {#if k.assister >= 0}
          <span class="muted">+</span>
          <span class="{k.flashAssist ? 'flash' : ''} {cls(k.killerSide)}">{r.playerName(k.assister)}</span>
        {/if}
      {/if}
      <span class="weapon">
        {#if k.attackerBlind}<span class="tag" title="Killer was blind">blind</span>{/if}
        {weaponName(k.weapon)}
        {#if k.wallbang}<span class="tag" title="Wallbang">wall</span>{/if}
        {#if k.throughSmoke}<span class="tag" title="Through smoke">smoke</span>{/if}
        {#if k.noScope}<span class="tag" title="No scope">noscope</span>{/if}
        {#if k.headshot}<span class="hs" title="Headshot">HS</span>{/if}
      </span>
      <span class={cls(k.victimSide)}>{r.playerName(k.victim)}</span>
    </div>
  {/each}
</div>

<style>
  .feed {
    position: absolute;
    top: 74px;
    right: 10px;
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
    gap: 6px;
    background: rgba(13, 17, 23, 0.85);
    padding: 3px 8px;
    border-radius: 5px;
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .row.mine {
    border-color: rgba(255, 93, 93, 0.7);
  }

  .weapon {
    color: var(--text-2);
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .tag {
    font-size: 10px;
    color: var(--muted);
  }

  .hs {
    font-size: 10px;
    color: var(--bad);
    font-weight: 700;
  }

  .flash {
    text-decoration: underline dotted;
  }
</style>
