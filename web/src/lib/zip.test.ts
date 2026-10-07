import { describe, expect, it } from 'vitest'
import { crc32, zip } from './zip'

const enc = new TextEncoder()

interface Entry {
  name: string
  crc: number
  size: number
  offset: number
  flags: number
}

// readZip walks the archive from the end record, the way unzip tools do,
// and checks every local header against the central directory.
function readZip(buf: Uint8Array): { entries: Entry[]; data: Map<string, Uint8Array> } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const end = buf.length - 22
  expect(dv.getUint32(end, true)).toBe(0x06054b50)
  const count = dv.getUint16(end + 10, true)
  const cdSize = dv.getUint32(end + 12, true)
  const cdOffset = dv.getUint32(end + 16, true)
  expect(cdOffset + cdSize).toBe(end)
  const entries: Entry[] = []
  const data = new Map<string, Uint8Array>()
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50)
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const crc = dv.getUint32(p + 16, true)
    const csize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true)
    const offset = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen))
    expect(method).toBe(0)
    expect(csize).toBe(size)
    // The local header says the same.
    expect(dv.getUint32(offset, true)).toBe(0x04034b50)
    expect(dv.getUint32(offset + 14, true)).toBe(crc)
    expect(dv.getUint32(offset + 22, true)).toBe(size)
    const lnlen = dv.getUint16(offset + 26, true)
    const extra = dv.getUint16(offset + 28, true)
    expect(new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + lnlen))).toBe(name)
    const start = offset + 30 + lnlen + extra
    const body = buf.subarray(start, start + size)
    expect(crc32(body)).toBe(crc)
    entries.push({ name, crc, size, offset, flags })
    data.set(name, body)
    p += 46 + nlen
  }
  expect(p).toBe(end)
  return { entries, data }
}

describe('crc32', () => {
  it('matches known values', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(enc.encode('hello'))).toBe(0x3610a686)
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('zip', () => {
  it('stores files with headers an unzip tool accepts', async () => {
    const png = new Uint8Array(1000).map((_, i) => (i * 7) & 255)
    const blob = zip(
      [
        { name: 'nuke-ct-team.png', data: png },
        { name: 'notes.txt', data: enc.encode('hello') },
        { name: 'nuke-ct-early-ДУКАЛИС.png', data: new Uint8Array(0) },
      ],
      new Date(2026, 9, 7, 14, 30, 10),
    )
    expect(blob.type).toBe('application/zip')
    const buf = new Uint8Array(await blob.arrayBuffer())
    const { entries, data } = readZip(buf)
    expect(entries.map((e) => e.name)).toEqual(['nuke-ct-team.png', 'notes.txt', 'nuke-ct-early-ДУКАЛИС.png'])
    expect(entries[1].crc).toBe(0x3610a686)
    expect(Array.from(data.get('nuke-ct-team.png')!)).toEqual(Array.from(png))
    expect(new TextDecoder().decode(data.get('notes.txt'))).toBe('hello')
    // UTF-8 names are flagged so Windows shows them right.
    for (const e of entries) expect(e.flags & 0x0800).toBe(0x0800)
    // Date and time in DOS format.
    const dv = new DataView(buf.buffer)
    const time = dv.getUint16(10, true)
    const date = dv.getUint16(12, true)
    expect(time >> 11).toBe(14)
    expect((time >> 5) & 63).toBe(30)
    expect(date >> 9).toBe(2026 - 1980)
    expect((date >> 5) & 15).toBe(10)
    expect(date & 31).toBe(7)
  })

  it('keeps duplicate names apart and cleans paths', async () => {
    const blob = zip([
      { name: 'a.png', data: enc.encode('1') },
      { name: 'A.png', data: enc.encode('2') },
      { name: '/../x/../b.png', data: enc.encode('3') },
    ])
    const { entries } = readZip(new Uint8Array(await blob.arrayBuffer()))
    expect(entries.map((e) => e.name)).toEqual(['a.png', 'A-2.png', '_/x/_/b.png'])
  })

  it('writes an empty archive', async () => {
    const blob = zip([])
    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(buf.length).toBe(22)
    expect(readZip(buf).entries).toEqual([])
  })
})
