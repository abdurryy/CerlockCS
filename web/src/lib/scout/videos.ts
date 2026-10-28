import { mapLabel } from '../format'
import { MAX_ROUND_MAPS, type Overlay, type OverlayLayout, type OverlayOptions, type Story } from './overlay'
import { slug } from './slug'
import type { BuyKind, Situation, SituationTrack } from './types'
import { encodeVideo, type Video } from './video'

// Situation videos: the sizes and lengths to pick from, and where each one
// goes in the export folder.

export interface VideoSize {
  id: string
  label: string
  w: number
  h: number
}

export const VIDEO_SIZES: VideoSize[] = [
  { id: '1080', label: '1080p', w: 1920, h: 1080 },
  { id: '720', label: '720p', w: 1280, h: 720 },
  { id: 'square', label: 'Square', w: 1080, h: 1080 },
]

// seconds 0 is the whole round.
export const VIDEO_LENGTHS = [
  { id: 'round', label: 'Whole round', seconds: 0 },
  { id: '60', label: 'First 60 s', seconds: 60 },
  { id: '30', label: 'First 30 s', seconds: 30 },
]

export const FPS = 30

// 'story' plays the rounds one after another, each on the whole map with
// what happens in it listed next to it. The others play all rounds at once.
export type VideoLayout = 'story' | OverlayLayout

export const VIDEO_LAYOUTS: { id: VideoLayout; label: string; title: string }[] = [
  { id: 'story', label: 'One by one', title: 'One round after another on the whole map, with what happens in it' },
  { id: 'rounds', label: 'Map per round', title: 'Every round on a map of its own, all playing at once' },
  { id: 'players', label: 'Map per player', title: 'Each player on a map of their own, plus one with everyone' },
  { id: 'together', label: 'One map', title: 'Everyone on one map, the dots carry the round number' },
]

// Speeds for round by round videos. Twice as fast keeps them short and
// still easy to follow.
export const VIDEO_SPEEDS = [1, 1.5, 2]
export const DEFAULT_SPEED = 2

// pages splits rounds into groups that fit a map per round.
export function pages(rounds: number[], layout: VideoLayout): number[][] {
  if (layout !== 'rounds' || rounds.length <= MAX_ROUND_MAPS) return [rounds]
  const out: number[][] = []
  for (let i = 0; i < rounds.length; i += MAX_ROUND_MAPS) out.push(rounds.slice(i, i + MAX_ROUND_MAPS))
  return out
}

// ---- Round by round ----

// Seconds of each round's title card, and of the end of the round held
// before the next one.
export const STORY_INTRO = 1.6
export const STORY_HOLD = 1
// A round by round video longer than this is split in parts.
export const STORY_MAX = 300
// Around a fight a round by round video drops to real time, from this
// long before it to this long after, so the fight can be followed.
export const SLOW_BEFORE = 1.5
export const SLOW_AFTER = 2.5
const TABLE_STEP = 0.1

export interface StoryRound {
  // Index into situation.tracks.
  round: number
  // Round seconds shown.
  length: number
  // Seconds of the kills and deaths in it.
  fights?: number[]
}

export interface StoryPart extends StoryRound {
  // Video seconds where the part starts.
  start: number
  // Video seconds after the title card, every TABLE_STEP of round time.
  table: Float64Array
}

export interface StoryPlan {
  parts: StoryPart[]
  speed: number
  total: number
  // Seconds of the summary card before the first round.
  cover: number
}

// Seconds of the summary card at the start of a video, longer when it has
// notes to read.
export const COVER_PLAIN = 2.5
export const COVER_NOTES = 5

// fightsOf lists when the roster killed or died in a round.
export function fightsOf(tr: SituationTrack): number[] {
  return tr.events.filter((e) => e.kind === 'kill' || e.kind === 'death').map((e) => e.t)
}

