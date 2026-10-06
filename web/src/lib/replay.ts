import type {
  BombEvent,
  Blind,
  Blunder,
  Column,
  Damage,
  Engagement,
  Grenade,
  Header,
  Inferno,
  Kill,
  Match,
  Report,
  Round,
} from './types'

export const FLAG = {
  alive: 1 << 0,
  ducking: 1 << 1,
  scoped: 1 << 2,
  defusing: 1 << 3,
  planting: 1 << 4,
  airborne: 1 << 5,
  walking: 1 << 6,
  bomb: 1 << 7,
  kit: 1 << 8,
  helmet: 1 << 9,
  reloading: 1 << 10,
  blind: 1 << 11,
}

export const UTIL = {
  smoke: 1 << 0,
  flash1: 1 << 1,
  flash2: 1 << 2,
  he: 1 << 3,
  fire: 1 << 4,
  decoy: 1 << 5,
}

export const BOMB = { none: 0, carried: 1, dropped: 2, planted: 3, defused: 4, exploded: 5 }

export interface PlayerState {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  hp: number
  armor: number
  flags: number
  weapon: number
  primary: number
  util: number
  flash: number
  money: number
  spotted: number
  side: number
  place: number
  alive: boolean
  present: boolean
}

// prettyPlace turns callout names like "BombsiteA" or "TopofMid" into
// "Bombsite A" and "Top of Mid", same as the Go side.
export function prettyPlace(s: string): string {
  return s
    .replace(/([a-z])of([A-Z])/g, '$1 of $2')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim()
}

export function emptyState(): PlayerState {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 0, armor: 0, flags: 0, weapon: 0, primary: 0,
    util: 0, flash: 0, money: 0, spotted: 0, side: 0, place: 0, alive: false, present: false,
  }
}

type TypedArray = Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array

function view(buf: ArrayBuffer, c: Column | undefined): TypedArray {
  if (!c) return new Uint8Array(0)
  switch (c.type) {
    case 'u8': return new Uint8Array(buf, c.offset, c.length)
    case 'i16': return new Int16Array(buf, c.offset, c.length)
    case 'u16': return new Uint16Array(buf, c.offset, c.length)
    case 'i32': return new Int32Array(buf, c.offset, c.length)
    case 'u32': return new Uint32Array(buf, c.offset, c.length)
    case 'f32': return new Float32Array(buf, c.offset, c.length)
  }
}

function groupByRound<T extends { round: number }>(items: T[] | null, rounds: number): T[][] {
  const out: T[][] = Array.from({ length: rounds }, () => [])
  for (const it of items ?? []) {
    if (it.round >= 0 && it.round < rounds) out[it.round].push(it)
  }
  return out
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return a + d * t
}

export class Replay {
  readonly header: Header
  readonly match: Match
  readonly report: Report
  readonly parseMs: number
  readonly frames: number
  readonly players: number
  readonly rate: number

  readonly tick: Int32Array
  readonly px: Int16Array
  readonly py: Int16Array
  readonly pz: Int16Array
  readonly pyaw: Uint16Array
  readonly ppitch: Int16Array
  readonly php: Uint8Array
  readonly parmor: Uint8Array
  readonly pflags: Uint16Array
  readonly pweapon: Uint16Array
  readonly pprimary: Uint16Array
  readonly putil: Uint8Array
  readonly pflash: Uint8Array
  readonly pmoney: Uint16Array
  readonly pspotted: Uint32Array
  readonly pside: Uint8Array
  readonly pplace: Uint8Array

  readonly bomb: { x: Int16Array; y: Int16Array; z: Int16Array; state: Uint8Array }
  readonly shots: { tick: Int32Array; player: Uint8Array; weapon: Uint16Array; speed: Uint16Array }
  readonly nade: { x: Int16Array; y: Int16Array; z: Int16Array; tick: Int32Array }
  readonly aim: { tick: Int32Array; yaw: Float32Array; pitch: Float32Array; error: Float32Array; visible: Uint8Array }

