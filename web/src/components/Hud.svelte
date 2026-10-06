<script lang="ts">
  import { roundClock, scoreAt } from '../lib/live'
  import { emptyState } from '../lib/replay'
  import type { Viewer } from '../lib/viewer.svelte'
  import GameIcon from './GameIcon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const s = emptyState()

  const PLANT_SECONDS = 3.2

  const info = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    const alive: { p: number; alive: boolean }[][] = [[], []]
    for (let t = 0; t < 2; t++) {
      for (const p of r.teamPlayers[t]) {
        r.state(p, tick, s)
        if (s.present) alive[t].push({ p, alive: s.alive })
      }
    }
    return {
      round,
      clock: roundClock(r, tick),
      score: scoreAt(r, tick),
      sides: [r.sideOf(0, round), r.sideOf(1, round)],
      alive,
    }
  })

  // What is happening with the bomb right now: being planted (with progress
  // from 0 to 1), planted and where, or being defused.
  const bomb = $derived.by(() => {
    const tick = v.tick
    const round = info.round
    const rd = r.round(round)
    if (tick >= rd.endTick) return null
    let plant: { site: string; tick: number } | null = null
    let action: { kind: 'planting' | 'defusing'; tick: number; kit: boolean } | null = null
    for (const e of r.roundBomb[round]) {
      if (e.tick > tick) break
      if (e.kind === 'plant_begin') action = { kind: 'planting', tick: e.tick, kit: false }
      else if (e.kind === 'defuse_begin') action = { kind: 'defusing', tick: e.tick, kit: !!e.kit }
      else if (e.kind === 'plant_abort' || e.kind === 'defuse_abort') action = null
      else if (e.kind === 'planted') {
        plant = { site: e.site, tick: e.tick }
        action = null
      } else if (e.kind === 'defused' || e.kind === 'exploded') return null
    }
    if (action) {
      const need = action.kind === 'planting' ? PLANT_SECONDS : action.kit ? 5 : 10
      const done = Math.min(1, (tick - action.tick) / r.rate / need)
      if (done < 1) return { ...action, site: plant?.site ?? '', progress: done }
    }
    if (plant) return { kind: 'planted' as const, site: plant.site }
    return null
  })

  const cls = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')
  const sideName = (side: number) => (side === 3 ? 'Counter-Terrorists' : 'Terrorists')

  const winner = $derived(info.clock.phase === 'over' ? r.round(info.round).winner : 0)
  const phase = $derived(info.clock.phase === 'freeze' ? 'Freeze time' : info.clock.phase === 'over' ? 'Round over' : '')

  // The thin bar under the clock: round time, or the bomb timer once planted.
  const bar = $derived.by(() => {
    const c = info.clock
    const rd = r.round(info.round)
    if (c.phase === 'planted') return Math.max(0, c.seconds / rd.bombTime)
    if (c.phase === 'live') return Math.max(0, c.seconds / rd.roundTime)
    if (c.phase === 'freeze') return Math.max(0, (c.seconds * r.rate) / Math.max(1, rd.freezeEndTick - rd.startTick))
    return 0
  })

  const siteIcon = (site: string) => (site === 'A' ? 'hud/bombsite-a' : site === 'B' ? 'hud/bombsite-b' : null)
</script>