// timeTable maps round time to video time: speed most of the time, real
// time around fights.
function timeTable(r: StoryRound, speed: number): Float64Array {
  const n = Math.max(1, Math.ceil(r.length / TABLE_STEP - 1e-9)) + 1
  const out = new Float64Array(n)
  const fights = r.fights ?? []
  for (let i = 1; i < n; i++) {
    const from = (i - 1) * TABLE_STEP
    const dt = Math.min(TABLE_STEP, r.length - from)
    const mid = from + dt / 2
    const slow = speed > 1 && fights.some((f) => mid >= f - SLOW_BEFORE && mid <= f + SLOW_AFTER)
    out[i] = out[i - 1] + dt / (slow ? 1 : speed)
  }
  return out
}

function partSeconds(table: Float64Array): number {
  return STORY_INTRO + table[table.length - 1] + STORY_HOLD
}

// storyPlan lays rounds one after another, after cover seconds of
// summary.
export function storyPlan(rounds: StoryRound[], speed: number, cover = 0): StoryPlan {
  const sp = Math.max(0.25, speed)
  const parts: StoryPart[] = []
  let at = cover
  for (const r of rounds) {
    const table = timeTable(r, sp)
    parts.push({ ...r, start: at, table })
    at += partSeconds(table)
  }
  return { parts, speed: sp, total: at, cover }
}

// storyAt finds what a round by round video shows at video time at: the
// part, the time in its round and how much of the title card is up.
export function storyAt(plan: StoryPlan, at: number): { k: number; t: number; intro: number; cover?: number } {
  const ps = plan.parts
  if (!ps.length) return { k: -1, t: 0, intro: 0 }
  if (at < plan.cover) {
    const cover = Math.min(1, at / 0.2, (plan.cover - at) / 0.5)
    return { k: 0, t: 0, intro: 0, cover: Math.max(0, cover) }
  }
  let k = ps.length - 1
  for (let i = 1; i < ps.length; i++) {
    if (ps[i].start > at) {
      k = i - 1
      break
    }
  }
  const p = ps[k]
  const local = Math.max(0, at - p.start)
  if (local < STORY_INTRO) {
    // Fades in fast and out over the last half second.
    const intro = Math.min(1, local / 0.15, (STORY_INTRO - local) / 0.5)
    return { k, t: 0, intro: Math.max(0, intro) }
  }
  const v = local - STORY_INTRO
  const tb = p.table
  if (v >= tb[tb.length - 1]) return { k, t: p.length, intro: 0 }
  // The first table entry past v, then between it and the one before.
  let lo = 1
  let hi = tb.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tb[mid] > v) hi = mid
    else lo = mid + 1
  }
  const from = (lo - 1) * TABLE_STEP
  const span = tb[lo] - tb[lo - 1]
  const dt = Math.min(TABLE_STEP, p.length - from)
  const t = from + (span > 0 ? ((v - tb[lo - 1]) / span) * dt : 0)
  return { k, t: Math.min(p.length, t), intro: 0 }
}

// storyPages splits rounds into round by round videos of at most max
// seconds each, every video with at least one round.
export function storyPages(rounds: StoryRound[], speed: number, max = STORY_MAX): StoryRound[][] {
  const out: StoryRound[][] = []
  let cur: StoryRound[] = []
  let secs = 0
  for (const r of rounds) {
    const s = partSeconds(timeTable(r, Math.max(0.25, speed)))
    if (cur.length && secs + s > max) {
      out.push(cur)
      cur = []
      secs = 0
    }
    cur.push(r)
    secs += s
  }
  if (cur.length) out.push(cur)
  return out
}

// roundLengths is how long each of these rounds is on screen, cut at
// seconds when that is set.
export function roundLengths(o: Overlay, rounds: readonly number[], seconds: number): StoryRound[] {
  return rounds.map((i) => {
    const full = o.durationOf([i])
    const tr = o.situation.tracks[i]
    return { round: i, length: seconds > 0 ? Math.min(seconds, full) : full, fights: tr ? fightsOf(tr) : [] }
  })
}

