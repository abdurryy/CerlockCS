<script lang="ts">
  import { roundClock } from '../lib/live'
  import { SPEEDS, type Viewer } from '../lib/viewer.svelte'
  import { REASON, weaponName } from '../lib/weapons'
  import Icon from './Icon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)

  let track: HTMLDivElement
  let scrubbing = false

  const round = $derived(v.round)
  const rd = $derived(rounds[round])
  const span = $derived({ from: rd.startTick, to: Math.max(rd.officialEndTick, rd.endTick + r.rate) })
  const frac = (tick: number) => Math.max(0, Math.min(1, (tick - span.from) / (span.to - span.from)))
  const clock = $derived(roundClock(r, v.tick))

  const markers = $derived.by(() => {
    const out: { tick: number; cls: string; title: string }[] = []
    for (const k of r.roundKills[round]) {
      out.push({
        tick: k.tick,
        cls: `kill ${k.killerSide === 3 ? 'ct' : 't'}`,
        title: `${r.playerName(k.killer)} killed ${r.playerName(k.victim)} (${weaponName(k.weapon)}${k.headshot ? ', HS' : ''})`,
      })
    }
    for (const b of r.roundBomb[round]) {
      if (b.kind === 'planted') out.push({ tick: b.tick, cls: 'plant', title: `Bomb planted on ${b.site} by ${r.playerName(b.player)}` })
      if (b.kind === 'defused') out.push({ tick: b.tick, cls: 'defuse', title: `Bomb defused by ${r.playerName(b.player)}` })
      if (b.kind === 'exploded') out.push({ tick: b.tick, cls: 'boom', title: 'Bomb exploded' })
    }
    return out
  })

  function seekAt(e: PointerEvent) {
    const rect = track.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    v.seek(span.from + f * (span.to - span.from))
  }

  function down(e: PointerEvent) {
    scrubbing = true
    track.setPointerCapture(e.pointerId)
    seekAt(e)
  }

  function move(e: PointerEvent) {
    if (scrubbing) seekAt(e)
  }

  function roundTitle(i: number): string {
    const x = rounds[i]
    const won = x.winnerTeam >= 0 ? r.teamName(x.winnerTeam) : 'nobody'
    return `Round ${i + 1}: ${won} won (${REASON[x.reason] ?? x.reason}), ${x.scoreA} - ${x.scoreB}`
  }

  function halftime(i: number): boolean {
    return i > 0 && rounds[i].sideOf[0] !== rounds[i - 1].sideOf[0]
  }
</script>

<div class="timeline">
  <div class="controls">
    <button class="ghost" onclick={() => v.seekRound(round - 1)} title="Previous round (P)"><Icon name="prev" size={14} /></button>
    <button class="ghost" onclick={() => v.step(-5)} title="Back 5 seconds"><Icon name="rewind" size={14} /></button>
    <button class="play" onclick={() => v.toggle()} title="Play / pause (Space)"><Icon name={v.playing ? 'pause' : 'play'} size={16} /></button>
    <button class="ghost" onclick={() => v.step(5)} title="Forward 5 seconds"><Icon name="forward" size={14} /></button>
    <button class="ghost" onclick={() => v.seekRound(round + 1)} title="Next round (N)"><Icon name="next" size={14} /></button>
    <select bind:value={v.speed} title="Playback speed ([ and ])">
      {#each SPEEDS as s (s)}<option value={s}>{s}x</option>{/each}
    </select>
    <span class="time mono">R{round + 1} · {clock.text}</span>
    <div class="rounds">
      {#each rounds as x, i (i)}
        {#if halftime(i)}<span class="half" title="Sides switch"></span>{/if}
        <button
          class="round {x.winner === 3 ? 'ct' : x.winner === 2 ? 't' : ''}"
          class:current={i === round}
          title={roundTitle(i)}
          onclick={() => v.seekRound(i)}
        >{i + 1}</button>
      {/each}
    </div>
  </div>
  <div class="track" bind:this={track} onpointerdown={down} onpointermove={move} onpointerup={() => (scrubbing = false)} role="slider" aria-valuenow={v.tick} tabindex="-1">
    <div class="freeze" style="width: {frac(rd.freezeEndTick) * 100}%"></div>
    <div class="over" style="left: {frac(rd.endTick) * 100}%"></div>
    <div class="progress" style="width: {frac(v.tick) * 100}%"></div>
    {#each markers as m, i (i)}
      <span class="marker {m.cls}" style="left: {frac(m.tick) * 100}%" title={m.title}></span>
    {/each}
    <div class="head" style="left: {frac(v.tick) * 100}%"></div>
  </div>
</div>

<style>
  .timeline {
    padding: 6px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .controls button {
    display: inline-flex;
    align-items: center;
    padding: 5px 7px;
  }

  .play {
    padding: 6px 12px !important;
    background: var(--accent);
    border-color: var(--accent);
    color: #0b0f14;
  }

  .play:hover {
    background: #98b0ff;
  }

  select {
    margin-left: 4px;
  }

  .time {
    margin: 0 10px;
    color: var(--text-2);
    min-width: 72px;
  }

  .rounds {
    flex: 1;
    display: flex;
    gap: 2px;
    overflow-x: auto;
    padding: 2px 0;
  }

  .round {
    min-width: 24px;
    height: 22px;
    padding: 0 4px;
    font-size: 11px;
    border-radius: 4px;
    background: var(--panel-3);
    border: 1px solid transparent;
    color: var(--text-2);
  }

  .round.ct {
    background: rgba(90, 169, 255, 0.22);
    color: #cfe5ff;
  }

  .round.t {
    background: rgba(245, 165, 36, 0.22);
    color: #ffe2b0;
  }

  .round.current {
    border-color: #fff;
    color: #fff;
  }

  .half {
    width: 2px;
    margin: 0 3px;
    background: var(--line-2);
    border-radius: 1px;
  }

  .track {
    position: relative;
    height: 22px;
    background: var(--panel-3);
    border-radius: 5px;
    cursor: pointer;
    overflow: hidden;
    touch-action: none;
  }

  .freeze {
    position: absolute;
    inset: 0 auto 0 0;
    background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0 6px, transparent 6px 12px);
  }

  .over {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.3);
  }

  .progress {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(124, 156, 255, 0.18);
  }

  .head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #fff;
    transform: translateX(-1px);
  }

  .marker {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1.5px solid #0b0f14;
  }

  .marker.ct {
    background: var(--ct);
  }

  .marker.t {
    background: var(--t);
  }

  .marker.plant,
  .marker.defuse,
  .marker.boom {
    border-radius: 2px;
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .marker.plant {
    background: var(--bad);
  }

  .marker.defuse {
    background: var(--good);
  }

  .marker.boom {
    background: #ff8c2e;
  }
</style>
