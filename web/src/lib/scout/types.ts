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
}

export const DEFAULT_SCOUT_OPTIONS: ScoutOptions = { earlyCtSeconds: 20, preHitSeconds: 12, utilitySeconds: 20, earlyTSeconds: 25 }

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
}
