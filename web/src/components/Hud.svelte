<script lang="ts">
  import { roundClock, scoreAt } from '../lib/live'
  import { emptyState } from '../lib/replay'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const s = emptyState()

  const info = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    const alive: boolean[][] = [[], []]
    for (let t = 0; t < 2; t++) {
      for (const p of r.teamPlayers[t]) {
        r.state(p, tick, s)
        if (s.present) alive[t].push(s.alive)
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

  const cls = (side: number) => (side === 3 ? 'ct' : 't')
  const phase = $derived(
    info.clock.phase === 'freeze' ? 'freeze time' : info.clock.phase === 'planted' ? 'bomb planted' : info.clock.phase === 'over' ? 'round over' : 'live',
  )
</script>

<div class="hud">
  {#each [0, 1] as t (t)}
    <div class="team {t === 0 ? 'left' : 'right'} {cls(info.sides[t])}">
      <span class="name">{r.teamName(t)}</span>
      <span class="pips" title="Players alive">
        {#each info.alive[t] as a, i (i)}<i class:dead={!a}></i>{/each}
      </span>
      <span class="score mono">{info.score[t]}</span>
    </div>
    {#if t === 0}
      <div class="clock" class:planted={info.clock.phase === 'planted'}>
        <span class="time mono">{info.clock.text}</span>
        <span class="label">Round {info.round + 1} · {phase}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .hud {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 12px 18px 26px;
    pointer-events: none;
    background: linear-gradient(to bottom, rgba(14, 16, 19, 0.97), rgba(14, 16, 19, 0.88) 60%, rgba(14, 16, 19, 0));
  }

  .team {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .team.left {
    justify-content: flex-end;
  }

  .team.right {
    flex-direction: row-reverse;
    justify-content: flex-end;
  }

  .name {
    font-family: var(--serif);
    font-size: 16px;
    font-weight: 600;
    color: var(--paper);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score {
    font-size: 26px;
    font-weight: 600;
    line-height: 1;
    min-width: 32px;
    text-align: center;
  }

  .ct .score {
    color: var(--ct);
  }

  .t .score {
    color: var(--t);
  }

  .pips {
    display: flex;
    gap: 3px;
  }

  .pips i {
    width: 4px;
    height: 14px;
    border-radius: 1px;
    background: currentColor;
  }

  .ct .pips {
    color: var(--ct);
  }

  .t .pips {
    color: var(--t);
  }

  .pips i.dead {
    background: var(--rule-2);
  }

  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 26px;
    border-left: 1px solid var(--rule-2);
    border-right: 1px solid var(--rule-2);
    margin: 0 18px;
  }

  .time {
    font-size: 24px;
    font-weight: 500;
    line-height: 1.1;
  }

  .clock.planted .time {
    color: var(--marker);
  }

  .label {
    white-space: nowrap;
  }
</style>
