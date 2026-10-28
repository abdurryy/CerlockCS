import { describe, expect, it } from 'vitest'
import { layoutOf, lengthSeconds, pages, sizeOf, teamFolder, videoPath } from './videos'

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

describe('layoutOf', () => {
  it('picks a map per round, then per player when there are many', () => {
    expect(layoutOf('auto', 1)).toBe('together')
    expect(layoutOf('auto', 2)).toBe('rounds')
    expect(layoutOf('auto', 9)).toBe('rounds')
    expect(layoutOf('auto', 10)).toBe('players')
    expect(layoutOf('together', 10)).toBe('together')
    expect(layoutOf('rounds', 30)).toBe('rounds')
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
