import type { MapView } from './mapview'
import type { Replay } from './replay'
import { buildHeatmap, type HeatKind } from './render/heatmap'
import type { ViewOptions } from './render/renderer'
import type { Moment } from './types'

export type Tab = 'review' | 'players' | 'aim' | 'rounds'

export interface HeatSelection {
  label: string
  players: number[]
  kind: HeatKind
  side: number
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

// Viewer holds the playback and display state for one open replay.
//
// The canvas reads `live` every animation frame. `tick` is the same value
// but only updated a few times per second, which is what the panels bind
// to, so the DOM is not rebuilt at 60 fps.
export class Viewer {
  readonly replay: Replay
  readonly map: MapView

  tick = $state(0)
  playing = $state(false)
  speed = $state(1)
  follow = $state(-1)
  rotate = $state(false)
  teamVision = $state(false)
  names = $state(true)
  cones = $state<'all' | 'follow' | 'none'>('all')
  shots = $state(true)
  paths = $state(true)
  layer = $state(-1)
  ghosts = $state(-1)
  heat = $state<HeatSelection | null>(null)
  focus = $state<number[]>([])
  engagement = $state(-1)
  // inspect is the player open in the Players and Aim tabs.
  inspect = $state(-1)
  tab = $state<Tab>('review')
  skipFreeze = $state(true)

  live = 0
  private lastUi = 0
  private heatCache: { key: string; canvas: HTMLCanvasElement } | null = null

  constructor(replay: Replay, map: MapView) {
    this.replay = replay
    this.map = map
    const first = replay.round(0)
    this.live = Math.max(first.startTick, first.freezeEndTick - 3 * replay.rate)
    this.tick = this.live
  }

  get round(): number {
    return this.replay.roundIndex(this.tick)
  }

  seek(tick: number) {
    const t = Math.max(this.replay.firstTick, Math.min(this.replay.lastTick, tick))
    this.live = t
    this.tick = t
  }

  // seekRound jumps to just before freeze time ends, so the setup is
  // visible without sitting through the buy period.
  seekRound(i: number) {
    const n = this.replay.match.rounds.length
    const r = this.replay.round(Math.max(0, Math.min(n - 1, i)))
    this.seek(Math.max(r.startTick, r.freezeEndTick - 3 * this.replay.rate))
  }

  step(seconds: number) {
    this.seek(this.live + seconds * this.replay.rate)
  }

  toggle() {
    if (!this.playing && this.live >= this.replay.lastTick) this.seekRound(0)
    this.playing = !this.playing
  }

  setFollow(p: number) {
    this.follow = this.follow === p ? -1 : p
    if (this.follow < 0) this.rotate = false
  }

  // jump opens a moment from the analysis: seek a little before it, follow
  // the player involved and start playing.
  jump(m: Moment, focus: number[] = []) {
    const r = this.replay.round(m.round)
    this.seek(Math.max(r.startTick, m.tick))
    if (m.player >= 0) this.follow = m.player
    this.focus = focus
    this.playing = true
  }

  advance(dt: number, now: number) {
    const r = this.replay
    if (this.playing) {
      let t = this.live + dt * r.rate * this.speed
      if (this.skipFreeze) {
        // Skip the dead time between rounds and most of freeze time.
        const i = r.roundIndex(t)
        const rd = r.round(i)
        const settle = rd.freezeEndTick - 2 * r.rate
        if (t >= rd.startTick && t < settle) t = settle
        if (t > rd.officialEndTick + 2 * r.rate && i + 1 < r.match.rounds.length) {
          const next = r.round(i + 1)
          t = Math.max(t, next.freezeEndTick - 2 * r.rate)
        }
      }
      if (t >= r.lastTick) {
        t = r.lastTick
        this.playing = false
      }
      this.live = t
    }
    if (now - this.lastUi > 70 || !this.playing) {
      this.lastUi = now
      if (this.tick !== this.live) this.tick = this.live
    }
  }

  heatCanvas(level: number): HTMLCanvasElement | null {
    const h = this.heat
    if (!h) return null
    const key = `${h.kind}|${h.side}|${h.players.join(',')}|${level}`
    if (this.heatCache?.key !== key) {
      this.heatCache = { key, canvas: buildHeatmap(this.replay, this.map, { ...h, level }) }
    }
    return this.heatCache.canvas
  }

  options(level: number): ViewOptions {
    return {
      follow: this.follow,
      rotate: this.rotate && this.follow >= 0,
      teamVision: this.teamVision,
      names: this.names,
      cones: this.cones,
      shots: this.shots,
      paths: this.paths,
      layer: this.layer,
      ghosts: this.ghosts,
      heat: this.heatCanvas(level),
      focus: this.focus,
    }
  }
}
