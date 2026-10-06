<script lang="ts">
  import { slotColor, teamColor } from '../lib/colors'
  import { money } from '../lib/format'
  import { weaponIcon } from '../lib/icons.svelte'
  import type { LiveStats } from '../lib/live'
  import { FLAG, UTIL, type PlayerState } from '../lib/replay'
  import type { Kill } from '../lib/types'
  import { EQ, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'

  // One player in the roster: health, gear, utility and score at the
  // current tick. Clicking it follows the player on the radar.
  let {
    name,
    slot,
    side,
    s,
    st,
    death = null,
    killer = '',
    followed,
    onclick,
  }: {
    name: string
    slot: number
    side: number
    s: PlayerState
    st: LiveStats
    death?: Kill | null
    killer?: string
    followed: boolean
    onclick: () => void
  } = $props()

  const team = $derived(teamColor(side))
  // How white the card is while the player is flashed, same curve as the radar.
  const blind = $derived(s.alive ? Math.min(1, s.flash / 1.6) : 0)
  const active = $derived(s.alive ? weaponIcon(s.weapon, side) : null)
  const primary = $derived(s.alive && s.primary && s.primary !== s.weapon ? s.primary : 0)
  const helmet = $derived((s.flags & FLAG.helmet) !== 0)

  interface Nade {
    id: number
    icon: string
    title: string
  }

  // Grenades held, from the utility bitmask.
  const nades = $derived.by(() => {
    const u = s.alive ? s.util : 0
    const out: Nade[] = []
    if (u & UTIL.he) out.push({ id: EQ.he, icon: 'weapon/hegrenade', title: 'HE grenade' })
    if (u & UTIL.flash1) out.push({ id: EQ.flash, icon: 'weapon/flashbang', title: 'Flashbang' })
    if (u & UTIL.flash2) out.push({ id: EQ.flash, icon: 'weapon/flashbang', title: 'Flashbang' })
    if (u & UTIL.smoke) out.push({ id: EQ.smoke, icon: 'weapon/smokegrenade', title: 'Smoke' })
    if (u & UTIL.fire) {
      out.push(side === 2 ? { id: EQ.molotov, icon: 'weapon/molotov', title: 'Molotov' } : { id: EQ.incendiary, icon: 'weapon/incgrenade', title: 'Incendiary' })
    }
    if (u & UTIL.decoy) out.push({ id: EQ.decoy, icon: 'weapon/decoy', title: 'Decoy' })
    return out
  })

  const deathText = $derived.by(() => {
    if (!death) return ''
    if (!killer) return death.killer === death.victim ? 'Killed themselves' : death.weapon === EQ.bomb ? 'Killed by the bomb' : 'Died'
    const how = [death.headshot && 'headshot', death.wallbang && 'through a wall', death.throughSmoke && 'through smoke'].filter(Boolean)
    return `Killed by ${killer} with ${weaponName(death.weapon)}${how.length ? ', ' + how.join(', ') : ''}`
  })

  // The grenade in hand is drawn brighter than the rest.
  const fire = (id: number) => id === EQ.molotov || id === EQ.incendiary
  const held = $derived(nades.findIndex((n) => n.id === s.weapon || (fire(n.id) && fire(s.weapon))))
</script>

<button
  class="card"
  class:dead={s.present && !s.alive}
  class:gone={!s.present}
  class:followed
  class:blinded={blind > 0.45}
  {onclick}
  aria-pressed={followed}
  title={followed ? `Stop following ${name}` : `Follow ${name}`}
  style:--team={team.base}
  style:--team-deep={team.deep}
>
  {#if blind > 0}<span class="flashed" style:opacity={blind}></span>{/if}

  <span class="top">
    <span class="slot num" style:--slot={slotColor(slot)}>{slot}</span>
    <span class="name">{name}</span>
    {#if blind > 0.2}<GameIcon name="kill/blind" h={13} title="Blind for {s.flash.toFixed(1)} s" />{/if}
    <span class="guns">
      {#if !s.present}
        <span class="label">Not connected</span>
      {:else if !s.alive}
        <GameIcon name="hud/dead" h={14} title="Dead" fallback="Dead" />
      {:else}
        {#if primary}<GameIcon name={weaponIcon(primary, side)} h={13} title={weaponName(primary)} fallback={weaponName(primary)} />{/if}
        {#if active}<span class="active"><GameIcon name={active} h={15} title={weaponName(s.weapon)} fallback={weaponName(s.weapon)} /></span>{/if}
      {/if}
    </span>
  </span>

  {#if s.present}
    {#if s.alive}
      <span class="hp" class:low={s.hp <= 25} style:--hp="{s.hp}%"><span class="lost"></span><span class="fill"></span></span>
    {/if}

    <span class="bottom">
      {#if s.alive}
        <span class="hpv num" class:low={s.hp <= 25} title="Health">{s.hp}</span>
      {/if}
      <span class="gear">
        {#if s.alive && s.armor > 0}
          <GameIcon name={helmet ? 'hud/armor-helmet' : 'hud/armor'} h={12} title="{helmet ? 'Kevlar and helmet' : 'Kevlar'}, {s.armor} armor" fallback={helmet ? 'K+H' : 'K'} />
        {/if}
        {#if s.alive && s.flags & FLAG.kit}<span class="kit"><GameIcon name="hud/defuse" h={12} title="Defuse kit" fallback="Kit" /></span>{/if}
        {#if s.alive && s.flags & FLAG.bomb}<span class="bomb"><GameIcon name="weapon/c4" h={13} title="Carrying the bomb" fallback="C4" /></span>{/if}
        {#if death}
          <span class="death" title={deathText}>
            {#if killer}<span class="by" style:color={teamColor(death.killerSide).base}>{killer}</span>{/if}
            <GameIcon name={weaponIcon(death.weapon, death.killerSide)} h={12} fallback={weaponName(death.weapon)} />
            {#if death.headshot}<GameIcon name="kill/headshot" h={12} />{/if}
          </span>
        {/if}
        {#if nades.length}
          <span class="nades">
            {#each nades as n, i (i)}
              <span class="nade" class:held={i === held}><GameIcon name={n.icon} h={14} title={n.title} fallback={n.title} /></span>
            {/each}
          </span>
        {/if}
      </span>
      <span class="kda num" title="Kills, assists, deaths">{st.kills}<i>/</i>{st.assists}<i>/</i>{st.deaths}</span>
      <span class="cash num" title="Money">{money(s.money)}</span>
    </span>
  {/if}
</button>

<style>
  .card {
    position: relative;
    width: 100%;
    height: 60px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    padding: 0 12px;
    text-align: left;
    background: transparent;
    border: none;
    border-top: 1px solid var(--line);
    border-radius: 0;
    font-weight: 400;
    color: var(--text);
    isolation: isolate;
  }

  .card:hover {
    background: var(--surface-2);
    border-color: var(--line);
  }

  .card:focus-visible {
    outline-offset: -2px;
  }

  .card.followed {
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-2));
    box-shadow: inset 2px 0 0 var(--accent);
  }

  /* White wash while flashed. Text turns dark once the card is bright. */
  .flashed {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: rgba(255, 255, 255, 0.9);
    pointer-events: none;
  }

  .blinded,
  .blinded .name,
  .blinded .hpv,
  .blinded .cash,
  .blinded .active {
    color: var(--bg);
  }

  .blinded .guns,
  .blinded .gear,
  .blinded .nade,
  .blinded .kda {
    color: rgba(11, 13, 17, 0.7);
  }

  .blinded .nade.held {
    color: var(--bg);
  }

  .blinded .kda i {
    color: rgba(11, 13, 17, 0.4);
  }

  .blinded .hp {
    background: rgba(11, 13, 17, 0.15);
  }

  .top,
  .bottom {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .top {
    height: 18px;
  }

  .slot {
    flex: none;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    background: var(--slot);
    color: var(--bg);
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guns {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-3);
  }

  .active {
    display: inline-flex;
    color: var(--text);
  }

  .hp {
    position: relative;
    height: 3px;
    margin-left: 24px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 1px;
    overflow: hidden;
  }

  .hp span {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--hp);
  }

  .fill {
    background: var(--team);
  }

  .hp.low .fill {
    background: var(--team-deep);
  }

  /* Health just lost, catches up a moment later. */
  .lost {
    background: rgba(255, 255, 255, 0.55);
    transition: width 0.45s ease-out 0.3s;
  }

  .bottom {
    height: 15px;
    gap: 10px;
  }

  .hpv {
    flex: none;
    width: 16px;
    margin-right: -2px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .hpv.low {
    color: var(--bad);
  }

  .gear {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    overflow: hidden;
  }

  .kit {
    display: inline-flex;
    color: var(--ct);
  }

  .bomb {
    display: inline-flex;
    color: var(--accent);
  }

  .death {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-3);
  }

  .by {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    opacity: 0.75;
  }

  .nades {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 2px;
  }

  .nade {
    display: inline-flex;
    color: var(--text-2);
  }

  .nade.held {
    color: var(--text);
  }

  .kda {
    flex: none;
    font-size: 12px;
    color: var(--text-2);
  }

  .kda i {
    font-style: normal;
    color: var(--text-3);
    margin: 0 2px;
  }

  .cash {
    flex: none;
    min-width: 42px;
    text-align: right;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
  }

  .dead .name,
  .dead .kda,
  .dead .cash {
    color: var(--text-3);
  }

  .dead .slot {
    background: var(--surface-3);
    color: var(--text-3);
  }

  .dead {
    gap: 6px;
  }

  .gone {
    height: 34px;
    opacity: 0.4;
  }

  .gone .slot {
    background: var(--surface-3);
    color: var(--text-3);
  }

  .gone .name {
    color: var(--text-3);
  }
</style>
