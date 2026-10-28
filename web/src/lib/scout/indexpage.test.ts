import { describe, expect, it } from 'vitest'
import { esc, indexHtml } from './indexpage'
import type { MapScout, Situation } from './types'

function situation(side: 'ct' | 't', buy: Situation['buy'], title: string): Situation {
  const tracks = [
    { label: 'Match 1, round 2', won: true, hit: 'B' },
    { label: 'Match 2, round 3', won: false, hit: '' },
  ]
  return { key: `${side}-${buy}`, side, buy, title, rounds: 6, won: 3, notes: ['They <stack> B & rotate late.'], tracks } as unknown as Situation
}

const eco = situation('ct', 'eco', 'CT eco rounds')
const full = situation('t', 'full', 'T full buys')
const mirage = {
  map: 'de_mirage',
  replays: [{}, {}],
  won: { ct: 7, t: 5 },
  ctRounds: 12,
  tRounds: 12,
  tendencies: ['On CT eco rounds they push Connector.'],
  roles: [{ steamId: '1', name: '<b>Zo</b>', color: '#4fa6ff', ct: { label: 'AWP' }, t: { label: 'Entry' } }],
  situations: [eco, full],
} as unknown as MapScout

describe('indexHtml', () => {
  const html = indexHtml(
    'E-ManiacS',
    [mirage],
    [
      { map: 'de_mirage', situation: eco, path: 'mirage/ct/eco-rounds.mp4', chapters: [{ round: 0, at: 2.5 }, { round: 1, at: 40.25 }] },
      { map: 'de_mirage', situation: full, path: 'mirage/t/full-buys-rounds-1-6.mp4', part: { from: 1, to: 6 } },
      { map: 'de_mirage', situation: full, path: 'mirage/t/full-buys-rounds-7-9.mp4', part: { from: 7, to: 9 } },
    ],
    [{ map: 'de_mirage', situation: eco, path: 'mirage/ct/eco-rounds.png' }],
  )

  it('links every video by its path next to the page', () => {
    expect(html).toContain('<video controls preload="metadata" src="mirage/ct/eco-rounds.mp4"></video>')
    expect(html).toContain('src="mirage/t/full-buys-rounds-7-9.mp4"')
    expect(html).toContain('Rounds 7 to 9')
  })

  it('lists the rounds of a video to jump to', () => {
    expect(html).toContain('<button type="button" data-t="2.50"><span><time>0:02</time>Match 1, round 2</span><span class="good">Won, B</span></button>')
    expect(html).toContain('data-t="40.25"><span><time>0:40</time>Match 2, round 3</span><span class="bad">Lost</span>')
    expect(html).toContain("closest('.ch button')")
  })

  it('shows the round sheets', () => {
    expect(html).toContain('<img src="mirage/ct/eco-rounds.png" alt="Round sheet" loading="lazy">')
  })

  it('groups by map and side', () => {
    expect(html).toContain('<h2>Mirage</h2>')
    expect(html.indexOf('CT side')).toBeLessThan(html.indexOf('T side'))
    expect(html).toContain('Eco rounds')
  })

  it('escapes names and notes from the demos', () => {
    expect(html).not.toContain('<b>Zo</b>')
    expect(html).toContain('&lt;b&gt;Zo&lt;/b&gt;')
    expect(html).toContain('They &lt;stack&gt; B &amp; rotate late.')
    expect(esc('"x"')).toBe('&quot;x&quot;')
  })
})
