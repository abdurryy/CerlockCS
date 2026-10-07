<script lang="ts">
  import { teamColor } from '../lib/colors'
  import { roundClock } from '../lib/live'
  import { SPEEDS, type Viewer } from '../lib/viewer.svelte'
  import { REASON, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'
  import Icon from './Icon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)

  let track: HTMLDivElement
  let width = $state(800)
  const H = 56
  let scrubbing = $state(false)
  let hover = $state<number | null>(null)

  const round = $derived(v.round)
  const rd = $derived(rounds[round])
  const info = $derived(r.report.rounds[round])
  const span = $derived({ from: rd.startTick, to: Math.max(rd.officialEndTick, rd.endTick + r.rate) })
  const frac = (tick: number) => Math.max(0, Math.min(1, (tick - span.from) / (span.to - span.from)))
  const clock = $derived(roundClock(r, v.tick))
  const colors = $derived([teamColor(rd.sideOf[0]), teamColor(rd.sideOf[1])])
  const mid = H / 2

  // Win chance for team A over the round as a step line: it only changes
  // when someone dies or the bomb goes down.
  const wp = $derived.by(() => {
    const pts = info?.winProb ?? []
    if (!pts.length) return null
    const y = (p: number) => 6 + (1 - p) * (H - 12)
    let d = `M 0 ${y(pts[0].p)}`
    let prev = pts[0].p
    for (const pt of pts) {
      const x = frac(pt.tick) * width
      d += ` L ${x} ${y(prev)} L ${x} ${y(pt.p)}`
      prev = pt.p
    }
    d += ` L ${width} ${y(prev)}`
    const area = `${d} L ${width} ${mid} L 0 ${mid} Z`
    let now = pts[0].p
    for (const pt of pts) if (pt.tick <= v.tick) now = pt.p
    return { line: d, area, now, y }
  })

  const kills = $derived.by(() => {
    const pts = info?.winProb ?? []
    return r.roundKills[round].map((k) => {
      let p = 0.5
      for (const pt of pts) if (pt.tick <= k.tick) p = pt.p
      const how = [weaponName(k.weapon), k.headshot ? 'headshot' : '', k.wallbang ? 'wallbang' : ''].filter(Boolean).join(', ')
      return {
        x: frac(k.tick) * width,
        y: wp ? wp.y(p) : mid,
        color: teamColor(k.killerSide).base,
        title: k.killer >= 0 && k.killer !== k.victim ? `${r.playerName(k.killer)} killed ${r.playerName(k.victim)} (${how})` : `${r.playerName(k.victim)} died (${how})`,
      }
    })
  })

  const BOMB_ICON: Record<string, string> = { planted: 'weapon/c4', defused: 'hud/defuse', exploded: 'kill/explosion' }

  const bombs = $derived(
    r.roundBomb[round]
      .filter((b) => b.kind === 'planted' || b.kind === 'defused' || b.kind === 'exploded')
      .map((b) => ({
        x: frac(b.tick) * width,
        kind: b.kind,
        icon: BOMB_ICON[b.kind],
        title: b.kind === 'planted' ? `${r.playerName(b.player)} planted on ${b.site}` : b.kind === 'defused' ? `${r.playerName(b.player)} defused` : 'Bomb exploded',
      })),
  )

  // Evidence pins stay inside the track even at its very ends.
  const evidence = $derived(
    r.roundBlunders[round].map((b, i) => ({
      x: frac(b.tick) * width,
      pin: Math.max(8, Math.min(width - 8, frac(b.tick) * width)),
      n: i + 1,
      title: `${b.title}: ${b.detail}`,
      id: r.blunders.indexOf(b),
    })),
  )

  // Faint marks every 10 seconds of round time.
  const marks = $derived.by(() => {
    const out: number[] = []
    const step = 10 * r.rate
    for (let t = rd.freezeEndTick + step; t < rd.endTick; t += step) out.push(frac(t) * width)
    return out
  })

  const hoverText = $derived.by(() => {
    if (hover === null) return ''
    const tick = span.from + (hover / width) * (span.to - span.from)
    const c = roundClock(r, tick)
    return c.phase === 'freeze' ? `Freeze ${c.text}` : c.phase === 'over' ? 'After round' : c.text
  })

  function tickAt(e: PointerEvent): number {
    const rect = track.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return span.from + f * (span.to - span.from)
  }

  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.pin')) return
    scrubbing = true
    track.setPointerCapture(e.pointerId)
    v.seek(tickAt(e))
  }

  function move(e: PointerEvent) {
    const rect = track.getBoundingClientRect()
    hover = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    if (scrubbing) v.seek(tickAt(e))
  }

  const REASON_ICON: Record<string, string> = {
    bomb_exploded: 'kill/explosion',
    bomb_defused: 'hud/defuse',
    t_eliminated: 'hud/elimination',
    ct_eliminated: 'hud/elimination',
    time_ran_out: 'hud/time',
  }

  function roundTitle(i: number): string {
    const x = rounds[i]
    const won = x.winnerTeam >= 0 ? r.teamName(x.winnerTeam) : 'Nobody'
    const n = r.roundBlunders[i].length
    return `Round ${i + 1}: ${won} won, ${(REASON[x.reason] ?? x.reason).toLowerCase()}. ${x.scoreA} : ${x.scoreB}${n ? `. ${n} evidence` : ''}`
  }

  function halftime(i: number): boolean {
    return i > 0 && rounds[i].sideOf[0] !== rounds[i - 1].sideOf[0]
  }

  const side = (s: number) => (s === 3 ? 'ct' : s === 2 ? 't' : '')
