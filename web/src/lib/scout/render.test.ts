import { describe, expect, it } from 'vitest'
import { datesLine, setupText, slug } from './render'

describe('slug', () => {
  it('makes plain ascii file names', () => {
    expect(slug('ZoRoBeast')).toBe('zorobeast')
    expect(slug('high_sensei')).toBe('high-sensei')
    expect(slug('-Cr1t1cal')).toBe('cr1t1cal')
    expect(slug('Pope Urban 𝘭𝘭')).toBe('pope-urban-ll')
    expect(slug('Café Crème')).toBe('cafe-creme')
    expect(slug('⸸ДУКАЛИС⸸')).toBe('dukalis')
    expect(slug('САВВА')).toBe('savva')
    expect(slug('あなたの王様')).toBe('')
    expect(slug('a'.repeat(39) + '-bcd')).toBe('a'.repeat(39))
  })
})

describe('setupText', () => {
  it('groups places and counts repeats', () => {
    expect(setupText(['Ramp', 'Outside', 'Bombsite A', 'Outside'])).toBe('Outside 2, Bombsite A, Ramp')
    expect(setupText([])).toBe('')
  })
})

describe('datesLine', () => {
  const day = (m: number, d: number) => Date.UTC(2026, m, d, 12) / 1000

  it('lists known dates oldest first with the year', () => {
    expect(datesLine([day(9, 5), 0, day(8, 12)])).toBe('12 Sep, 5 Oct 2026')
    expect(datesLine([0, 0])).toBe('')
  })

  it('shortens long lists', () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => day(9, d))
    expect(datesLine(many)).toBe('1 Oct, 2 Oct, …, 6 Oct, 7 Oct, 8 Oct 2026')
  })
})
