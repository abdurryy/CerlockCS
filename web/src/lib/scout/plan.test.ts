import { describe, expect, it } from 'vitest'
import { clock, gamePlan, planText, strengthOf, type PlanLine } from './plan'
import type { BuyKind, MapScout, PlantScout, Situation, SituationTrack, TrackFacts } from './types'

function track(round: number, won: boolean, hit: string, hitTime: number, facts: Partial<TrackFacts>, replayId = 'm1'): SituationTrack {
  const f: TrackFacts = { setup: { A: 2, B: 2, mid: 1, other: 0 }, plant: '', ...facts }
  return { replayId, round, label: `Round ${round}`, won, hit, hitTime, end: 90, tick: 0, rate: 64, players: [], events: [], facts: f }
}

function situation(side: 'ct' | 't', buy: BuyKind, tracks: SituationTrack[]): Situation {
  return {
    key: `${side}-${buy}`,
    side,
    buy,
    title: `${side.toUpperCase()} ${buy}`,
    rounds: tracks.length,
    won: tracks.filter((t) => t.won).length,
    rushes: 0,
    hits: [],
    noHit: tracks.filter((t) => !t.hit).length,
    stacks: [],
    pushes: 0,
    saves: 0,
    tracks,
  } as unknown as Situation
}

function scout(situations: Situation[], extra: { retake?: PlantScout[]; postPlant?: PlantScout[] } = {}): MapScout {
  return {
    map: 'de_mirage',
    ctRounds: 12,
    tRounds: 12,
    won: { ct: 7, t: 5 },
    situations,
    retake: extra.retake ?? [],
    postPlant: extra.postPlant ?? [],
  } as unknown as MapScout
}

function find(lines: PlanLine[], kind: PlanLine['kind']): PlanLine | undefined {
  return lines.find((l) => l.kind === kind)
}

const stackA = { setup: { A: 3, B: 1, mid: 1, other: 0 } }

describe('strengthOf', () => {
  it('needs rounds to be sure', () => {
    expect(strengthOf(5, 6)).toBe('strong')
    expect(strengthOf(2, 3)).toBe('likely')
    expect(strengthOf(2, 2)).toBe('weak')
    expect(strengthOf(1, 6)).toBe('weak')
  })
})

describe('your T side', () => {
  const full = situation('ct', 'full', [
    track(5, true, 'A', 40, stackA),
    track(6, false, 'B', 30, { ...stackA, rotate: { players: 2, first: 6 } }),
    track(8, true, 'A', 50, { ...stackA, rotate: { players: 3, first: 5 } }),
    track(9, false, 'B', 50, { ...stackA, rotate: { players: 2, first: 8 }, push: { player: 'ZoRo', place: 'Ramp' } }),
    track(11, true, 'A', 38, { setup: { A: 2, B: 2, mid: 1, other: 0 }, push: { player: 'ZoRo', place: 'Ramp' } }),
    track(12, false, 'B', 60, { ...stackA, awp: { player: 'Zo', place: 'Window' }, push: { player: 'ZoRo', place: 'Ramp' } }),
  ])
  const plan = gamePlan(scout([full]))
  const lines = plan.t.parts[0].lines

  it('hits the thin site and says why', () => {
    const l = find(lines, 'site')!
    expect(l.do).toBe('Hit B')
    expect(l.why).toContain('B had 1 player or less in 5 of 6')
    expect(l.why).toContain('Teams that went B won 3 of 3')
    expect(l.strength).toBe('strong')
    expect(l.situation).toBe('ct-full')
    expect(l.rounds).toEqual([0, 1, 2, 3, 5])
  })

  it('fakes when they rotate fast', () => {
    const l = find(lines, 'fake')!
    expect(l.do).toBe('Fake A with utility, then go B')
    expect(l.why).toContain('3 of 3')
  })

  it('punishes the early push', () => {
    const l = find(lines, 'push')!
    expect(l.do).toContain('Hold Ramp')
    expect(l.why).toContain('ZoRo pushed Ramp early in 3 of 6')
    expect(l.rounds).toEqual([3, 4, 5])
  })

  it('leaves out what happened once', () => {
    expect(find(lines, 'awp')).toBeUndefined()
  })

  it('has a title per side and the best lines on top', () => {
    expect(plan.t.title).toBe('Your T side')
    expect(plan.t.sub).toContain('They are CT')
    expect(plan.key[0].kind).toBe('site')
    expect(plan.ct.parts).toHaveLength(0)
  })
})

