<script lang="ts">
  import { roundClock } from '../lib/live'
  import { teamColor } from '../lib/render/renderer'
  import { SPEEDS, type Viewer } from '../lib/viewer.svelte'
  import { REASON, weaponName } from '../lib/weapons'
  import Icon from './Icon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)

  let track: HTMLDivElement
  let width = $state(800)
  const H = 54
  let scrubbing = false

  const round = $derived(v.round)
  const rd = $derived(rounds[round])
  const info = $derived(r.report.rounds[round])
  const span = $derived({ from: rd.startTick, to: Math.max(rd.officialEndTick, rd.endTick + r.rate) })
  const frac = (tick: number) => Math.max(0, Math.min(1, (tick - span.from) / (span.to - span.from)))
  const clock = $derived(roundClock(r, v.tick))
  const colors = $derived([teamColor(rd.sideOf[0]), teamColor(rd.sideOf[1])])

  // Win chance for team A over the round as a step line: it only changes
  // when someone dies or the bomb goes down.
  const wp = $derived.by(() => {
    const pts = info?.winProb ?? []
    if (!pts.length) return null
    const y = (p: number) => 6 + (1 - p) * (H - 12)
    let d = `M ${frac(span.from) * width} ${y(pts[0].p)}`
    let prev = pts[0].p
    for (const pt of pts) {
      const x = frac(pt.tick) * width
      d += ` L ${x} ${y(prev)} L ${x} ${y(pt.p)}`
      prev = pt.p
    }
    d += ` L ${width} ${y(prev)}`
    const area = `${d} L ${width} ${H / 2} L 0 ${H / 2} Z`
    let now = pts[0].p
    for (const pt of pts) if (pt.tick <= v.tick) now = pt.p
    return { line: d, area, now, y }
  })

  const kills = $derived.by(() => {
    const pts = info?.winProb ?? []
    return r.roundKills[round].map((k) => {
      let p = 0.5
      for (const pt of pts) if (pt.tick <= k.tick) p = pt.p
      return {
        x: frac(k.tick) * width,
        y: wp ? wp.y(p) : H / 2,
        side: k.killerSide,
        title: `${r.playerName(k.killer)} killed ${r.playerName(k.victim)} (${weaponName(k.weapon)}${k.headshot ? ', hs' : ''})`,
      }
    })
  })

  const bombs = $derived(
    r.roundBomb[round]
      .filter((b) => b.kind === 'planted' || b.kind === 'defused' || b.kind === 'exploded')
      .map((b) => ({ x: frac(b.tick) * width, kind: b.kind, title: b.kind === 'planted' ? `Planted on ${b.site}` : b.kind === 'defused' ? 'Defused' : 'Exploded' })),
  )

  const evidence = $derived(
    r.roundBlunders[round].map((b, i) => ({ x: frac(b.tick) * width, n: i + 1, title: `${b.title}: ${b.detail}`, id: r.blunders.indexOf(b) })),
  )

  function seekAt(e: PointerEvent) {
    const rect = track.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    v.seek(span.from + f * (span.to - span.from))
  }

  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.tent')) return
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
    return `Round ${i + 1}: ${won} (${REASON[x.reason] ?? x.reason}), ${x.scoreA} : ${x.scoreB}`
  }

  function halftime(i: number): boolean {
    return i > 0 && rounds[i].sideOf[0] !== rounds[i - 1].sideOf[0]
  }
</script>

