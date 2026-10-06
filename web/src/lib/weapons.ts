// Equipment ids from the parser (demoinfocs EquipmentType).

export const EQ = {
  zeus: 401,
  bomb: 404,
  knife: 405,
  kit: 406,
  world: 407,
  decoy: 501,
  molotov: 502,
  incendiary: 503,
  flash: 504,
  smoke: 505,
  he: 506,
}

const short: Record<number, string> = {
  1: 'P2000', 2: 'Glock', 3: 'P250', 4: 'Deagle', 5: 'Five-SeveN', 6: 'Dualies', 7: 'Tec-9',
  8: 'CZ75', 9: 'USP-S', 10: 'R8',
  101: 'MP7', 102: 'MP9', 103: 'Bizon', 104: 'MAC-10', 105: 'UMP', 106: 'P90', 107: 'MP5',
  201: 'Sawed-Off', 202: 'Nova', 203: 'MAG-7', 204: 'XM1014', 205: 'M249', 206: 'Negev',
  301: 'Galil', 302: 'FAMAS', 303: 'AK-47', 304: 'M4A4', 305: 'M4A1-S', 306: 'Scout',
  307: 'SG 553', 308: 'AUG', 309: 'AWP', 310: 'SCAR-20', 311: 'G3SG1',
  401: 'Zeus', 404: 'C4', 405: 'Knife', 406: 'Kit', 407: 'World',
  501: 'Decoy', 502: 'Molotov', 503: 'Incendiary', 504: 'Flash', 505: 'Smoke', 506: 'HE',
}

export function weaponName(id: number): string {
  return short[id] ?? (id ? `#${id}` : '')
}

export function isGun(id: number): boolean {
  return id >= 1 && id < 400
}

export function isGrenade(id: number): boolean {
  return id >= 501 && id <= 506
}

export const NADE_COLOR: Record<number, string> = {
  [EQ.smoke]: '#c9d1d9',
  [EQ.flash]: '#fff4b0',
  [EQ.he]: '#ff6b5a',
  [EQ.molotov]: '#ff8a3d',
  [EQ.incendiary]: '#ff8a3d',
  [EQ.decoy]: '#8bd18b',
}

export const NADE_LABEL: Record<number, string> = {
  [EQ.smoke]: 'Smoke',
  [EQ.flash]: 'Flash',
  [EQ.he]: 'HE',
  [EQ.molotov]: 'Molotov',
  [EQ.incendiary]: 'Incendiary',
  [EQ.decoy]: 'Decoy',
}

export const REASON: Record<string, string> = {
  bomb_exploded: 'Bomb exploded',
  bomb_defused: 'Bomb defused',
  t_eliminated: 'Terrorists eliminated',
  ct_eliminated: 'CTs eliminated',
  time_ran_out: 'Time ran out',
  draw: 'Draw',
  t_surrender: 'T surrendered',
  ct_surrender: 'CT surrendered',
  unfinished: 'Not finished',
  other: 'Round over',
}