describe('your CT side', () => {
  const pistol = situation('t', 'pistol', [
    track(1, false, 'B', 18, { entry: 'Apartments' }),
    track(13, true, 'B', 22, { entry: 'Apartments' }, 'm2'),
    track(1, false, 'B', 15, { entry: 'Apartments' }, 'm3'),
  ])
  const force = situation('t', 'force', [track(2, true, 'A', 50, {}), track(2, false, 'B', 40, {}, 'm3')])
  const full = situation('t', 'full', [
    track(4, true, 'A', 60, { lurk: { player: 'Lurk', place: 'Palace' }, opening: { player: 'Entry', place: 'Ramp', won: false, time: 20, other: 'Ticket' } }),
    track(5, false, 'A', 70, { lurk: { player: 'Lurk', place: 'Palace' }, opening: { player: 'Entry', place: 'Ramp', won: false, time: 25, other: 'Ticket' } }),
    track(6, true, 'A', 55, { opening: { player: 'Entry', place: 'Ramp', won: false, time: 18, other: 'Ticket' } }),
    track(7, false, 'B', 65, { lurk: { player: 'Lurk', place: 'Palace' } }),
    track(8, true, 'A', 50, { opening: { player: 'Zo', place: 'Mid', won: true, time: 10, other: 'Top mid' } }),
  ])
  const plan = gamePlan(
    scout([pistol, force, full], {
      postPlant: [
        { site: 'A', rounds: 5, won: 1, places: [{ place: 'Palace', share: 0.4 }, { place: 'Ramp', share: 0.3 }] },
        { site: 'B', rounds: 4, won: 4, places: [] },
      ] as unknown as PlantScout[],
    }),
  )
  const part = (key: string) => plan.ct.parts.find((p) => p.key === key)!

  it('stacks against the pistol rush with utility in time', () => {
    const l = find(part('t-pistol').lines, 'utility')!
    expect(l.do).toBe('Stack B early and have utility on Apartments by 0:10')
    expect(l.why).toContain('They rushed B in 3 of 3')
  })

  it('reads the buy after a lost pistol', () => {
    const l = find(part('t-pistol').lines, 'economy')!
    expect(l.do).toContain('expect a force buy')
    expect(l.why).toContain('forced the next round in 2 of 2')
  })

  it('plays an extra on their favourite site and slow hits', () => {
    const lines = part('t-full').lines
    expect(find(lines, 'setup')!.do).toBe('Play an extra player on A')
    expect(find(lines, 'speed')!.why).toContain('after 60 s on average')
    expect(find(lines, 'lurk')!.do).toContain('Palace')
  })

  it('finds where they lose the first duel', () => {
    const l = find(part('t-full').lines, 'fight')!
    expect(l.do).toBe('Hold Ramp early, they lose the first fight there')
    expect(l.why).toBe('Their first death was at Ramp in 3 of 4, mostly Entry.')
  })

  it('reads their post plants', () => {
    const after = plan.ct.parts.find((p) => p.title === 'After the plant')!
    expect(after.lines.map((l) => l.do)).toContain('Always go for the retake on A')
    expect(after.lines.map((l) => l.do)).toContain('Stop the B plant, the retake is hard')
    expect(after.lines.map((l) => l.do)).toContain('On the A retake, clear Palace and Ramp first')
  })

  it('writes the plan as text', () => {
    const text = planText(plan, 'Mirage', 'E-ManiacS')
    expect(text).toContain('Game plan against E-ManiacS on Mirage')
    expect(text).toContain('Your CT side. They are T')
    expect(text).toContain('- Stack B early')
  })
})

describe('clock', () => {
  it('writes minutes and seconds', () => {
    expect(clock(70)).toBe('1:10')
    expect(clock(9.6)).toBe('0:10')
  })
})
