import { describe, expect, it } from 'vitest'
import { bitrate, smallerBitrate, targetBitrate } from './video'

const MB20 = 20_000_000

describe('targetBitrate', () => {
  it('keeps the normal bitrate when the video fits', () => {
    expect(targetBitrate(1920, 1080, 30, 30, MB20)).toBe(bitrate(1920, 1080, 30))
    expect(targetBitrate(1920, 1080, 30, 600)).toBe(bitrate(1920, 1080, 30))
  })

  it('lowers it so long videos stay under the cap', () => {
    for (const secs of [90, 133, 160, 300]) {
      const rate = targetBitrate(1920, 1080, 30, secs, MB20)
      expect((rate / 8) * secs).toBeLessThanOrEqual(MB20 * 0.85 + 1)
    }
  })

  it('does not go so low the map turns to mush', () => {
    expect(targetBitrate(1920, 1080, 30, 10_000, MB20)).toBe(250e3)
  })
})

describe('smallerBitrate', () => {
  it('scales down by how much the file was over', () => {
    expect(smallerBitrate(1e6, 25_000_000, MB20)).toBe(Math.round(1e6 * (20 / 25) * 0.85))
    expect(smallerBitrate(300e3, 100_000_000, MB20)).toBe(250e3)
  })
})