<div class="timeline">
  <div class="controls">
    <button class="plain" onclick={() => v.seekRound(round - 1)} title="Previous round (P)"><Icon name="prev" size={13} /></button>
    <button class="plain" onclick={() => v.step(-5)} title="Back 5 seconds"><Icon name="rewind" size={13} /></button>
    <button class="play" onclick={() => v.toggle()} title="Play or pause (Space)"><Icon name={v.playing ? 'pause' : 'play'} size={15} /></button>
    <button class="plain" onclick={() => v.step(5)} title="Forward 5 seconds"><Icon name="forward" size={13} /></button>
    <button class="plain" onclick={() => v.seekRound(round + 1)} title="Next round (N)"><Icon name="next" size={13} /></button>
    <select class="mono" bind:value={v.speed} title="Playback speed ([ and ])">
      {#each SPEEDS as s (s)}<option value={s}>{s}x</option>{/each}
    </select>
    <span class="time mono" class:planted={clock.phase === 'planted'}>R{round + 1} · {clock.text}</span>
    <div class="rounds">
      {#each rounds as x, i (i)}
        {#if halftime(i)}<span class="half" title="Sides switch"></span>{/if}
        <button
          class="round mono {x.winner === 3 ? 'ct' : x.winner === 2 ? 't' : ''}"
          class:current={i === round}
          title={roundTitle(i)}
          onclick={() => v.seekRound(i)}
        >
          {i + 1}
          {#if r.roundBlunders[i].length}<i></i>{/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="track" bind:this={track} bind:clientWidth={width} onpointerdown={down} onpointermove={move} onpointerup={() => (scrubbing = false)} role="slider" aria-valuenow={v.tick} tabindex="-1">
    <svg {width} height={H} aria-hidden="true">
      <defs>
        <linearGradient id="wp" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color={colors[0].base} stop-opacity="0.38" />
          <stop offset="0.5" stop-color={colors[0].base} stop-opacity="0" />
          <stop offset="0.5" stop-color={colors[1].base} stop-opacity="0" />
          <stop offset="1" stop-color={colors[1].base} stop-opacity="0.38" />
        </linearGradient>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(236,230,218,0.06)" stroke-width="2" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={frac(rd.freezeEndTick) * width} height={H} fill="url(#hatch)" />
      <rect x={frac(rd.endTick) * width} y="0" width={width - frac(rd.endTick) * width} height={H} fill="rgba(0,0,0,0.25)" />
      <line x1="0" x2={width} y1={H / 2} y2={H / 2} stroke="rgba(236,230,218,0.12)" stroke-dasharray="2 4" />
      {#if wp}
        <path d={wp.area} fill="url(#wp)" />
        <path d={wp.line} fill="none" stroke="rgba(236,230,218,0.7)" stroke-width="1.3" />
      {/if}
      {#each bombs as b, i (i)}
        <rect x={b.x - 4} y={H - 12} width="8" height="8" transform="rotate(45 {b.x} {H - 8})" fill={b.kind === 'defused' ? 'var(--verdigris)' : 'var(--marker)'}><title>{b.title}</title></rect>
      {/each}
      {#each kills as k, i (i)}
        <circle cx={k.x} cy={k.y} r="3.4" fill={teamColor(k.side).base} stroke="var(--ink)" stroke-width="1.2"><title>{k.title}</title></circle>
      {/each}
    </svg>
    {#each evidence as e (e.id)}
      <button class="tent mono" style="left: {e.x}px" title={e.title} onclick={() => v.openBlunder(e.id)}>{e.n}</button>
    {/each}
    <div class="head" style="left: {frac(v.tick) * width}px"></div>
    {#if wp}
      <span class="chance mono">
        <span class={rd.sideOf[0] === 3 ? 'ct' : 't'}>{r.teamName(0)}</span> {Math.round(wp.now * 100)}%
      </span>
    {/if}
  </div>
</div>

<style>
  .timeline {
    padding: 8px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .controls button {
    display: inline-flex;
    align-items: center;
    padding: 5px 7px;
    color: var(--graphite);
  }

  .play {
    padding: 6px 13px !important;
    background: var(--paper);
    border-color: var(--paper);
    color: var(--ink) !important;
  }

  .play:hover {
    background: #fff;
  }

  select {
    margin-left: 6px;
    font-size: 11.5px;
  }

  .time {
    margin: 0 12px;
    color: var(--paper);
    min-width: 78px;
    font-size: 12.5px;
  }

  .time.planted {
    color: var(--marker);
  }

  .rounds {
    flex: 1;
    display: flex;
    gap: 1px;
    overflow-x: auto;
    padding: 2px 0;
  }

  .round {
    position: relative;
    min-width: 24px;
    height: 24px;
    padding: 0 4px;
    font-size: 10.5px;
    border: 1px solid transparent;
    border-bottom: 2px solid var(--rule-2);
    border-radius: 0;
    color: var(--pencil);
  }

  .round.ct {
    border-bottom-color: var(--ct);
    color: var(--graphite);
  }

  .round.t {
    border-bottom-color: var(--t);
    color: var(--graphite);
  }

  .round.current {
    color: var(--paper);
    border-color: var(--rule-2);
    background: var(--desk-3);
  }

  .round i {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 4px;
    height: 4px;
    background: var(--evidence);
    border-radius: 1px;
  }

  .half {
    width: 1px;
    margin: 2px 5px;
    background: var(--rule-2);
  }

  .track {
    position: relative;
    height: 54px;
    background: var(--ink);
    border: 1px solid var(--rule);
    border-radius: 2px;
    cursor: pointer;
    touch-action: none;
  }

  svg {
    display: block;
  }

  .head {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--marker);
    transform: translateX(-1px);
    pointer-events: none;
  }

  .tent {
    position: absolute;
    top: -7px;
    transform: translateX(-50%);
    width: 15px;
    height: 13px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--evidence);
    color: var(--ink);
    font-size: 8.5px;
    font-weight: 600;
    line-height: 13px;
    clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
  }

  .tent:hover {
    background: #ffd876;
  }

  .chance {
    position: absolute;
    right: 8px;
    top: 4px;
    font-size: 10.5px;
    color: var(--graphite);
    pointer-events: none;
    background: rgba(14, 16, 19, 0.75);
    padding: 0 4px;
  }
</style>
