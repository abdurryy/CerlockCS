<script lang="ts">
  import { ACCENT, TEXT, TEXT_2 } from '../lib/colors'
  import { drawIcon, onIconLoad } from '../lib/icons.svelte'
  import type { Replay } from '../lib/replay'
  import type { Engagement } from '../lib/types'
  import GameIcon from './GameIcon.svelte'

  let { r, e, tick }: { r: Replay; e: Engagement; tick: number } = $props()

  let canvas: HTMLCanvasElement
  let width = $state(340)
  // Bumped when a canvas icon finishes loading, so the chart redraws.
  let loaded = $state(0)
  const height = 168

  const GRID = '#242a32'
  const LABEL = '#6e7883'
  const FONT = '500 10.5px "Barlow", sans-serif'
  const CAPTION = '600 10.5px "Barlow Semi Condensed", sans-serif'

  // Some demos have no damage events, so there are no hits to draw.
  const hasHits = $derived((r.match.damages?.length ?? 0) > 0)

  $effect(() => onIconLoad(() => loaded++))

  // Chart of how far the crosshair was from the enemy's head, with the
  // moments the enemy was spotted, shots, hits and the kill marked.
  $effect(() => {
    void loaded
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const { tick: at, error, visible } = r.aim
    const from = e.sampleStart
    const n = e.sampleLen
    if (n < 2) return
    const t0 = at[from]
    const last = at[from + n - 1]
    // The kill lands a few ticks after the last aim sample, keep it in view.
    const t1 = e.killTick > last && e.killTick - last <= r.rate ? e.killTick : last
    const pad = { l: 36, r: 12, t: 30, b: 22 }
    const w = width - pad.l - pad.r
    const h = height - pad.t - pad.b
    let max = 10
    let capped = false
    for (let i = 0; i < n; i++) {
      max = Math.max(max, Math.min(45, error[from + i]))
      if (error[from + i] > 45) capped = true
    }
    const step = max <= 15 ? 5 : max <= 30 ? 10 : 15
    max = Math.ceil(max / step) * step
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * w
    const y = (v: number) => pad.t + h - (Math.min(v, max) / max) * h

    // Spotted spans.
    ctx.fillStyle = 'rgba(166,175,186,0.09)'
    for (let i = 0; i < n; i++) {
      if (!visible[from + i]) continue
      const a = x(at[from + i])
      const b = i + 1 < n ? x(at[from + i + 1]) : a + 2
      ctx.fillRect(a, pad.t, Math.max(1, b - a), h)
    }

    // What the line means, above the plot.
    ctx.font = CAPTION
    ctx.letterSpacing = '0.06em'
    ctx.fillStyle = LABEL
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('CROSSHAIR TO HEAD', 10, 13)
    ctx.letterSpacing = '0px'

    // Grid.
    ctx.strokeStyle = GRID
    ctx.fillStyle = LABEL
    ctx.font = FONT
    ctx.lineWidth = 1
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let v = 0; v <= max; v += step) {
      const gy = Math.round(y(v)) + 0.5
      ctx.beginPath()
      ctx.moveTo(pad.l, gy)
      ctx.lineTo(width - pad.r, gy)
      ctx.stroke()
      ctx.fillText(`${Math.round(v)}°${capped && v + step > max ? '+' : ''}`, pad.l - 6, gy)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const zero = e.firstSeenTick >= 0 ? e.firstSeenTick : t0
    for (let s = Math.ceil(((t0 - zero) / r.rate) * 2) / 2; s <= (t1 - zero) / r.rate; s += 0.5) {
      const tx = x(zero + s * r.rate)
      if (tx < pad.l + 8 || tx > width - pad.r - 8) continue
      ctx.fillText(`${s > 0 ? '+' : ''}${s.toFixed(1)}s`, tx, height - pad.b + 6)
    }

    const vline = (t: number, color: string, dash: number[] = [], lw = 1) => {
      if (t < t0 || t > t1) return
      const lx = Math.round(x(t)) + 0.5
      ctx.strokeStyle = color
      ctx.lineWidth = lw
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(lx, pad.t)
      ctx.lineTo(lx, pad.t + h)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
    }
    if (e.firstSeenTick >= 0) vline(e.firstSeenTick, TEXT_2, [3, 3])
    if (e.killTick >= 0 && e.killTick >= t0 && e.killTick <= t1) {
      vline(e.killTick, 'rgba(236,239,243,0.55)')
      drawIcon(ctx, 'hud/elimination', x(e.killTick), 13, 13, TEXT)
    }

    // Error line, with a light fill under it.
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = x(at[from + i])
      const py = y(error[from + i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.lineTo(x(last), pad.t + h)
    ctx.lineTo(x(at[from]), pad.t + h)
    ctx.closePath()
    ctx.fillStyle = 'rgba(236,239,243,0.05)'
    ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = x(at[from + i])
      const py = y(error[from + i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = TEXT
    ctx.lineWidth = 1.75
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.lineWidth = 1

    // Shots and hits.
    const s = r.shots
    ctx.fillStyle = LABEL
    for (let i = r.firstShotAfter(t0); i < s.tick.length && s.tick[i] <= t1; i++) {
      if (s.player[i] !== e.attacker || s.weapon[i] >= 400) continue
      ctx.fillRect(Math.round(x(s.tick[i])) - 1, pad.t + h - 7, 2, 7)
    }
    for (const d of r.roundDamages[e.round]) {
      if (d.attacker !== e.attacker || d.victim !== e.victim || d.tick < t0 || d.tick > t1) continue
      const hx = x(d.tick)
      const hy = pad.t + h - 14
      if (d.hitGroup === 1 && drawIcon(ctx, 'kill/headshot', hx, hy - 1, 13, ACCENT)) continue
      ctx.beginPath()
      ctx.arc(hx, hy, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = d.hitGroup === 1 ? ACCENT : TEXT
      ctx.strokeStyle = '#12151a'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fill()
      ctx.lineWidth = 1
    }

    // Playback position.
    if (tick >= t0 && tick <= t1) vline(tick, ACCENT, [], 1.5)
  })
</script>

<div class="plot" bind:clientWidth={width}>
  <canvas bind:this={canvas} style="width: {width}px; height: {height}px"></canvas>
</div>
<div class="legend">
  <span><i class="seen"></i>Spotted</span>
  <span><i class="shot"></i>Shot</span>
  {#if hasHits}
    <span><i class="hit"></i>Hit</span>
    <span><GameIcon name="kill/headshot" h={12} color="var(--accent)" title="Headshot" fallback="HS" />Headshot</span>
  {/if}
  <span><GameIcon name="hud/elimination" h={12} title="Kill" fallback="Kill" />Kill</span>
  <span><i class="now"></i>Now</span>
  {#if !hasHits}<span class="nohits">No hit data in this demo</span>{/if}
</div>

<style>
  .plot {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
  }

  canvas {
    display: block;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 11.5px;
    color: var(--text-3);
    margin-top: 8px;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .legend .nohits {
    margin-left: auto;
    color: var(--text-3);
    opacity: 0.8;
  }

  i {
    display: inline-block;
    flex: none;
  }

  .seen {
    width: 12px;
    height: 10px;
    border-radius: 2px;
    background: rgba(166, 175, 186, 0.22);
  }

  .now {
    width: 2px;
    height: 10px;
    border-radius: 1px;
    background: var(--accent);
  }

  .shot {
    width: 2px;
    height: 8px;
    background: var(--text-3);
  }

  .hit {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text);
  }
</style>
