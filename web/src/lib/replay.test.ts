import { describe, expect, it } from 'vitest'
import { FLAG, Replay } from './replay'

type Col = { name: string; type: 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32'; data: number[] }

const ctor = { u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array }

// build writes a replay the same way internal/replay does.
function build(cols: Col[], frames: number, players: number): ArrayBuffer {
  const align = (n: number) => (n + 7) & ~7
  const match = {
    map: 'de_test', tickRate: 64, players: Array.from({ length: players }, (_, i) => ({ index: i, name: `p${i}`, team: i % 2 })),
    teams: [{ name: 'A', score: 0 }, { name: 'B', score: 0 }],
    rounds: [{ startTick: 0, freezeEndTick: 0, endTick: 100, officialEndTick: 100, sideOf: [3, 2], scoreA: 0, scoreB: 0 }],
    kills: [], grenades: [], weapons: {},
  }
  let rel = 0
  const offsets: number[] = []
  for (const c of cols) {
    offsets.push(rel)
    rel = align(rel + c.data.length * ctor[c.type].BYTES_PER_ELEMENT)
  }
  const header = (base: number) =>
    JSON.stringify({
      version: 2, frames, match, extra: { analysis: { players: [], teams: [], rounds: [], insights: [], aim: [], blunders: [] }, parseMs: 1 },
      columns: Object.fromEntries(cols.map((c, i) => [c.name, { type: c.type, offset: base + offsets[i], length: c.data.length }])),
    })
  const base = align(12 + new TextEncoder().encode(header(100000)).length + 64)
  const json = new TextEncoder().encode(header(base))
  const buf = new ArrayBuffer(base + rel)
  const dv = new DataView(buf)
  new Uint8Array(buf).set(new TextEncoder().encode('CRLK'), 0)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, json.length, true)
  new Uint8Array(buf).set(json, 12)
  cols.forEach((c, i) => new ctor[c.type](buf, base + offsets[i], c.data.length).set(c.data))
  return buf
}

function sample(): Replay {
  // Two players, three frames at ticks 0, 2, 4.
  const alive = FLAG.alive
  return new Replay(
    build(
      [
        { name: 'frame.tick', type: 'i32', data: [0, 2, 4] },
        { name: 'player.x', type: 'i16', data: [0, 100, 200, 50, 50, 5000] },
        { name: 'player.y', type: 'i16', data: [0, 0, 0, 0, 0, 0] },
        { name: 'player.z', type: 'i16', data: [0, 0, 0, 0, 0, 0] },
        // 350 degrees then 10 degrees, interpolation should go through 0.
        { name: 'player.yaw', type: 'u16', data: [Math.round((350 / 360) * 65535), Math.round((10 / 360) * 65535), 0, 0, 0, 0] },
        { name: 'player.flags', type: 'u16', data: [alive, alive, alive, alive, alive, alive] },
        { name: 'player.side', type: 'u8', data: [3, 3, 3, 2, 2, 2] },
        { name: 'player.hp', type: 'u8', data: [100, 90, 80, 100, 100, 100] },
      ],
      3,
      2,
    ),
  )
}

describe('Replay', () => {
  it('reads the header and columns', () => {
    const r = sample()
    expect(r.match.map).toBe('de_test')
    expect(r.frames).toBe(3)
    expect(Array.from(r.tick)).toEqual([0, 2, 4])
    expect(r.teamPlayers).toEqual([[0], [1]])
  })

  it('finds frames by tick', () => {
    const r = sample()
    expect(r.frameIndex(-5)).toBe(0)
    expect(r.frameIndex(0)).toBe(0)
    expect(r.frameIndex(3)).toBe(1)
    expect(r.frameIndex(4)).toBe(2)
    expect(r.frameIndex(99)).toBe(2)
  })

  it('interpolates position and takes the short way around for yaw', () => {
    const s = sample().state(0, 1)
    expect(s.x).toBeCloseTo(50)
    expect(((s.yaw % 360) + 360) % 360).toBeCloseTo(0, 1)
    expect(s.hp).toBe(100)
    expect(s.alive).toBe(true)
  })

  it('does not slide players across teleports', () => {
    const s = sample().state(1, 3)
    expect(s.x).toBe(50)
  })
})

describe('prettyPlace', () => {
  it('splits callout names like the Go side', async () => {
    const { prettyPlace } = await import('./replay')
    expect(prettyPlace('BombsiteA')).toBe('Bombsite A')
    expect(prettyPlace('CTSpawn')).toBe('CT Spawn')
    expect(prettyPlace('TopofMid')).toBe('Top of Mid')
  })
})