// Every video stays under 20 MB, long ones get a lower bitrate.
export const MAX_VIDEO_BYTES = 20_000_000

const BUY_FILE: Record<BuyKind, string> = {
  pistol: 'pistol-rounds',
  eco: 'eco-rounds',
  force: 'force-buys',
  antieco: 'anti-eco-rounds',
  full: 'full-buys',
}

export function sizeOf(id: string): VideoSize {
  return VIDEO_SIZES.find((s) => s.id === id) ?? VIDEO_SIZES[0]
}

export function lengthSeconds(id: string): number {
  return VIDEO_LENGTHS.find((l) => l.id === id)?.seconds ?? 0
}

export function teamFolder(teamName: string): string {
  return slug(teamName) || 'team'
}

// videoPath is where a situation video goes, like
// "e-maniacs/mirage/ct/eco-rounds.mp4". A part of a situation split over
// several videos gets its round numbers, like "full-buys-rounds-10-18".
export function videoPath(teamName: string, map: string, s: Pick<Situation, 'side' | 'buy'>, ext: string, part?: { from: number; to: number }): string {
  const m = slug(mapLabel(map)) || slug(map) || 'map'
  const tail = part ? `-rounds-${part.from}-${part.to}` : ''
  return `${teamFolder(teamName)}/${m}/${s.side}/${BUY_FILE[s.buy]}${tail}.${ext}`
}

// videoLength is how long the video of these rounds is, in seconds.
export function videoLength(o: Overlay, rounds: readonly number[] | null | undefined, seconds: number): number {
  const full = o.durationOf(rounds)
  return seconds > 0 ? Math.min(seconds, full) : full
}

// renderStory draws and encodes rounds one after another.
export async function renderStory(
  o: Overlay,
  opts: OverlayOptions,
  rounds: readonly number[],
  size: VideoSize,
  seconds: number,
  speed: number,
  onprogress?: (done: number) => void,
  signal?: AbortSignal,
): Promise<Video> {
  await o.prepare(size.w, size.h)
  const cover = o.situation.notes.length ? COVER_NOTES : COVER_PLAIN
  const plan = storyPlan(roundLengths(o, rounds, seconds), speed, cover)
  // One set of options per round, the overlay keys its cache on them.
  const views: OverlayOptions[] = plan.parts.map((p, k) => {
    const story: Story = { n: k + 1, of: plan.parts.length }
    return { ...opts, layout: 'together', rounds: [p.round], story, length: seconds > 0 ? seconds : undefined }
  })
  return encodeVideo({
    width: size.w,
    height: size.h,
    fps: FPS,
    duration: plan.total,
    draw: (c, at) => {
      const { k, t, intro, cover } = storyAt(plan, at)
      if (k < 0) return
      if (cover) o.draw(c, t, { ...views[k], cover })
      else o.draw(c, t, intro > 0 ? { ...views[k], intro } : views[k])
    },
    onprogress,
    signal,
    maxBytes: MAX_VIDEO_BYTES,
  })
}

// renderVideo draws and encodes one situation the way it is set up in
// opts.
export async function renderVideo(
  o: Overlay,
  opts: OverlayOptions,
  size: VideoSize,
  seconds: number,
  onprogress?: (done: number) => void,
  signal?: AbortSignal,
): Promise<Video> {
  await o.prepare(size.w, size.h)
  const view: OverlayOptions = { ...opts, length: seconds > 0 ? seconds : undefined }
  return encodeVideo({
    width: size.w,
    height: size.h,
    fps: FPS,
    duration: videoLength(o, opts.rounds, seconds),
    draw: (c, at) => o.draw(c, at, view),
    onprogress,
    signal,
    maxBytes: MAX_VIDEO_BYTES,
  })
}
