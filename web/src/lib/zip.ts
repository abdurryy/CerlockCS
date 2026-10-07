// A small zip writer for exports. Files are stored without compression
// (PNGs are compressed already), which every unzip tool and Windows
// Explorer can open.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// dosTime packs a date the way zip headers want it.
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

// Zip entry names use forward slashes and no leading slash or dots.
function cleanName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/(^|\/)\.\.(?=\/|$)/g, '$1_') || 'file'
}

export function zip(files: { name: string; data: Uint8Array }[], now = new Date()): Blob {
  const enc = new TextEncoder()
  const { time, date } = dosTime(now)
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  const used = new Set<string>()
  let offset = 0
  for (const f of files) {
    // Two entries with the same name would hide one of them.
    const base = cleanName(f.name)
    const dot = base.lastIndexOf('.')
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`
    }
    used.add(name.toLowerCase())
    const nameBytes = enc.encode(name)
    const crc = crc32(f.data)
    const size = f.data.length
    // Bit 11: the name is UTF-8.
    const flags = 0x0800

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, flags, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    const entry = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, flags, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    entry.set(nameBytes, 46)

    const data = new Uint8Array(size)
    data.set(f.data)
    parts.push(local, data)
    central.push(entry)
    offset += local.length + size
  }
  let centralSize = 0
  for (const c of central) centralSize += c.length
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}

// downloadBlob saves a blob through the browser's download.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Some browsers start the download a little after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
