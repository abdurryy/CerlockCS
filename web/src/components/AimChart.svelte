<script lang="ts">
  import type { Replay } from '../lib/replay'
  import type { Engagement } from '../lib/types'

  let { r, e, tick }: { r: Replay; e: Engagement; tick: number } = $props()

  let canvas: HTMLCanvasElement
  let width = $state(340)
  const height = 150

  // Chart of how far the crosshair was from the enemy's head, with the
  // moments the enemy was spotted, shots, hits and the kill marked.
  $effect(() => {
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
    const t1 = at[from + n - 1]
    const pad = { l: 30, r: 8, t: 8, b: 20 }
    const w = width - pad.l - pad.r
    const h = height - pad.t - pad.b
    let max = 10
    for (let i = 0; i < n; i++) max = Math.max(max, Math.min(45, error[from + i]))
    max = Math.ceil(max / 5) * 5
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * w
    const y = (v: number) => pad.t + h - (Math.min(v, max) / max) * h

    // Spotted spans.
    ctx.fillStyle = 'rgba(91,174,140,0.12)'
    for (let i = 0; i < n; i++) {
      if (!visible[from + i]) continue
      const a = x(at[from + i])
      const b = i + 1 < n ? x(at[from + i + 1]) : a + 2
      ctx.fillRect(a, pad.t, Math.max(1, b - a), h)
    }

    // Grid.
    ctx.strokeStyle = '#262a31'
    ctx.fillStyle = '#6a665e'
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace'
    ctx.lineWidth = 1
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let v = 0; v <= max; v += max / 3) {
      ctx.beginPath()
      ctx.moveTo(pad.l, y(v))
      ctx.lineTo(width - pad.r, y(v))
      ctx.stroke()
      ctx.fillText(`${Math.round(v)}°`, pad.l - 4, y(v))
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const zero = e.firstSeenTick >= 0 ? e.firstSeenTick : t0
    for (let s = Math.ceil((t0 - zero) / r.rate * 2) / 2; s <= (t1 - zero) / r.rate; s += 0.5) {
      const tx = x(zero + s * r.rate)
      ctx.fillText(`${s >= 0 ? '+' : ''}${s.toFixed(1)}s`, tx, height - pad.b + 5)
    }

    const vline = (t: number, color: string, dash: number[] = []) => {
      if (t < t0 || t > t1) return
      ctx.strokeStyle = color
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(x(t), pad.t)
      ctx.lineTo(x(t), pad.t + h)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (e.firstSeenTick >= 0) vline(e.firstSeenTick, '#5bae8c', [3, 3])
    if (e.killTick >= 0) vline(e.killTick, '#e5484d')

    // Error line.
    ctx.strokeStyle = '#ece6da'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = x(at[from + i])
      const py = y(error[from + i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()

    // Shots and hits.
    const s = r.shots
    for (let i = r.firstShotAfter(t0); i < s.tick.length && s.tick[i] <= t1; i++) {
      if (s.player[i] !== e.attacker || s.weapon[i] >= 400) continue
      ctx.fillStyle = '#9c978c'
      ctx.fillRect(x(s.tick[i]) - 1, pad.t + h - 7, 2, 7)
    }
    for (const d of r.roundDamages[e.round]) {
      if (d.attacker !== e.attacker || d.victim !== e.victim || d.tick < t0 || d.tick > t1) continue
      ctx.fillStyle = d.hitGroup === 1 ? '#e5484d' : '#f2c14e'
      ctx.beginPath()
      ctx.arc(x(d.tick), pad.t + h - 12, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Playback position.
    if (tick >= t0 && tick <= t1) vline(tick, 'rgba(229,72,77,0.8)')
  })
</script>

<div bind:clientWidth={width}>
  <canvas bind:this={canvas} style="width: {width}px; height: {height}px"></canvas>
</div>
<div class="legend">
  <span><i class="seen"></i>spotted</span>
  <span><i class="line"></i>crosshair to head</span>
  <span><i class="shot"></i>shot</span>
  <span><i class="hit"></i>hit</span>
  <span><i class="hs"></i>headshot</span>
</div>

<style>
  canvas {
    display: block;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: var(--pencil);
    margin-top: 4px;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  i {
    display: inline-block;
    width: 10px;
    height: 8px;
    border-radius: 2px;
  }

  .seen {
    background: rgba(91, 174, 140, 0.35);
  }

  .line {
    background: #ece6da;
    height: 2px;
  }

  .shot {
    background: #9c978c;
    width: 2px;
  }

  .hit {
    background: #f2c14e;
    border-radius: 50%;
    width: 7px;
    height: 7px;
  }

  .hs {
    background: #e5484d;
    border-radius: 50%;
    width: 7px;
    height: 7px;
  }
</style>