  readonly kills: Kill[]
  readonly roundKills: Kill[][]
  readonly roundGrenades: Grenade[][]
  readonly roundInfernos: Inferno[][]
  readonly roundBlinds: Blind[][]
  readonly roundBomb: BombEvent[][]
  readonly roundDamages: Damage[][]
  readonly engagements: Engagement[]
  readonly blunders: Blunder[]
  readonly roundBlunders: Blunder[][]
  readonly places: string[]
  // slot[p] is the 1 based position of a player in their team list.
  readonly slot: number[]
  readonly teamPlayers: [number[], number[]]

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf)
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4))
    if (magic !== 'CRLK') throw new Error('not a CerlockCS replay')
    const version = dv.getUint32(4, true)
    if (version !== 2) throw new Error(`this replay was made by another version (${version}), parse the demo again`)
    const len = dv.getUint32(8, true)
    this.header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, len))) as Header
    this.match = this.header.match
    this.report = this.header.extra.analysis
    this.parseMs = this.header.extra.parseMs
    this.frames = this.header.frames
    this.players = this.match.players.length
    this.rate = this.match.tickRate || 64

    const c = this.header.columns
    this.tick = view(buf, c['frame.tick']) as Int32Array
    this.px = view(buf, c['player.x']) as Int16Array
    this.py = view(buf, c['player.y']) as Int16Array
    this.pz = view(buf, c['player.z']) as Int16Array
    this.pyaw = view(buf, c['player.yaw']) as Uint16Array
    this.ppitch = view(buf, c['player.pitch']) as Int16Array
    this.php = view(buf, c['player.hp']) as Uint8Array
    this.parmor = view(buf, c['player.armor']) as Uint8Array
    this.pflags = view(buf, c['player.flags']) as Uint16Array
    this.pweapon = view(buf, c['player.weapon']) as Uint16Array
    this.pprimary = view(buf, c['player.primary']) as Uint16Array
    this.putil = view(buf, c['player.util']) as Uint8Array
    this.pflash = view(buf, c['player.flash']) as Uint8Array
    this.pmoney = view(buf, c['player.money']) as Uint16Array
    this.pspotted = view(buf, c['player.spotted']) as Uint32Array
    this.pside = view(buf, c['player.side']) as Uint8Array
    this.pplace = view(buf, c['player.place']) as Uint8Array
    this.bomb = {
      x: view(buf, c['bomb.x']) as Int16Array,
      y: view(buf, c['bomb.y']) as Int16Array,
      z: view(buf, c['bomb.z']) as Int16Array,
      state: view(buf, c['bomb.state']) as Uint8Array,
    }
    this.shots = {
      tick: view(buf, c['shot.tick']) as Int32Array,
      player: view(buf, c['shot.player']) as Uint8Array,
      weapon: view(buf, c['shot.weapon']) as Uint16Array,
      speed: view(buf, c['shot.speed']) as Uint16Array,
    }
    this.nade = {
      x: view(buf, c['nade.x']) as Int16Array,
      y: view(buf, c['nade.y']) as Int16Array,
      z: view(buf, c['nade.z']) as Int16Array,
      tick: view(buf, c['nade.tick']) as Int32Array,
    }
    this.aim = {
      tick: view(buf, c['aim.tick']) as Int32Array,
      yaw: view(buf, c['aim.yaw']) as Float32Array,
      pitch: view(buf, c['aim.pitch']) as Float32Array,
      error: view(buf, c['aim.error']) as Float32Array,
      visible: view(buf, c['aim.visible']) as Uint8Array,
    }

    const n = this.match.rounds.length
    this.kills = this.match.kills ?? []
    this.roundKills = groupByRound(this.match.kills, n)
    this.roundGrenades = groupByRound(this.match.grenades, n)
    this.roundInfernos = groupByRound(this.match.infernos, n)
    this.roundBlinds = groupByRound(this.match.blinds, n)
    this.roundBomb = groupByRound(this.match.bombEvents, n)
    this.roundDamages = groupByRound(this.match.damages, n)
    this.engagements = this.match.engagements ?? []
    this.blunders = this.report.blunders ?? []
    this.roundBlunders = groupByRound(this.blunders, n)
    this.places = this.match.places ?? ['']

    this.teamPlayers = [[], []]
    for (const p of this.match.players) {
      if (p.team === 0 || p.team === 1) this.teamPlayers[p.team].push(p.index)
    }
    this.slot = new Array(this.players).fill(0)
    for (const team of this.teamPlayers) team.forEach((p, i) => (this.slot[p] = i + 1))
  }

  get firstTick(): number {
    return this.frames ? this.tick[0] : 0
  }

  get lastTick(): number {
    return this.frames ? this.tick[this.frames - 1] : 0
  }

  // frameIndex returns the last frame at or before tick.
  frameIndex(tick: number): number {
    const t = this.tick
    let lo = 0
    let hi = t.length - 1
    if (hi < 0 || tick <= t[0]) return 0
    if (tick >= t[hi]) return hi
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (t[mid] <= tick) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  roundIndex(tick: number): number {
    const rs = this.match.rounds
    for (let i = rs.length - 1; i >= 0; i--) {
      if (tick >= rs[i].startTick) return i
    }
    return 0
  }

  round(i: number): Round {
    return this.match.rounds[Math.max(0, Math.min(i, this.match.rounds.length - 1))]
  }

  // state fills out with player p's interpolated state at a fractional tick.
  state(p: number, tick: number, out: PlayerState = emptyState()): PlayerState {
    const F = this.frames
    if (!F) return out
    const f = this.frameIndex(tick)
    const i = p * F + f
    out.side = this.pside[i]
    out.present = out.side === 2 || out.side === 3
    out.flags = this.pflags[i]
    out.alive = (out.flags & FLAG.alive) !== 0
    out.hp = this.php[i]
    out.armor = this.parmor[i]
    out.weapon = this.pweapon[i]
    out.primary = this.pprimary[i]
    out.util = this.putil[i]
    out.money = this.pmoney[i]
    out.spotted = this.pspotted[i]
    out.place = this.pplace.length ? this.pplace[i] : 0
    out.flash = this.pflash[i] / 40
    out.pitch = this.ppitch[i] / 100

    let x = this.px[i]
    let y = this.py[i]
    let z = this.pz[i]
    let yaw = (this.pyaw[i] / 65535) * 360
    if (f + 1 < F) {
      const j = i + 1
      const t0 = this.tick[f]
      const t1 = this.tick[f + 1]
      const t = t1 > t0 ? Math.min(1, Math.max(0, (tick - t0) / (t1 - t0))) : 0
      const nextAlive = (this.pflags[j] & FLAG.alive) !== 0
      const dx = this.px[j] - x
      const dy = this.py[j] - y
      // Do not slide players across respawns or teleports.
      if (t > 0 && nextAlive === out.alive && dx * dx + dy * dy < 200 * 200) {
        x += dx * t
        y += dy * t
        z += (this.pz[j] - z) * t
        yaw = lerpAngle(yaw, (this.pyaw[j] / 65535) * 360, t)
      }
      if (out.flash > 0) out.flash = Math.max(0, out.flash - (tick - t0) / this.rate)
    }
    out.x = x
    out.y = y
    out.z = z
    out.yaw = yaw
    return out
  }

  // bombAt returns the bomb position and state at a tick.
  bombAt(tick: number): { x: number; y: number; z: number; state: number } {
    const f = this.frameIndex(tick)
    return { x: this.bomb.x[f], y: this.bomb.y[f], z: this.bomb.z[f], state: this.bomb.state[f] }
  }

  // firstShotAfter returns the index of the first shot at or after tick.
  firstShotAfter(tick: number): number {
    const t = this.shots.tick
    let lo = 0
    let hi = t.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (t[mid] < tick) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  // grenadePosition interpolates a projectile along its recorded path.
  grenadePosition(g: Grenade, tick: number): [number, number, number] | null {
    if (g.pathLen === 0) return null
    const { x, y, z, tick: tt } = this.nade
    const start = g.pathStart
    const end = start + g.pathLen - 1
    if (tick < tt[start]) return null
    if (tick >= tt[end]) return [x[end], y[end], z[end]]
    let i = start
    while (i < end && tt[i + 1] <= tick) i++
    const t0 = tt[i]
    const t1 = tt[i + 1]
    const t = t1 > t0 ? (tick - t0) / (t1 - t0) : 0
    return [x[i] + (x[i + 1] - x[i]) * t, y[i] + (y[i + 1] - y[i]) * t, z[i] + (z[i + 1] - z[i]) * t]
  }

  placeName(i: number): string {
    return prettyPlace(this.places[i] ?? '')
  }

  playerName(p: number): string {
    return this.match.players[p]?.name ?? 'world'
  }

  teamName(t: number): string {
    return this.match.teams[t]?.name ?? (t === 0 ? 'Team A' : 'Team B')
  }

  // sideOf returns the side a team plays in a round.
  sideOf(team: number, round: number): number {
    return this.round(round).sideOf[team] ?? 0
  }
}

export async function loadReplay(id: string, onProgress?: (p: number) => void): Promise<Replay> {
  const res = await fetch(`/api/replays/${id}`)
  if (!res.ok) throw new Error(`could not load replay (${res.status})`)
  // Content-Length is the compressed size, use it only as a rough guide.
  const total = Number(res.headers.get('Content-Length')) * 8 || 0
  if (!res.body || !onProgress) return new Replay(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress(Math.min(0.99, received / total))
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  onProgress(1)
  return new Replay(buf.buffer)
}