<div class="hud">
  <div class="bar">
    {#each [0, 1] as t (t)}
      <div class="team {t === 0 ? 'left' : 'right'} {cls(info.sides[t])}">
        <span class="side">
          <GameIcon name={info.sides[t] === 3 ? 'kill/ct' : 'kill/t'} h={22} title={sideName(info.sides[t])} fallback={info.sides[t] === 3 ? 'CT' : 'T'} />
        </span>
        <span class="name" title={r.teamName(t)}>{r.teamName(t)}</span>
        <span class="alive" title="{info.alive[t].filter((a) => a.alive).length} alive">
          {#each info.alive[t] as a (a.p)}
            <i class:dead={!a.alive} class:follow={a.p === v.follow}>{r.slot[a.p]}</i>
          {/each}
        </span>
        <span class="score num">{info.score[t]}</span>
      </div>
      {#if t === 0}
        <div class="clock {info.clock.phase}">
          <span class="time num">
            {#if info.clock.phase === 'planted'}<GameIcon name="weapon/c4" h={15} title="Bomb planted" />{/if}
            {info.clock.text}
          </span>
          <span class="sub">
            {#if bomb && bomb.kind !== 'planted'}
              <GameIcon name={bomb.kind === 'planting' ? 'weapon/c4' : 'hud/defuse'} h={11} />
              <span>{bomb.kind === 'planting' ? 'Planting' : bomb.kit ? 'Kit defuse' : 'Defusing'}</span>
            {:else if bomb}
              <span>Bomb on</span>
              <GameIcon name={siteIcon(bomb.site)} h={12} title="Site {bomb.site}" fallback={bomb.site} />
            {:else if winner}
              <span class={cls(winner)}>{winner === 3 ? 'CT' : 'T'} win</span>
            {:else}
              <span>Round {info.round + 1}{phase ? ` · ${phase}` : ''}</span>
            {/if}
          </span>
          <span class="track">
            {#if bomb && bomb.kind !== 'planted'}
              <i class="act {bomb.kind}" style:width="{bomb.progress * 100}%"></i>
            {:else}
              <i style:width="{bar * 100}%"></i>
            {/if}
          </span>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .hud {
    position: absolute;
    top: 10px;
    left: 12px;
    right: 12px;
    display: flex;
    justify-content: center;
    pointer-events: none;
    container-type: inline-size;
  }

  .bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: stretch;
    width: min(840px, 100%);
    height: 52px;
    background: rgba(9, 11, 14, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    overflow: hidden;
  }

  .team {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0 0 0 12px;
  }

  .team.right {
    flex-direction: row-reverse;
    padding: 0 12px 0 0;
  }

  /* A thin side coloured edge under each half. */
  .team::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: currentColor;
    opacity: 0.85;
  }

  .side {
    display: inline-flex;
    flex: none;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--display);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right .name {
    text-align: right;
  }

  .alive {
    display: flex;
    gap: 3px;
    flex: none;
  }

  .alive i {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-style: normal;
    font-family: var(--display);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--bg);
  }

  /* Alive players look like the radar tokens, dead ones are just a ring. */
  .ct .alive i {
    background: var(--ct);
  }

  .t .alive i {
    background: var(--t);
  }

  .alive i.dead {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-2);
    color: var(--text-3);
  }

  .alive i.follow {
    box-shadow: 0 0 0 1.5px var(--bg), 0 0 0 3px var(--accent);
  }

  .alive i.dead.follow {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .score {
    flex: none;
    align-self: stretch;
    display: grid;
    place-items: center;
    min-width: 46px;
    font-family: var(--display);
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
    background: rgba(255, 255, 255, 0.035);
  }

  .left .score {
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  .right .score {
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  .clock {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 124px;
    padding: 0 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.07);
    border-right: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.25);
  }

  .time {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--display);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }

  .clock.planted .time {
    color: var(--accent);
  }

  .clock.freeze .time,
  .clock.over .time {
    color: var(--text-2);
  }

  .sub {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--display);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-3);
    white-space: nowrap;
  }

  .clock.planted .sub {
    color: var(--text-2);
  }

  .track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.06);
  }

  .track i {
    display: block;
    height: 100%;
    background: var(--text-3);
  }

  .clock.planted .track i {
    background: var(--accent);
  }

  .track i.act.planting {
    background: var(--t);
  }

  .track i.act.defusing {
    background: var(--ct);
  }

  /* Narrow stages: the alive tokens become pips so the names fit. */
  @container (max-width: 720px) {
    .alive {
      gap: 2px;
    }

    .alive i {
      width: 5px;
      height: 15px;
      border-radius: 2px;
      font-size: 0;
    }

    .alive i.follow {
      box-shadow: 0 0 0 1px var(--bg), 0 0 0 2px var(--accent);
    }

    .team {
      gap: 8px;
    }

    .name {
      font-size: 14px;
    }

    .score {
      min-width: 40px;
      font-size: 24px;
    }
  }

  @container (max-width: 470px) {
    .name {
      display: none;
    }
  }
</style>
