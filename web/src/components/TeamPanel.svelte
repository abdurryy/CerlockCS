<script lang="ts">
  import { statsAt } from '../lib/live'
  import { emptyState, FLAG, UTIL, type PlayerState } from '../lib/replay'
  import { SLOT_COLORS } from '../lib/render/renderer'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'
  import Glyph from './Glyph.svelte'

  let { v, team }: { v: Viewer; team: number } = $props()
  const r = $derived(v.replay)
  const players = $derived(r.teamPlayers[team])

  const view = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    const stats = statsAt(r, tick)
    const states: PlayerState[] = players.map((p) => r.state(p, tick, emptyState()))
    const rows = players
      .map((p, i) => ({ p, s: states[i], st: stats[p] }))
      .filter((x) => x.s.present || x.st.kills || x.st.deaths)
    const money = rows.reduce((a, x) => a + (x.s.present ? x.s.money : 0), 0)
    return { side: r.sideOf(team, round), rows, money }
  })

  function utility(u: number): string[] {
    const out = []
    if (u & UTIL.smoke) out.push('smoke')
    if (u & UTIL.flash1) out.push('flash')
    if (u & UTIL.flash2) out.push('flash')
    if (u & UTIL.he) out.push('he')
    if (u & UTIL.fire) out.push('fire')
    if (u & UTIL.decoy) out.push('decoy')
    return out
  }

  const hpColor = (hp: number) => (hp > 50 ? 'var(--verdigris)' : hp > 20 ? 'var(--evidence)' : 'var(--marker)')
</script>

<section class={view.side === 3 ? 'ct' : 't'}>
  <header>
    <span class="side mono">{view.side === 3 ? 'CT' : 'T'}</span>
    <h2>{r.teamName(team)}</h2>
    <span class="money mono" title="Team money">${view.money.toLocaleString('en-US')}</span>
  </header>
  {#each view.rows as { p, s, st } (p)}
    <button class="row" class:dead={!s.alive} class:followed={v.follow === p} onclick={() => v.setFollow(p)} title="Follow {r.playerName(p)}">
      <span class="slot mono" style="--slot: {SLOT_COLORS[(r.slot[p] - 1) % SLOT_COLORS.length]}">{r.slot[p]}</span>
      <span class="main">
        <span class="line">
          <span class="name">{r.playerName(p)}</span>
          <span class="kda mono">{st.kills}<i>/</i>{st.assists}<i>/</i>{st.deaths}</span>
        </span>
        {#if s.alive}
          <span class="hp"><span style="width: {s.hp}%; background: {hpColor(s.hp)}"></span></span>
          <span class="line">
            <span class="gear mono">
              <span class="weapon">{weaponName(s.weapon)}</span>
              {#if s.primary && s.primary !== s.weapon}<span class="faint">{weaponName(s.primary)}</span>{/if}
            </span>
            <span class="cash mono">${s.money}</span>
          </span>
          <span class="line kit">
            <span class="icons">
              {#if s.armor > 0}<Glyph name={s.flags & FLAG.helmet ? 'helmet' : 'armor'} title={s.flags & FLAG.helmet ? 'Kevlar and helmet' : 'Kevlar'} />{/if}
              {#if s.flags & FLAG.kit}<Glyph name="kit" title="Defuse kit" />{/if}
              {#if s.flags & FLAG.bomb}<Glyph name="bomb" title="Bomb" />{/if}
              {#if s.armor > 0 || s.flags & (FLAG.kit | FLAG.bomb)}<span class="sep"></span>{/if}
              {#each utility(s.util) as u, i (i)}<Glyph name={u} title={u} />{/each}
            </span>
            {#if s.flash > 0.3}<span class="blind mono">blind {s.flash.toFixed(1)}</span>{:else}<span class="hpv mono">{s.hp}</span>{/if}
          </span>
        {:else}
          <span class="line">
            <span class="label">{s.present ? 'dead' : 'not connected'}</span>
            <span class="cash mono">${s.money}</span>
          </span>
        {/if}
      </span>
    </button>
  {/each}
</section>

<style>
  section {
    padding: 14px 0 8px;
    border-bottom: 1px solid var(--rule);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 0 14px 10px;
  }

  .side {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .ct .side {
    color: var(--ct);
  }

  .t .side {
    color: var(--t);
  }

  h2 {
    flex: 1;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .money {
    color: var(--verdigris);
    font-size: 11.5px;
  }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 10px;
    text-align: left;
    padding: 8px 14px 8px 12px;
    border: none;
    border-top: 1px solid var(--rule);
    border-left: 2px solid transparent;
    border-radius: 0;
  }

  .row:hover {
    background: var(--desk-2);
  }

  .row.followed {
    background: var(--desk-2);
    border-left-color: var(--marker);
  }

  .row.dead {
    opacity: 0.45;
  }

  .row.dead .name {
    text-decoration: line-through;
    text-decoration-color: rgba(236, 230, 218, 0.4);
  }

  .slot {
    font-size: 12px;
    font-weight: 600;
    color: var(--slot);
    padding-top: 1px;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kda {
    font-size: 11px;
    color: var(--graphite);
    white-space: nowrap;
  }

  .kda i {
    font-style: normal;
    color: var(--pencil);
    margin: 0 2px;
  }

  .hp {
    height: 2px;
    background: var(--rule-2);
    display: block;
  }

  .hp span {
    display: block;
    height: 100%;
  }

  .gear {
    display: flex;
    gap: 7px;
    font-size: 11.5px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }

  .weapon {
    color: var(--paper);
  }

  .cash {
    font-size: 11px;
    color: var(--verdigris);
  }

  .icons {
    display: flex;
    gap: 4px;
    align-items: center;
    min-height: 12px;
  }

  .sep {
    width: 1px;
    height: 10px;
    background: var(--rule-2);
    margin: 0 2px;
  }

  .hpv {
    font-size: 11px;
    color: var(--pencil);
  }

  .blind {
    font-size: 10.5px;
    color: var(--ink);
    background: var(--paper);
    padding: 0 4px;
    border-radius: 2px;
  }
</style>
