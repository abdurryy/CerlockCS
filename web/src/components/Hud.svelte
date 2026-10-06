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
    const alive = [0, 0]
    for (let t = 0; t < 2; t++) {
      for (const p of r.teamPlayers[t]) {
        r.state(p, tick, s)
        if (s.present && s.alive) alive[t]++
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
</script>

<div class="hud">
  <div class="team left {cls(info.sides[0])}">
    <span class="name">{r.teamName(0)}</span>
    <span class="alive" title="Players alive">{info.alive[0]}</span>
  </div>
  <div class="score {cls(info.sides[0])}">{info.score[0]}</div>
  <div class="clock" class:planted={info.clock.phase === 'planted'} class:freeze={info.clock.phase === 'freeze'}>
    <span class="time mono">{info.clock.text}</span>
    <span class="round">Round {info.round + 1}{info.clock.phase === 'freeze' ? ' · freeze time' : ''}{info.clock.phase === 'planted' ? ' · bomb planted' : ''}</span>
  </div>
  <div class="score {cls(info.sides[1])}">{info.score[1]}</div>
  <div class="team right {cls(info.sides[1])}">
    <span class="alive" title="Players alive">{info.alive[1]}</span>
    <span class="name">{r.teamName(1)}</span>
  </div>
</div>

<style>
  .hud {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: stretch;
    gap: 2px;
    pointer-events: none;
    font-weight: 600;
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5));
  }

  .team,
  .score,
  .clock {
    background: rgba(13, 17, 23, 0.88);
    display: flex;
    align-items: center;
    padding: 0 10px;
  }

  .team {
    gap: 8px;
    max-width: 200px;
    border-radius: 8px 0 0 8px;
  }

  .team.right {
    border-radius: 0 8px 8px 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .alive {
    font-size: 15px;
    min-width: 12px;
    text-align: center;
  }

  .score {
    font-size: 20px;
    min-width: 40px;
    justify-content: center;
  }

  .clock {
    flex-direction: column;
    padding: 4px 14px;
    min-width: 120px;
  }

  .time {
    font-size: 20px;
    line-height: 1.1;
  }

  .round {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .clock.planted .time {
    color: var(--bad);
  }

  .clock.freeze .time {
    color: var(--text-2);
  }
</style>
