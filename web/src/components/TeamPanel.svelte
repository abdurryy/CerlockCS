<script lang="ts">
  import { statsAt } from '../lib/live'
  import { emptyState, FLAG, UTIL, type PlayerState } from '../lib/replay'
  import { SLOT_COLORS } from '../lib/render/renderer'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'

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

  function utility(u: number): { cls: string; label: string; title: string }[] {
    const out = []
    if (u & UTIL.smoke) out.push({ cls: 'smoke', label: 'S', title: 'Smoke' })
    if (u & UTIL.flash1) out.push({ cls: 'flash', label: 'F', title: 'Flash' })
    if (u & UTIL.flash2) out.push({ cls: 'flash', label: 'F', title: 'Flash' })
    if (u & UTIL.he) out.push({ cls: 'he', label: 'H', title: 'HE grenade' })
    if (u & UTIL.fire) out.push({ cls: 'fire', label: 'M', title: 'Molotov / incendiary' })
    if (u & UTIL.decoy) out.push({ cls: 'decoy', label: 'D', title: 'Decoy' })
    return out
  }
</script>

<section class="panel {view.side === 3 ? 'ct' : 't'}">
  <header>
    <span class="side">{view.side === 3 ? 'CT' : 'T'}</span>
    <strong class="name">{r.teamName(team)}</strong>
    <span class="money mono" title="Team money">${view.money.toLocaleString('en-US')}</span>
  </header>
  {#each view.rows as { p, s, st } (p)}
    <button class="row" class:dead={!s.alive} class:followed={v.follow === p} onclick={() => v.setFollow(p)} title="Follow {r.playerName(p)}">
      <span class="slot" style="background: {SLOT_COLORS[(r.slot[p] - 1) % SLOT_COLORS.length]}">{r.slot[p]}</span>
      <span class="who">
        <span class="pname">{r.playerName(p)}</span>
        <span class="kda mono">{st.kills} / {st.assists} / {st.deaths}</span>
      </span>
      {#if s.alive}
        <span class="hp">
          <span class="bar"><span style="width: {s.hp}%" class:low={s.hp <= 30}></span></span>
          <span class="mono val">{s.hp}</span>
        </span>
        <span class="gear">
          <span class="weapon">{weaponName(s.weapon)}</span>
          {#if s.primary && s.primary !== s.weapon}<span class="muted">{weaponName(s.primary)}</span>{/if}
        </span>
        <span class="extras">
          {#if s.armor > 0}<span class="badge" title={s.flags & FLAG.helmet ? 'Kevlar and helmet' : 'Kevlar'}>{s.flags & FLAG.helmet ? 'AH' : 'A'}</span>{/if}
          {#if s.flags & FLAG.kit}<span class="badge kit" title="Defuse kit">K</span>{/if}
          {#if s.flags & FLAG.bomb}<span class="badge bomb" title="Carrying the bomb">C4</span>{/if}
          {#each utility(s.util) as u, i (i)}<span class="nade {u.cls}" title={u.title}>{u.label}</span>{/each}
          {#if s.flash > 0.3}<span class="blind">blind {s.flash.toFixed(1)}s</span>{/if}
        </span>
        <span class="cash mono">${s.money}</span>
      {:else}
        <span class="dead-label">{s.present ? 'dead' : 'not connected'}</span>
        <span class="cash mono">${s.money}</span>
      {/if}
    </button>
  {/each}
</section>

<style>
  .panel {
    padding: 8px 8px 10px;
    border-bottom: 1px solid var(--line);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 4px 8px;
  }

  .side {
    font-size: 11px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    color: #0b0f14;
  }

  .ct .side {
    background: var(--ct);
  }

  .t .side {
    background: var(--t);
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .money {
    color: var(--good);
    font-size: 12px;
  }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 20px 1fr 64px;
    grid-template-areas:
      'slot who hp'
      'slot gear cash'
      'slot extras extras';
    gap: 2px 8px;
    text-align: left;
    padding: 6px 6px;
    margin-bottom: 3px;
    background: var(--panel-2);
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    border-radius: 6px;
  }

  .ct .row {
    border-left-color: rgba(90, 169, 255, 0.6);
  }

  .t .row {
    border-left-color: rgba(245, 165, 36, 0.6);
  }

  .row:hover {
    background: var(--panel-3);
  }

  .row.followed {
    border-color: rgba(255, 255, 255, 0.6);
    background: #1d2633;
  }

  .row.dead {
    opacity: 0.5;
  }

  .slot {
    grid-area: slot;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #0b0f14;
    font-weight: 700;
    font-size: 11px;
    margin-top: 2px;
  }

  .who {
    grid-area: who;
    display: flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
  }

  .pname {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kda {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }

  .hp {
    grid-area: hp;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .bar {
    flex: 1;
    height: 5px;
    background: #2a3340;
    border-radius: 3px;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--good);
  }

  .bar span.low {
    background: var(--bad);
  }

  .val {
    font-size: 11px;
    width: 22px;
    text-align: right;
  }

  .gear {
    grid-area: gear;
    display: flex;
    gap: 6px;
    font-size: 12px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }

  .weapon {
    font-weight: 600;
  }

  .cash {
    grid-area: cash;
    text-align: right;
    font-size: 11px;
    color: var(--good);
  }

  .extras {
    grid-area: extras;
    display: flex;
    gap: 3px;
    align-items: center;
    flex-wrap: wrap;
    min-height: 15px;
  }

  .badge,
  .nade {
    font-size: 10px;
    font-weight: 700;
    line-height: 14px;
    padding: 0 4px;
    border-radius: 3px;
    background: #2a3340;
    color: var(--text-2);
  }

  .badge.kit {
    color: var(--ct);
  }

  .badge.bomb {
    background: #4a1f22;
    color: #ff8080;
  }

  .nade.smoke {
    background: #3a414b;
    color: #e6edf3;
  }

  .nade.flash {
    background: #4a4630;
    color: #fff4b0;
  }

  .nade.he {
    background: #4a2420;
    color: #ff8a7a;
  }

  .nade.fire {
    background: #4a2c18;
    color: #ffae6b;
  }

  .nade.decoy {
    background: #263a28;
    color: #8bd18b;
  }

  .blind {
    font-size: 10px;
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    padding: 0 4px;
    border-radius: 3px;
  }

  .dead-label {
    grid-area: gear;
    font-size: 12px;
    color: var(--muted);
  }
</style>
