import { describe, expect, it } from 'vitest'
import { bytes, clock, mapLabel } from './format'

describe('format', () => {
  it('formats the round clock like the game', () => {
    expect(clock(115)).toBe('1:55')
    expect(clock(9.2)).toBe('0:10')
    expect(clock(-3)).toBe('0:00')
  })

  it('formats sizes and map names', () => {
    expect(bytes(298_739_411)).toBe('298.7 MB')
    expect(mapLabel('de_dust2')).toBe('Dust2')
  })
})
