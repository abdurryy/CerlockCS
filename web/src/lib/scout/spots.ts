import type { MapLabels } from './aggregate'
import { levelOf } from './aggregate'
import { slug } from './slug'
import type { MapScout, SituationTrack } from './types'

// Spots are where each player usually stands a few seconds into their
// rounds, with the way they look, as setpos and setang commands. A config
// file with one alias per spot lets you walk through them on a private
// server.

export interface Spot {
  steamId: string
  name: string
  color: string
  side: 'ct' | 't'
  // Seconds after freeze time.
  at: number
  // The nearest callout, '' when the map has none.
  place: string
  // World position of the feet and the yaw, for setpos and setang.
  x: number
  y: number
  z: number
  yaw: number
  // Radar position and floor, for drawing.
  rx: number
  ry: number
  level: number
  // Rounds they stood here, out of the rounds they played on this side.
  rounds: number
  of: number
  // Console alias, like ct_zorobeast_1.
  alias: string
}

export interface SpotOptions {
  // When to look, seconds after freeze time.
  ctSeconds: number
  tSeconds: number
  // Standing closer than this, in world units, is the same spot.
  radius: number
  maxPerPlayer: number
}

export const SPOT_OPTIONS: SpotOptions = { ctSeconds: 15, tSeconds: 20, radius: 200, maxPerPlayer: 3 }

interface Sample {
  rx: number
  ry: number
  z: number
  yaw: number
  level: number
}

// meanYaw is the average of angles in degrees, or null when they point
// all over the place.
function meanYaw(list: number[]): number | null {
  let c = 0
  let s = 0
  for (const a of list) {
    c += Math.cos((a * Math.PI) / 180)
    s += Math.sin((a * Math.PI) / 180)
  }
  const n = list.length
  if (!n || Math.hypot(c, s) / n < 0.5) return null
  return (Math.atan2(s, c) * 180) / Math.PI
}

function nearestPlace(labels: MapLabels | undefined, rx: number, ry: number, level: number): string {
  let best = ''
  let bd = Infinity
  for (const c of labels?.callouts ?? []) {
    if (c.level !== level) continue
    const d = (c.x - rx) ** 2 + (c.y - ry) ** 2
    if (d < bd) {
      bd = d
      best = c.name
    }
  }
  return best
}

// findSpots reads the spots of every roster player from the situation
// tracks. A spot needs 2 rounds, or 1 when the player has only 1 or 2
// rounds on that side.
export function findSpots(
  scout: Pick<MapScout, 'info' | 'situations' | 'roles'>,
  labels?: MapLabels,
  step = 0.125,
  opts: SpotOptions = SPOT_OPTIONS,
): Spot[] {
  const { info } = scout
  const scale = info.scale || 5
  const R = opts.radius / scale
  const out: Spot[] = []
  // One alias name per player, numbered when two names read the same.
  const bases = new Map<string, string>()
  const used = new Set<string>()
  for (const role of scout.roles) {
    const b = slug(role.name).replace(/-/g, '_') || 'player'
    let name = b
    for (let n = 2; used.has(name); n++) name = `${b}_${n}`
    used.add(name)
    bases.set(role.steamId, name)
  }
  for (const side of ['ct', 't'] as const) {
    const at = side === 'ct' ? opts.ctSeconds : opts.tSeconds
    const tracks: SituationTrack[] = scout.situations.filter((s) => s.side === side).flatMap((s) => s.tracks)
    for (const role of scout.roles) {
      const samples: Sample[] = []
      let of = 0
      for (const tr of tracks) {
        const p = tr.players.find((q) => q.steamId === role.steamId)
        if (!p) continue
        of++
        // Rounds that were over by then have no spot.
        const i = Math.round(at / step)
        if (i < 0 || i >= p.xs.length || !p.alive[i]) continue
        samples.push({ rx: p.xs[i], ry: p.ys[i], z: p.zs[i], yaw: p.yaw ? p.yaw[i] : 0, level: levelOf(info, p.zs[i]) })
      }
      const near = (a: Sample, b: Sample) => a.level === b.level && (a.rx - b.rx) ** 2 + (a.ry - b.ry) ** 2 <= R * R
      let left = samples
      let k = 0
      while (left.length && k < opts.maxPerPlayer) {
        // The sample with the most others around it is the centre.
        let centre = left[0]
        let most = -1
        for (const a of left) {
          let n = 0
          for (const b of left) if (near(a, b)) n++
          if (n > most) {
            most = n
            centre = a
          }
        }
        const group = left.filter((b) => near(centre, b))
        if (group.length < 2 && !(group.length === 1 && of <= 2)) break
        left = left.filter((b) => !near(centre, b))
        k++
        out.push({
          steamId: role.steamId,
          name: role.name,
          color: role.color,
          side,
          at,
          place: nearestPlace(labels, centre.rx, centre.ry, centre.level),
          x: centre.rx * scale + info.posX,
          y: info.posY - centre.ry * scale,
          z: centre.z,
          yaw: meanYaw(group.map((g) => g.yaw)) ?? centre.yaw,
          rx: centre.rx,
          ry: centre.ry,
          level: centre.level,
          rounds: group.length,
          of,
          alias: `${side}_${bases.get(role.steamId)}_${k}`,
        })
      }
    }
  }
  return out
}

