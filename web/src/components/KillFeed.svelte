<script lang="ts">
  import { flip } from 'svelte/animate'
  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import { weaponIcon } from '../lib/icons.svelte'
  import type { Kill } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)

  // Kills from the last few seconds, like the in game feed.
  const recent = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    return r.roundKills[round].filter((k) => k.tick <= tick && tick - k.tick < 6 * r.rate).slice(-6)
  })

  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const cls = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')

  // Rows with the followed player get the in game treatment: an outline
  // for their kills, a red tint for their death.
  function mark(k: Kill): string {
    if (v.follow < 0) return ''
    if (k.victim === v.follow) return 'died'
    if (k.killer === v.follow) return 'got'
    return ''
  }
</script>

<div class="feed" aria-label="Kill feed">
  {#each recent as k (k.tick * 100 + k.victim)}
    <div
      class="row {mark(k)}"
      in:fly={{ x: 18, duration: still ? 0 : 220, easing: cubicOut }}
      out:fade={{ duration: still ? 0 : 140 }}
      animate:flip={{ duration: still ? 0 : 180 }}
    >
      {#if k.killer >= 0 && k.killer !== k.victim}
        <span class="name {cls(k.killerSide)}">{r.playerName(k.killer)}</span>
        {#if k.assister >= 0}
          <!-- The flash assist icon has its own plus, like in game. -->
          {#if k.flashAssist}
            <span class="assist"><GameIcon name="kill/flash" h={16} title="Flash assist" fallback="+" /></span>
          {:else}
            <span class="plus">+</span>
          {/if}
          <span class="name {cls(k.killerSide)}">{r.playerName(k.assister)}</span>
        {/if}
      {/if}
      <span class="icons">
        {#if k.attackerBlind}<GameIcon name="kill/blind" h={16} title="Killer was blind" fallback="blind" />{/if}
        <GameIcon name={weaponIcon(k.weapon, k.killerSide)} h={17} title={weaponName(k.weapon)} fallback={weaponName(k.weapon)} />
        {#if k.noScope}<GameIcon name="kill/noscope" h={16} title="No scope" fallback="noscope" />{/if}
        {#if k.throughSmoke}<GameIcon name="kill/smoke" h={16} title="Through smoke" fallback="smoke" />{/if}
        {#if k.wallbang}<GameIcon name="kill/penetrate" h={16} title="Wallbang" fallback="wall" />{/if}
        {#if k.headshot}<GameIcon name="kill/headshot" h={16} title="Headshot" fallback="HS" />{/if}
      </span>
      <span class="name {cls(k.victimSide)}">{r.playerName(k.victim)}</span>
    </div>
  {/each}
</div>

<style>
  .feed {
    position: absolute;
    top: 72px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    pointer-events: none;
    max-width: calc(50% - 12px);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 11px;
    max-width: 100%;
    background: rgba(9, 11, 14, 0.72);
    border-radius: var(--radius-sm);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    font-family: var(--display);
    font-weight: 600;
    font-size: 13.5px;
    line-height: 1;
    white-space: nowrap;
    color: var(--text);
  }

  .row.got {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .row.died {
    background: rgba(118, 22, 28, 0.82);
  }

  .name {
    min-width: 0;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.01em;
  }

  .plus {
    color: var(--text-2);
    font-weight: 500;
    margin: 0 -2px;
  }

  .assist {
    display: inline-flex;
    color: var(--text-2);
  }

  .icons {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 0 2px;
    color: #fff;
    flex: none;
  }
</style>