</script>

<div class="timeline">
  <div class="controls">
    <div class="transport">
      <button class="plain" onclick={() => v.seekRound(round - 1)} title="Previous round (P)"><Icon name="prev" size={14} /></button>
      <button class="plain" onclick={() => v.step(-5)} title="Back 5 seconds (Left)"><Icon name="rewind" size={14} /></button>
      <button class="play" onclick={() => v.toggle()} title={v.playing ? 'Pause (Space)' : 'Play (Space)'}><Icon name={v.playing ? 'pause' : 'play'} size={15} /></button>
      <button class="plain" onclick={() => v.step(5)} title="Forward 5 seconds (Right)"><Icon name="forward" size={14} /></button>
      <button class="plain" onclick={() => v.seekRound(round + 1)} title="Next round (N)"><Icon name="next" size={14} /></button>
    </div>
    <select class="num speed" bind:value={v.speed} title="Playback speed ([ and ])">
      {#each SPEEDS as s (s)}<option value={s}>{s}x</option>{/each}
    </select>
    <button class="skip" class:on={v.skipFreeze} aria-pressed={v.skipFreeze} onclick={() => (v.skipFreeze = !v.skipFreeze)} title="Skip freeze time and the gap between rounds">
      <Icon name="skip" size={13} />
      <span>Skip freeze</span>
    </button>
    <span class="now">
      <span class="label">Round {round + 1}</span>
      <span class="time num" class:planted={clock.phase === 'planted'}>{clock.text}</span>
    </span>
    <div class="rounds">
      {#each rounds as x, i (i)}
        {#if halftime(i)}<span class="half" title="Sides switch"></span>{/if}
        <button class="round {side(x.winner)}" class:current={i === round} title={roundTitle(i)} onclick={() => v.seekRound(i)}>
          <span class="why">
            {#if REASON_ICON[x.reason] && x.winner}
              <GameIcon name={REASON_ICON[x.reason]} h={12} />
            {:else}
              <i class="dot"></i>
            {/if}
          </span>
          <span class="n num">{i + 1}</span>
          {#if r.roundBlunders[i].length}<i class="ev"></i>{/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="scrub">
    <div class="legend" title="Chance to win the round">
      <span class="team {side(rd.sideOf[0])}"><span class="who">{r.teamName(0)}</span>{#if wp}<b class="num">{Math.round(wp.now * 100)}%</b>{/if}</span>
      <span class="label">Win chance</span>
      <span class="team {side(rd.sideOf[1])}"><span class="who">{r.teamName(1)}</span>{#if wp}<b class="num">{100 - Math.round(wp.now * 100)}%</b>{/if}</span>
    </div>
    <div
      class="track"
      bind:this={track}
      bind:clientWidth={width}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={() => (scrubbing = false)}
      onpointerleave={() => (hover = null)}
      role="slider"
      aria-label="Round time"
      aria-valuemin={span.from}
      aria-valuemax={span.to}
      aria-valuenow={v.tick}
      tabindex="-1"
    >
      <svg {width} height={H} aria-hidden="true">
        <defs>
          <clipPath id="wp-top"><rect x="0" y="0" width={width} height={mid - 1} /></clipPath>
          <clipPath id="wp-bottom"><rect x="0" y={mid + 1} width={width} height={mid - 1} /></clipPath>
        </defs>
        <rect x="0" y="0" width={frac(rd.freezeEndTick) * width} height={H} fill="rgba(255,255,255,0.03)" />
        <rect x={frac(rd.endTick) * width} y="0" width={Math.max(0, width - frac(rd.endTick) * width)} height={H} fill="rgba(0,0,0,0.35)" />
        {#each marks as x, i (i)}
          <line x1={x} x2={x} y1="0" y2={H} stroke="rgba(255,255,255,0.035)" />
        {/each}
        <line x1="0" x2={width} y1={mid} y2={mid} stroke="rgba(255,255,255,0.1)" stroke-dasharray="3 4" />
        {#if wp}
          <path d={wp.area} fill={colors[0].base} fill-opacity="0.14" clip-path="url(#wp-top)" />
          <path d={wp.area} fill={colors[1].base} fill-opacity="0.14" clip-path="url(#wp-bottom)" />
          <path d={wp.line} fill="none" stroke="rgba(236,239,243,0.45)" stroke-width="1.5" stroke-linejoin="round" />
          <path d={wp.line} fill="none" stroke={colors[0].base} stroke-width="1.5" stroke-linejoin="round" clip-path="url(#wp-top)" />
          <path d={wp.line} fill="none" stroke={colors[1].base} stroke-width="1.5" stroke-linejoin="round" clip-path="url(#wp-bottom)" />
        {/if}
        {#each bombs as b, i (i)}
          <line x1={b.x} x2={b.x} y1="0" y2={H} stroke={b.kind === 'defused' ? 'var(--ct)' : 'var(--accent)'} stroke-opacity="0.45" />
        {/each}
        {#each evidence as e (e.id)}
          <line x1={e.x} x2={e.x} y1="0" y2={H} stroke="var(--evidence)" stroke-opacity="0.35" stroke-dasharray="2 3" />
        {/each}
        {#each kills as k, i (i)}
          <circle cx={k.x} cy={k.y} r="3.5" fill={k.color} stroke="var(--bg)" stroke-width="1.5"><title>{k.title}</title></circle>
        {/each}
      </svg>
      {#if frac(rd.freezeEndTick) * width > 54}
        <span class="zone label">Freeze</span>
      {/if}
      {#each bombs as b, i (i)}
        <span class="bomb {b.kind}" style:left="{Math.max(12, Math.min(width - 12, b.x))}px" title={b.title}><GameIcon name={b.icon} h={12} fallback={b.kind} /></span>
      {/each}
      {#if hover !== null && !scrubbing}
        <div class="hover" style:left="{hover}px"><span class="num">{hoverText}</span></div>
      {/if}
      {#each evidence as e (e.id)}
        <button class="pin num" style:left="{e.pin}px" title={e.title} onclick={() => v.openBlunder(e.id)}>{e.n}</button>
      {/each}
      <div class="head" style:left="{frac(v.tick) * width}px"></div>
    </div>
  </div>
</div>

<style>
  .timeline {
    padding: 10px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    container-type: inline-size;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .transport button {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    color: var(--text-2);
  }

  .transport button:hover {
    color: var(--text);
  }

  .transport .play {
    width: 38px;
    height: 32px;
    margin: 0 3px;
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }

  .transport .play:hover {
    background: #fff;
    border-color: #fff;
    color: var(--bg);
  }

  .speed {
    height: 30px;
    width: 62px;
    padding: 0 6px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 13px;
    flex: none;
  }

  .skip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 12.5px;
    color: var(--text-3);
    background: transparent;
    border-color: var(--line);
    white-space: nowrap;
    flex: none;
  }

  .skip:hover {
    color: var(--text);
  }

  .skip.on {
    color: var(--text);
    background: var(--surface-3);
    border-color: var(--line-2);
  }

  .skip.on :global(.icon) {
    color: var(--text-2);
  }

  .now {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 62px;
    padding: 0 12px 0 10px;
    border-left: 1px solid var(--line);
    border-right: 1px solid var(--line);
    flex: none;
  }

  .now .label {
    font-size: 10px;
    line-height: 1.2;
  }

  .time {
    font-family: var(--display);
    font-weight: 700;
    font-size: 17px;
    line-height: 1.1;
    color: var(--text);
  }

  .time.planted {
    color: var(--accent);
  }

  .rounds {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 3px;
    overflow-x: auto;
    padding: 1px 1px 6px;
    margin: -1px 0 -6px;
    scrollbar-width: thin;
  }

  .round {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 27px;
    height: 34px;
    padding: 0 0 2px;
    background: var(--surface-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .round::after {
    content: '';
    position: absolute;
    left: -1px;
    right: -1px;
    bottom: -1px;
    height: 2px;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    background: var(--line-2);
  }

  .round.ct::after {
    background: var(--ct);
  }

  .round.t::after {
    background: var(--t);
  }

  .round:hover {
    background: var(--surface-3);
    border-color: transparent;
    color: var(--text);
  }

  .round.current {
    background: var(--surface-3);
    border-color: var(--accent);
    color: var(--text);
  }

  .n {
    font-family: var(--display);
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
  }

  .why {
    display: flex;
    height: 12px;
    align-items: center;
    color: var(--text-3);
  }

  .round.ct .why {
    color: var(--ct);
  }

  .round.t .why {
    color: var(--t);
  }

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
  }

  /* A round with evidence gets a small amber dot under it, the count is
     in the tooltip. */
  .ev {
    position: absolute;
    left: 50%;
    bottom: -6px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--evidence);
  }

  .half {
    flex: none;
    width: 1px;
    margin: 4px 5px;
    background: var(--line-2);
  }

  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 58px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
    touch-action: none;
  }

  svg {
    display: block;
    border-radius: var(--radius-sm);
  }

  .zone {
    position: absolute;
    left: 8px;
    bottom: 5px;
    font-size: 9.5px;
    pointer-events: none;
  }

  .bomb {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    height: 18px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg);
    color: var(--accent);
    box-shadow: 0 0 0 1px currentColor inset;
  }

  .bomb.defused {
    color: var(--ct);
  }

  .bomb :global(.icon) {
    display: block;
  }

  .hover {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.25);
    pointer-events: none;
  }

  .hover span {
    position: absolute;
    bottom: 3px;
    left: 5px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--surface-3);
    border: 1px solid var(--line-2);
    font-family: var(--display);
    font-weight: 600;
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
  }

  .head {
    position: absolute;
    top: -3px;
    bottom: -4px;
    width: 2px;
    background: var(--accent);
    transform: translateX(-1px);
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(11, 13, 17, 0.6);
  }

  .head::before {
    content: '';
    position: absolute;
    top: -3px;
    left: -4px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg);
  }

  .pin {
    position: absolute;
    top: -6px;
    transform: translateX(-50%);
    z-index: 1;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: var(--evidence);
    color: var(--bg);
    font-family: var(--display);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    box-shadow: 0 0 0 2px var(--bg);
  }

  .pin:hover {
    background: #ffd677;
    transform: translateX(-50%) scale(1.12);
  }

  .scrub {
    display: flex;
    gap: 8px;
  }

  .legend {
    flex: none;
    width: 150px;
    height: 58px;
    padding: 5px 10px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .legend .team {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
  }

  .legend .label {
    font-size: 9px;
    line-height: 1;
  }

  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }

  .legend b {
    font-weight: 700;
    font-size: 13px;
  }

  @container (max-width: 1000px) {
    .skip span {
      display: none;
    }

    .skip {
      width: 30px;
      padding: 0;
      justify-content: center;
    }
  }

  @container (max-width: 640px) {
    .controls {
      flex-wrap: wrap;
      row-gap: 12px;
    }

    .rounds {
      flex-basis: 100%;
    }

    .now {
      border-right: none;
    }

    .legend {
      width: 112px;
      padding: 5px 8px;
    }
  }
</style>
