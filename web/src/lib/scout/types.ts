// Scouting: heatmaps and habits of a group of players over several
// matches, grouped by map.

import type { MapInfo } from '../types'

export type Vec3 = [number, number, number]

export interface RosterPlayer {
  steamId: string
  name: string
}

export interface ScoutOptions {
  // Seconds after freeze time that count as the early CT setup.
  earlyCtSeconds: number
  // Seconds before the T side hit a site that show how they got there.
  preHitSeconds: number
  // Seconds before the hit in which thrown utility counts for the execute.
  utilitySeconds: number
  // Seconds after freeze time that count as the early T map control.
  earlyTSeconds?: number
  // A T site hit this many seconds after freeze time or sooner is a rush.
  rushSeconds: number
  // Seconds after freeze time where the CT setup is read, for stacks and
  // roles.
  setupSeconds: number
  // Length of the round tracks in seconds, and the time between samples.
  trackSeconds: number
  trackStep: number
}

export const DEFAULT_SCOUT_OPTIONS: ScoutOptions = {
  earlyCtSeconds: 20,
  preHitSeconds: 12,
  utilitySeconds: 20,
  earlyTSeconds: 25,
  rushSeconds: 25,
  setupSeconds: 15,
  trackSeconds: 30,
  trackStep: 0.125,
}

// HeatGrid is radar space (1024x1024) binned into size x size cells, one
// grid per map floor.
export interface HeatGrid {
  size: number
  levels: Float32Array[]
  samples: number
}

// PlaceShare is a callout with the share of rounds (or time) a player was
// there.
export interface PlaceShare {
  place: string
  share: number
}

// KillMark is a kill one of the roster players was part of, as the killer
// (in kills) or the victim (in deaths). side is the roster player's side.
export interface KillMark {
  killer: Vec3
  victim: Vec3
  side: number
  weapon: number
  headshot: boolean
  opening: boolean
  // Pretty place of the roster player.
  place: string
  player: string
}

export interface PlayerScout {
  steamId: string
  name: string
  ctRounds: number
  tRounds: number
  ct: HeatGrid
  t: HeatGrid
  ctEarly: HeatGrid
  tEarly: HeatGrid
  // Where they were at the early CT moment and when the T side hit a site.
  ctPlaces: PlaceShare[]
  tPlaces: PlaceShare[]
  // Where they were at the early T moment.
  tEarlyPlaces: PlaceShare[]
  kills: KillMark[]
  deaths: KillMark[]
  // Seconds alive with the AWP in hand, per side.
  awp: { ct: number; t: number }
}

// UtilityMark is a grenade by its equipment id (504 flash, 505 smoke, 506
// HE, 502/503 fire, 501 decoy) and where it went off. from is where it was
// thrown, when known.
export interface UtilityMark {
  type: number
  pos: Vec3
  player: string
  from?: Vec3
}

export interface SiteExecute {
  site: string
  rounds: number
  share: number
  avgHitTime: number
  positions: HeatGrid
  utility: UtilityMark[]
  plants: Vec3[]
}

export interface CtSetup {
  places: string[]
  count: number
}

// RoundSplit is a part of a SideHeat, for example eco rounds inside the
// eco and force rounds.
export interface RoundSplit {
  label: string
  rounds: number
  won: number
}

// SideHeat is the team's positions in some of its rounds on one side.
export interface SideHeat {
  rounds: number
  won: number
  heat: HeatGrid
  // Share of the time spent per place.
  places: PlaceShare[]
  splits: RoundSplit[]
}

// OpeningDuel is the first kill of a round with the roster's team in it.
export interface OpeningDuel {
  side: number
  won: boolean
  killer: Vec3
  victim: Vec3
  // The roster player in the duel and where they were.
  player: string
  place: string
  weapon: number
  time: number
}

// PlantScout is the team after a plant on one site: T holding the post
// plant, or CT going for the retake.
export interface PlantScout {
  site: string
  rounds: number
  won: number
  heat: HeatGrid
  plants: Vec3[]
  places: PlaceShare[]
}

export interface ScoutReplay {
  id: string
  name: string
  rounds: number
  // From the roster's side: won the match, and the score like "13-6".
  won: boolean | null
  score: string
  opponent: string
  // Unix seconds when the match was played, 0 when not known.
  date: number
}

// BuyKind is the roster's buy in a round. antieco is a full buy while the
// other team is on an eco or a force buy.
export type BuyKind = 'pistol' | 'eco' | 'force' | 'full' | 'antieco'

// Zone is the part of the map a position belongs to.
export type Zone = 'A' | 'B' | 'mid' | 'other'

