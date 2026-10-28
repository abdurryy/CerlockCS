import { mapLabel } from '../format'
import { MAX_ROUND_MAPS, type Overlay, type OverlayLayout, type OverlayOptions } from './overlay'
import { slug } from './slug'
import type { BuyKind, Situation } from './types'
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

export type LayoutChoice = 'auto' | OverlayLayout

export const VIDEO_LAYOUTS: { id: LayoutChoice; label: string; title: string }[] = [
  { id: 'auto', label: 'Auto', title: `A map per round up to ${MAX_ROUND_MAPS} rounds, a map per player with more` },
  { id: 'rounds', label: 'Map per round', title: 'Every round on a map of its own, all playing at once' },
  { id: 'players', label: 'Map per player', title: 'Each player on a map of their own, plus one with everyone' },
  { id: 'together', label: 'One map', title: 'Everyone on one map, the dots carry the round number' },
]

// layoutOf picks the layout for a video of this many rounds: a round on
// its own needs one map, up to MAX_ROUND_MAPS rounds read best side by
// side, more than that by player.
export function layoutOf(choice: LayoutChoice, rounds: number): OverlayLayout {
  if (choice !== 'auto') return choice
  if (rounds <= 1) return 'together'
  return rounds <= MAX_ROUND_MAPS ? 'rounds' : 'players'
}

// pages splits rounds into groups that fit a map per round.
export function pages(rounds: number[], layout: OverlayLayout): number[][] {
  if (layout !== 'rounds' || rounds.length <= MAX_ROUND_MAPS) return [rounds]
  const out: number[][] = []
  for (let i = 0; i < rounds.length; i += MAX_ROUND_MAPS) out.push(rounds.slice(i, i + MAX_ROUND_MAPS))
  return out
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
