// Mirrors the JSON written by the Go side (internal/match and internal/analysis).

export type Side = 0 | 2 | 3
export const SIDE_T = 2
export const SIDE_CT = 3

export interface Team {
  name: string
  score: number
  startSide: Side
}

export interface Player {
  index: number
  steamId: string
  name: string
  team: number
  isBot: boolean
}

export interface RoundPlayer {
  player: number
  side: Side
  money: number
  equipValue: number
  spent: number
  inventory: number[] | null
}

export interface Round {
  number: number
  startTick: number
  freezeEndTick: number
  endTick: number
  officialEndTick: number
  winner: Side
  winnerTeam: number
  reason: string
  sideOf: [Side, Side]
  scoreA: number
  scoreB: number
  players: RoundPlayer[] | null
  roundTime: number
  bombTime: number
}

export type Vec3 = [number, number, number]

export interface Kill {
  tick: number
  round: number
  killer: number
  victim: number
  assister: number
  weapon: number
  headshot: boolean
  wallbang: boolean
  throughSmoke: boolean
  noScope: boolean
  attackerBlind: boolean
  flashAssist: boolean
  killerSide: Side
  victimSide: Side
  killerPos: Vec3
  victimPos: Vec3
  victimUtility: number[] | null
  victimBlind: boolean
}

export interface Damage {
  tick: number
  round: number
  attacker: number
  victim: number
  weapon: number
  health: number
  armor: number
  hitGroup: number
  hpAfter: number
}

export interface Blind {
  tick: number
  round: number
  attacker: number
  victim: number
  duration: number
  grenade: number
}

export interface Grenade {
  id: number
  type: number
  thrower: number
  side: Side
  round: number
  throwTick: number
  effectTick: number
  endTick: number
  pos: Vec3
  pathStart: number
  pathLen: number
}

export interface FireSnapshot {
  tick: number
  hull: number[]
}

export interface Inferno {
  id: number
  thrower: number
  round: number
  startTick: number
  endTick: number
  snapshots: FireSnapshot[] | null
}

export interface BombEvent {
  tick: number
  round: number
  kind: string
  player: number
  site: string
  pos: Vec3
}

export interface Engagement {
  id: number
  round: number
  attacker: number
  victim: number
  weapon: number
  startTick: number
  endTick: number
  firstSeenTick: number
  firstShotTick: number
  firstHitTick: number
  killTick: number
  shots: number
  hits: number
  damage: number
  headshot: boolean
  killed: boolean
  died: boolean
  reactionMs: number
  timeToDamageMs: number
  crosshairErrorDeg: number
  flickDeg: number
  firstShotErrorDeg: number
  sampleStart: number
  sampleLen: number
}

export interface Match {
  map: string
  server: string
  tickRate: number
  sampleInterval: number
  firstTick: number
  lastTick: number
  teams: [Team, Team]
  players: Player[]
  rounds: Round[]
  kills: Kill[] | null
  damages: Damage[] | null
  blinds: Blind[] | null
  grenades: Grenade[] | null
  infernos: Inferno[] | null
  bombEvents: BombEvent[] | null
  weapons: Record<string, string>
  engagements: Engagement[] | null
}

export interface SideRecord {
  played: number
  won: number
}

export interface PlayerStats {
  player: number
  rounds: number
  kills: number
  deaths: number
  assists: number
  flashAssists: number
  headshots: number
  damage: number
  adr: number
  kast: number
  rating: number
  utilityDamage: number
  openingKills: number
  openingDeaths: number
  tradeKills: number
  tradedDeaths: number
  untradedDeaths: number
  isolatedDeaths: number
  earlyDeaths: number
  blindDeaths: number
  multiKills: Record<string, number>
  clutchesPlayed: number
  clutchesWon: number
  flashesThrown: number
  smokesThrown: number
  heThrown: number
  molotovsThrown: number
  decoysThrown: number
  enemiesFlashed: number
  enemyBlindTime: number
  teammatesFlashed: number
  teammateBlindTime: number
  selfFlashed: number
  deathsWithUtility: number
  unusedUtilityValue: number
  shotsFired: number
  shotsHit: number
  accuracy: number
}

export interface TeamStats {
  team: number
  sides: Record<string, SideRecord>
  pistol: SideRecord
  openingKills: number
  openingDeaths: number
  openingBySide: Record<string, SideRecord>
  deaths: number
  tradedDeaths: number
  tradeRate: number
  avgTeammateDistance: number
  advantageRounds: SideRecord
  disadvantageRounds: SideRecord
  buys: Record<string, SideRecord>
  antiEco: SideRecord
  plants: SideRecord
  retakes: SideRecord
  grenadesUsed: number
  utilPerRound: number
  teamFlashes: number
  teamBlindTime: number
  unusedUtility: number
  firstContact: number
}

export interface Clutch {
  player: number
  versus: number
  won: boolean
  tick: number
}

export interface RoundInfo {
  round: number
  buyType: [string, string]
  equipValue: [number, number]
  openingKill: number
  traded: number[] | null
  clutch?: Clutch
  planted: boolean
  site: string
  firstContact: number
}

export type Severity = 'high' | 'medium' | 'low' | 'positive'

export interface Moment {
  round: number
  tick: number
  player: number
  label: string
}

export interface Insight {
  id: string
  severity: Severity
  team: number
  player: number
  title: string
  detail: string
  tip?: string
  moments: Moment[]
}

export interface AimSummary {
  player: number
  engagements: number
  duelsWon: number
  duelsLost: number
  reactionMs: number
  crosshairErrorDeg: number
  firstShotErrorDeg: number
  timeToDamageMs: number
  prefires: number
  headshotRate: number
  duelAccuracy: number
  noShotDeaths: number
  reactionSamples: number
}

export interface Report {
  players: PlayerStats[]
  teams: [TeamStats, TeamStats]
  rounds: RoundInfo[]
  insights: Insight[]
  aim: AimSummary[]
  tradeWindow: number
}

export interface Column {
  type: 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32'
  offset: number
  length: number
}

export interface Header {
  version: number
  frames: number
  match: Match
  extra: { analysis: Report; parseMs: number }
  columns: Record<string, Column>
}

export interface MapLevel {
  name: string
  altitudeMin: number
  altitudeMax: number
  image: string
}

export interface MapInfo {
  name: string
  posX: number
  posY: number
  scale: number
  size: number
  levels: MapLevel[]
  known: boolean
}

export interface Entry {
  id: string
  name: string
  map: string
  teams: [{ name: string; score: number }, { name: string; score: number }]
  rounds: number
  players: string[]
  duration: number
  demoSize: number
  parseMs: number
  replaySize: number
  created: string
}

export interface Job {
  id: string
  name: string
  path?: string
  status: string
  progress: number
  error?: string
}

export interface LocalDemo {
  path: string
  name: string
  size: number
  modified: string
  id: string
  status: string
  progress: number
  error?: string
}