// TrackPlayer is one roster player in a round, in radar space (0 to 1024),
// one sample per track step. After death alive is 0 and the position stays
// where they died. color is the same for the player in every round.
export interface TrackPlayer {
  steamId: string
  name: string
  color: string
  xs: Float32Array
  ys: Float32Array
  zs: Float32Array
  // Where they look, in degrees like the game: 0 is +x, 90 is +y.
  yaw: Float32Array
  alive: Uint8Array
}

// TrackEvent is something that happened in a track, t seconds after
// freeze time, in radar space (z stays in world units). until is when a
// smoke or fire ends, from is where a grenade was thrown or where the
// killer stood.
export interface TrackEvent {
  t: number
  kind: 'smoke' | 'flash' | 'he' | 'fire' | 'decoy' | 'kill' | 'death' | 'plant'
  x: number
  y: number
  z: number
  player: string
  until?: number
  from?: [number, number]
}

// SituationTrack is the start of one round, like "Match 2, round 13".
// hit is the site the T side went for, '' when none, with hitTime in
// seconds after freeze time (-1 when none).
export interface SituationTrack {
  replayId: string
  round: number
  label: string
  won: boolean
  hit: string
  hitTime: number
  players: TrackPlayer[]
  events: TrackEvent[]
}

// Situation is every round of one side and buy, like T pistol rounds.
// MapScout.situations has one per side and buy with at least one round,
// ordered pistol, eco, force, antieco, full, CT before T.
export interface Situation {
  // Like "t-pistol" or "ct-antieco".
  key: string
  side: 'ct' | 't'
  buy: BuyKind
  title: string
  rounds: number
  won: number
  // T: rounds with a site hit within rushSeconds.
  rushes: number
  // T: the site they went for, with the average time to get there.
  hits: { site: string; rounds: number; avgTime: number }[]
  // T: rounds without a site hit or a plant.
  noHit: number
  // CT: rounds with 3 or more players in one site zone at setupSeconds.
  stacks: { site: string; rounds: number }[]
  // CT: rounds where a player took a fight or stood in T territory early.
  pushes: number
  // Lost rounds where 2 or more players stayed alive away from the bomb
  // and the enemies.
  saves: number
  // Roster positions in the first 10 and 20 seconds.
  heat10: HeatGrid
  heat20: HeatGrid
  // One per round, from freeze time to trackSeconds after.
  tracks: SituationTrack[]
  // Patterns in plain words, strongest first.
  notes: string[]
}

// RoleCard is what one player does per side, shares are 0 to 1.
// CT: zone and place are where they stood most at setupSeconds, with the
// share of their CT rounds; rotates is the number of rounds they went to
// the other site before their first fight or the plant; awp is the share
// of CT rounds with the AWP. Labels: "A anchor", "B anchor", "AWP",
// "Rotator", "Mid", a place like "Outside" for a fixed spot elsewhere, or
// "Flex".
// T: entry and lurk are shares of their T rounds with a site hit, support
// is their share of the team's utility before hits, awp the share of T
// rounds with the AWP. Labels: "Entry", "Lurker", "Support", "AWP" or
// "Flex".
// A side they never played has rounds 0 and label ''. confidence goes by
// the rounds behind the card: under 6 low, under 12 medium, else high,
// counting the weaker side when they played both.
export interface RoleCard {
  steamId: string
  name: string
  color: string
  ct: { rounds: number; zone: Zone; zoneShare: number; place: string; placeShare: number; rotates: number; awp: number; label: string }
  t: { rounds: number; entry: number; lurk: number; support: number; awp: number; label: string }
  confidence: 'low' | 'medium' | 'high'
  notes: string[]
}

export interface MapScout {
  map: string
  info: MapInfo
  replays: ScoutReplay[]
  ctRounds: number
  tRounds: number
  won: { ct: number; t: number }
  team: { ct: HeatGrid; t: HeatGrid }
  players: PlayerScout[]
  executes: SiteExecute[]
  // T rounds without a site hit or a plant.
  noHit: number
  ctSetups: CtSetup[]
  pistol: { ct: SideHeat; t: SideHeat }
  // Eco and force buys.
  eco: { ct: SideHeat; t: SideHeat }
  // Positions while holding the AWP.
  awp: { ct: SideHeat; t: SideHeat }
  utility: { ct: UtilityMark[]; t: UtilityMark[] }
  openings: OpeningDuel[]
  postPlant: PlantScout[]
  retake: PlantScout[]
  situations: Situation[]
  roles: RoleCard[]
  // The most useful notes from the situations and roles, best first.
  tendencies: string[]
}
