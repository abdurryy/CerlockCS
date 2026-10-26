import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer'
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer'

// Video export for the situation player. Frames are drawn one by one at
// fixed times and encoded with WebCodecs, so the file has every frame
// whatever the machine. Browsers without WebCodecs record the canvas in
// real time with MediaRecorder instead.

export interface VideoJob {
  width: number
  height: number
  fps: number
  // Seconds of video.
  duration: number
  // Paints the frame at t seconds onto the canvas.
  draw: (canvas: HTMLCanvasElement, t: number) => void
  // Share done, 0 to 1.
  onprogress?: (done: number) => void
  signal?: AbortSignal
}

export interface Video {
  blob: Blob
  ext: 'mp4' | 'webm'
}

interface Format {
  codec: string
  container: 'mp4' | 'webm'
}

// H.264 first, it plays everywhere, including Discord and phones.
const FORMATS: Format[] = [
  { codec: 'avc1.640028', container: 'mp4' },
  { codec: 'avc1.4d0028', container: 'mp4' },
  { codec: 'avc1.420028', container: 'mp4' },
  { codec: 'vp09.00.40.08', container: 'webm' },
  { codec: 'vp8', container: 'webm' },
]

// A keyframe every 2 seconds keeps scrubbing in players fast.
const KEY_EVERY = 2
const QUEUE = 6

// pause gives the page a moment between frames. Timers are slowed to
// once a second in a hidden or minimised window, message events are not,
// so long batches keep going in the background.
function pause(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(null)
  })
}

// drained waits until the encoder took a frame off its queue.
function drained(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      encoder.removeEventListener('dequeue', done)
      clearTimeout(timer)
      resolve()
    }
    encoder.addEventListener('dequeue', done)
    // Older browsers have no dequeue event.
    const timer = setTimeout(done, 20)
  })
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

export function bitrate(w: number, h: number, fps: number): number {
  // The map is mostly still, so this keeps text sharp and a 30 second
  // 1080p clip under 10 MB for Discord.
  return Math.round(Math.min(8e6, Math.max(1.5e6, w * h * fps * 0.04)))
}

async function pick(w: number, h: number, fps: number): Promise<{ format: Format; config: VideoEncoderConfig } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  for (const format of FORMATS) {
    const config: VideoEncoderConfig = { codec: format.codec, width: w, height: h, bitrate: bitrate(w, h, fps), framerate: fps }
    if (format.container === 'mp4') config.avc = { format: 'avc' }
    try {
      const res = await VideoEncoder.isConfigSupported(config)
      if (res.supported) return { format, config }
    } catch {
      // Not this one.
    }
  }
  return null
}

// encodeVideo draws and encodes every frame and gives back the file.
export async function encodeVideo(job: VideoJob): Promise<Video> {
  // H.264 wants even sizes.
  const w = job.width & ~1
  const h = job.height & ~1
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const chosen = await pick(w, h, job.fps)
  if (!chosen) return record(canvas, job)

  const { format, config } = chosen
  const frames = Math.max(1, Math.round(job.duration * job.fps) + 1)
  const mp4 = format.container === 'mp4' ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width: w, height: h, frameRate: job.fps }, fastStart: 'in-memory' }) : null
  const webm =
    format.container === 'webm'
      ? new WebmMuxer({ target: new WebmTarget(), video: { codec: format.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: w, height: h, frameRate: job.fps } })
      : null
  let failed: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (mp4) mp4.addVideoChunk(chunk, meta)
      else webm!.addVideoChunk(chunk, meta)
    },
    error: (e) => {
      failed = e instanceof Error ? e : new Error(String(e))
    },
  })
  encoder.configure(config)
  const us = 1e6 / job.fps
  try {
    for (let i = 0; i < frames; i++) {
      if (job.signal?.aborted) throw new Cancelled()
      if (failed) throw failed
      job.draw(canvas, Math.min(job.duration, i / job.fps))
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) })
      encoder.encode(frame, { keyFrame: i % (KEY_EVERY * job.fps) === 0 })
      frame.close()
      // Let the encoder catch up, and the page breathe.
      while (encoder.encodeQueueSize > QUEUE) await drained(encoder)
      if (i % 8 === 0) {
        job.onprogress?.(i / frames)
        await pause()
      }
    }
    await encoder.flush()
    if (failed) throw failed
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    canvas.width = canvas.height = 0
  }
  job.onprogress?.(1)
  if (mp4) {
    mp4.finalize()
    return { blob: new Blob([mp4.target.buffer], { type: 'video/mp4' }), ext: 'mp4' }
  }
  webm!.finalize()
  return { blob: new Blob([webm!.target.buffer!], { type: 'video/webm' }), ext: 'webm' }
}

// record is the fallback: play the frames in real time and record the
// canvas.
async function record(canvas: HTMLCanvasElement, job: VideoJob): Promise<Video> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('This browser cannot make videos')
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const type = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  job.draw(canvas, 0)
  const stream = canvas.captureStream(job.fps)
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: bitrate(canvas.width, canvas.height, job.fps) })
  const parts: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data)
  }
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.start(500)
  const start = performance.now()
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (job.signal?.aborted) return reject(new Cancelled())
        const t = (performance.now() - start) / 1000
        job.draw(canvas, Math.min(job.duration, t))
        job.onprogress?.(Math.min(1, t / job.duration))
        if (t >= job.duration) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  } finally {
    rec.stop()
    for (const tr of stream.getTracks()) tr.stop()
    await stopped
    canvas.width = canvas.height = 0
  }
  const mime = rec.mimeType || type || 'video/webm'
  return { blob: new Blob(parts, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' }
}
