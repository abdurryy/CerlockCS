import { mapLabel } from '../format'
import type { Overlay, OverlayOptions } from './overlay'
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
// "e-maniacs/mirage/ct/eco-rounds.mp4".
export function videoPath(teamName: string, map: string, s: Pick<Situation, 'side' | 'buy'>, ext: string): string {
  const m = slug(mapLabel(map)) || slug(map) || 'map'
  return `${teamFolder(teamName)}/${m}/${s.side}/${BUY_FILE[s.buy]}.${ext}`
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
  })
}
