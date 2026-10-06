import type { Entry, Job, LocalDemo, MapInfo } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      // not json
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export async function listReplays(): Promise<{ replays: Entry[]; jobs: Job[] }> {
  return json(await fetch('/api/replays'))
}

export async function getEntry(id: string): Promise<Entry | null> {
  const res = await fetch(`/api/replays/${id}/info`)
  if (res.status === 404) return null
  return json(res)
}

export async function deleteReplay(id: string): Promise<void> {
  await fetch(`/api/replays/${id}`, { method: 'DELETE' })
}

export async function listLocal(): Promise<{ dirs: string[] | null; demos: LocalDemo[] | null }> {
  return json(await fetch('/api/library'))
}

export async function parseLocal(path: string): Promise<void> {
  const res = await fetch(`/api/library/parse?path=${encodeURIComponent(path)}`, { method: 'POST' })
  if (!res.ok) await json(res)
}

export async function mapInfo(name: string): Promise<MapInfo> {
  return json(await fetch(`/api/maps/${encodeURIComponent(name)}`))
}

const FINGERPRINT_BYTES = 1 << 20

// fingerprint matches pipeline.Fingerprint on the server: sha256 over the
// file size (uint64, little endian) followed by the first megabyte.
export async function fingerprint(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, FINGERPRINT_BYTES).arrayBuffer())
  const data = new Uint8Array(8 + head.length)
  new DataView(data.buffer).setBigUint64(0, BigInt(file.size), true)
  data.set(head, 8)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}

// upload sends the demo as the raw request body. The server parses while
// the bytes arrive, so upload progress is also parse progress.
export function upload(file: File, onProgress: (p: number) => void): Promise<Entry> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as Entry)
      else reject(new Error((xhr.response && xhr.response.error) || `upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('upload failed, is the server running?'))
    xhr.send(file)
  })
}
