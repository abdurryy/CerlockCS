import type {
  ApiErrorCode,
  DownloadResult,
  Entry,
  FindResult,
  FoundMatch,
  Job,
  LocalDemo,
  MapInfo,
  ScoutLookup,
  ScoutPlayer,
  ScoutTeam,
  Settings,
} from './types'

// ApiError is a failed request, with the server's code when it sent one.
export class ApiError extends Error {
  code: ApiErrorCode | ''
  status: number

  constructor(message: string, status: number, code: ApiErrorCode | '' = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText || `request failed (${res.status})`
    let code: ApiErrorCode | '' = ''
    try {
      const body = await res.json()
      msg = body.error ?? msg
      code = body.code ?? ''
    } catch {
      // not json
    }
    throw new ApiError(msg, res.status, code)
  }
  return res.json() as Promise<T>
}

async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError('Cerlock is not answering, is it still running?', 0)
  }
  return json(res)
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

export async function getSettings(): Promise<Settings> {
  const s = await json<Partial<Settings>>(await fetch('/api/settings'))
  return { faceitKey: !!s.faceitKey, faceitKeyHint: s.faceitKeyHint ?? '' }
}

// saveFaceitKey stores the key on the server. An empty key removes it.
export async function saveFaceitKey(key: string): Promise<Settings> {
  const s = await send<Partial<Settings>>('PUT', '/api/settings', { faceitKey: key })
  return { faceitKey: !!s.faceitKey, faceitKeyHint: s.faceitKeyHint ?? '' }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

function cleanPlayer(p: Partial<ScoutPlayer>): ScoutPlayer {
  return { faceitId: str(p?.faceitId), nickname: str(p?.nickname), steamId: str(p?.steamId), avatar: str(p?.avatar) }
}

function cleanTeam(t: Partial<ScoutTeam>): ScoutTeam {
  return { id: str(t?.id), name: str(t?.name), avatar: str(t?.avatar), players: list<Partial<ScoutPlayer>>(t?.players).map(cleanPlayer) }
}

// scoutLookup reads a match room or team link (or a bare id).
export async function scoutLookup(url: string): Promise<ScoutLookup> {
  const l = await send<Partial<ScoutLookup>>('POST', '/api/scout/match', { url })
  return {
    matchId: str(l.matchId),
    map: str(l.map),
    startedAt: num(l.startedAt),
    competition: str(l.competition),
    teams: list<Partial<ScoutTeam>>(l.teams).map(cleanTeam),
  }
}

function cleanMatch(m: Partial<FoundMatch>): FoundMatch {
  const kind = m.kind === 'league' || m.kind === 'matchmaking' ? m.kind : 'other'
  return {
    matchId: str(m.matchId),
    url: str(m.url),
    map: str(m.map),
    startedAt: num(m.startedAt),
    competition: str(m.competition),
    kind,
    won: typeof m.won === 'boolean' ? m.won : null,
    score: str(m.score),
    players: list<unknown>(m.players).map(str).filter(Boolean),
    opponent: str(m.opponent),
    demo: !!m.demo,
    replayId: str(m.replayId),
  }
}

// scoutFind looks for the matches where at least minTogether of the players
// were on the same side.
export async function scoutFind(players: Pick<ScoutPlayer, 'faceitId' | 'nickname' | 'steamId'>[], minTogether: number, limit = 100): Promise<FindResult> {
  const r = await send<Partial<FindResult>>('POST', '/api/scout/find', {
    players: players.map((p) => ({ faceitId: p.faceitId, nickname: p.nickname, steamId: p.steamId })),
    minTogether,
    limit,
  })
  return {
    matches: list<Partial<FoundMatch>>(r.matches).map(cleanMatch).filter((m) => m.matchId),
    maps: list<{ map?: unknown; played?: unknown; won?: unknown }>(r.maps).map((m) => ({ map: str(m?.map), played: num(m?.played), won: num(m?.won) })),
  }
}

// scoutDownload asks the server to download the demos of these matches.
// They show up as jobs in listReplays while they download and parse.
export async function scoutDownload(matchIds: string[]): Promise<DownloadResult> {
  const r = await send<Partial<DownloadResult>>('POST', '/api/scout/download', { matchIds })
  return {
    queued: list<unknown>(r.queued).map(str),
    failed: list<{ matchId?: unknown; error?: unknown }>(r.failed).map((f) => ({ matchId: str(f?.matchId), error: str(f?.error) })),
    downloadsAllowed: r.downloadsAllowed !== false,
  }
}
