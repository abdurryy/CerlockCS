// Colours shared by the canvas and the components. They match the tokens in
// app.css, the canvas cannot read CSS variables cheaply so they live here too.

export const BG = '#0b0d11'
export const TEXT = '#eceff3'
export const TEXT_2 = '#a6afba'
export const ACCENT = '#f04b53'
export const EVIDENCE = '#ffc247'
export const GOOD = '#3ccb8a'
export const BAD = '#ff6464'

export interface TeamColors {
  base: string
  light: string
  deep: string
  // "r,g,b" for building rgba() strings.
  rgb: string
}

const CT: TeamColors = { base: '#62a9f5', light: '#a4ccff', deep: '#2a5b94', rgb: '98,169,245' }
const T: TeamColors = { base: '#efa63c', light: '#ffd089', deep: '#94600f', rgb: '239,166,60' }
const NONE: TeamColors = { base: '#8c96a1', light: '#c3cad2', deep: '#4a525b', rgb: '140,150,161' }

// teamColor takes a side (2 = T, 3 = CT).
export function teamColor(side: number): TeamColors {
  return side === 3 ? CT : side === 2 ? T : NONE
}

// Player colours by slot, close to the ones CS2 gives teammates.
export const SLOT_COLORS = ['#4fa6ff', '#3dc985', '#f0d43a', '#ff8a3d', '#b07cff', '#8c96a1']

export function slotColor(slot: number): string {
  return SLOT_COLORS[Math.max(0, slot - 1) % SLOT_COLORS.length]
}
