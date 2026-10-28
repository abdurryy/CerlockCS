import { describe, expect, it } from 'vitest'
import { lengthSeconds, pages, sizeOf, SLOW_AFTER, SLOW_BEFORE, STORY_HOLD, STORY_INTRO, storyAt, storyPages, storyPlan, teamFolder, videoPath } from './videos'

describe('videoPath', () => {
  it('puts each video in team, map and side folders', () => {
    expect(videoPath('E-ManiacS', 'de_mirage', { side: 'ct', buy: 'eco' }, 'mp4')).toBe('e-maniacs/mirage/ct/eco-rounds.mp4')
    expect(videoPath('E-ManiacS', 'de_ancient', { side: 't', buy: 'force' }, 'webm')).toBe('e-maniacs/ancient/t/force-buys.webm')
    expect(videoPath('E-ManiacS', 'de_nuke', { side: 't', buy: 'antieco' }, 'mp4')).toBe('e-maniacs/nuke/t/anti-eco-rounds.mp4')
  })

  it('keeps names the server takes', () => {
    expect(teamFolder('')).toBe('team')
    expect(teamFolder('★★★')).toBe('team')
    expect(teamFolder('Наши Ребята')).toBe('nashi-rebyata')
    const part = /^[a-z0-9][a-z0-9_-]{0,63}$/
    for (const p of videoPath('-- Team Name! --', 'workshop/12345/de_custom', { side: 'ct', buy: 'full' }, 'mp4').split('/')) {
      expect(p.replace(/\.mp4$/, '')).toMatch(part)
    }
  })

  it('has defaults for unknown options', () => {
    expect(sizeOf('nope').w).toBe(1920)
    expect(lengthSeconds('round')).toBe(0)
    expect(lengthSeconds('30')).toBe(30)
  })
})

describe('storyPlan', () => {
  const rounds = [
    { round: 2, length: 40 },
    { round: 5, length: 90 },
  ]

  it('puts the rounds one after another with a title card each', () => {
    const plan = storyPlan(rounds, 2)
    expect(plan.parts.map((p) => p.round)).toEqual([2, 5])
    expect(plan.parts[0].start).toBe(0)
    expect(plan.parts[1].start).toBeCloseTo(STORY_INTRO + 20 + STORY_HOLD)
    expect(plan.total).toBeCloseTo(2 * (STORY_INTRO + STORY_HOLD) + 20 + 45)
  })

  it('finds the round and its time at any moment', () => {
    const plan = storyPlan(rounds, 2)
    // On the first title card the round has not started.
    expect(storyAt(plan, 0.5)).toMatchObject({ k: 0, t: 0 })
    expect(storyAt(plan, 0.5).intro).toBeGreaterThan(0.9)
    // Ten seconds in at twice the speed is 20 s of the round.
    expect(storyAt(plan, STORY_INTRO + 10).k).toBe(0)
    expect(storyAt(plan, STORY_INTRO + 10).t).toBeCloseTo(20)
    // The hold keeps the end of the round.
    expect(storyAt(plan, STORY_INTRO + 20 + 0.5)).toEqual({ k: 0, t: 40, intro: 0 })
    const second = plan.parts[1].start
    const mid = storyAt(plan, second + STORY_INTRO + 1)
    expect(mid.k).toBe(1)
    expect(mid.t).toBeCloseTo(2)
    expect(storyAt(plan, plan.total + 5)).toEqual({ k: 1, t: 90, intro: 0 })
  })

  it('plays fights at real speed', () => {
    const plain = storyPlan([{ round: 0, length: 60 }], 2)
    const fight = storyPlan([{ round: 0, length: 60, fights: [30] }], 2)
    // The four seconds around the fight take twice as long.
    expect(fight.total - plain.total).toBeCloseTo((SLOW_BEFORE + SLOW_AFTER) / 2, 1)
    // Real speed starts 1.5 s before the fight, at 28.5 s of the round.
    const at = STORY_INTRO + (30 - SLOW_BEFORE) / 2
    expect(storyAt(fight, at).t).toBeCloseTo(30 - SLOW_BEFORE, 1)
    // From there a video second is a round second.
    expect(storyAt(fight, at + 1).t).toBeCloseTo(31 - SLOW_BEFORE, 1)
    // And the end of the round is still the end.
    expect(storyAt(fight, fight.total - 0.1).t).toBeCloseTo(60, 5)
  })

  it('starts with the summary card', () => {
    const plan = storyPlan(rounds, 2, 5)
    expect(plan.parts[0].start).toBe(5)
    expect(storyAt(plan, 2).cover).toBe(1)
    expect(storyAt(plan, 2).t).toBe(0)
    expect(storyAt(plan, 5.5).cover).toBeUndefined()
    expect(storyAt(plan, 5.5).intro).toBeGreaterThan(0)
  })

  it('splits long sets into videos of at most five minutes', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ round: i, length: 100 }))
    const parts = storyPages(many, 2)
    for (const p of parts) expect(storyPlan(p, 2).total).toBeLessThanOrEqual(300)
    expect(parts.flat().map((r) => r.round)).toEqual(many.map((r) => r.round))
    // A single round longer than the limit still gets its own video.
    expect(storyPages([{ round: 0, length: 900 }], 1)).toHaveLength(1)
  })
})

describe('pages', () => {
  it('splits a map per round into nines', () => {
    const r = Array.from({ length: 20 }, (_, i) => i)
    expect(pages(r, 'rounds').map((p) => [p[0], p.length])).toEqual([[0, 9], [9, 9], [18, 2]])
    expect(pages(r, 'players')).toEqual([r])
    expect(pages([0, 1], 'rounds')).toEqual([[0, 1]])
  })

  it('names the parts by their rounds', () => {
    expect(videoPath('E-ManiacS', 'de_mirage', { side: 'ct', buy: 'full' }, 'mp4', { from: 10, to: 18 })).toBe('e-maniacs/mirage/ct/full-buys-rounds-10-18.mp4')
  })
})