// spotCommand is what to paste in the console to stand there. The feet go
// a unit up so you never start inside the floor.
export function spotCommand(s: Spot): string {
  const yaw = ((s.yaw % 360) + 540) % 360 - 180
  return `setpos ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${(s.z + 1).toFixed(1)}; setang 0 ${yaw.toFixed(1)} 0`
}

// The console reads quotes and semicolons, so names lose them.
function plain(s: string): string {
  return s.replace(/[^\p{L}\p{N} _.,()-]+/gu, '').trim() || 'player'
}

function spotLine(s: Spot): string {
  return `${plain(s.name)}, ${s.side.toUpperCase()}, ${s.place ? `${plain(s.place)}, ` : ''}${s.rounds} of ${s.of} rounds`
}

// cfgName is the config file name without .cfg.
export function cfgName(map: string, teamName: string): string {
  const m = slug(map.replace(/^[a-z]+_/, '')).replace(/-/g, '_') || 'map'
  const t = slug(teamName).replace(/-/g, '_')
  return t ? `cerlock_${m}_${t}` : `cerlock_${m}`
}

// spotsCfg writes the config file.
export function spotsCfg(map: string, mapName: string, teamName: string, matches: number, spots: Spot[]): string {
  const file = cfgName(map, teamName)
  const team = plain(teamName) || 'the team'
  const ct = spots.find((s) => s.side === 'ct')?.at ?? SPOT_OPTIONS.ctSeconds
  const t = spots.find((s) => s.side === 't')?.at ?? SPOT_OPTIONS.tSeconds
  const lines = [
    `// CerlockCS spots: ${team} on ${mapName}`,
    `// Where each player usually stands ${ct} s into CT rounds and ${t} s into`,
    `// T rounds, from ${matches} ${matches === 1 ? 'match' : 'matches'}, with the way they look.`,
    '//',
    '// Put this file in',
    '//   Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg',
    `// start a practice match on ${map} (offline with bots or a private`,
    '// server), open the console and type',
    `//   exec ${file}`,
    '// Then type a spot name to stand there, spot_next to go through them',
    '// all, or spots to see the list again.',
    '//',
    '// Made with CerlockCS, https://github.com/abdurryy/CerlockCS',
    '',
    'sv_cheats 1',
    '',
  ]
  for (const s of spots) lines.push(`alias ${s.alias} "${spotCommand(s)}; echo ${spotLine(s)}"`)
  if (spots.length) {
    lines.push('')
    spots.forEach((s, i) => lines.push(`alias cerlock_spot_${i + 1} "${s.alias}; alias spot_next cerlock_spot_${((i + 1) % spots.length) + 1}"`))
    lines.push('alias spot_next cerlock_spot_1')
  }
  lines.push(`alias spots "exec ${file}"`, '', `echo "CerlockCS spots: ${team} on ${mapName}"`)
  for (const s of spots) lines.push(`echo "  ${s.alias.padEnd(28)} ${spotLine(s)}"`)
  if (!spots.length) lines.push('echo "  No spots, not enough rounds yet."')
  else lines.push('echo "Type a spot name, or spot_next to go through them."')
  return lines.join('\n') + '\n'
}
