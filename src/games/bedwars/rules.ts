import { TEAMS, type TeamId } from './blocks'
import { RESPAWN_TICKS, TPS } from './constants'

/** How well bots play; `BOT_PROFILES` in bots.ts says what each level changes. */
export type BotLevel = 'easy' | 'normal' | 'hard' | 'expert'
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'expert']

export type TimelineKind = 'diamond-2' | 'emerald-2' | 'diamond-3' | 'emerald-3' | 'beds-gone' | 'game-end'

export interface TimelineEvent {
  /** Ticks after the round starts. */
  at: number
  kind: TimelineKind
  label: string
}

export interface GameRules {
  mode: 'arena' | 'sandbox'
  teams: TeamId[]
  teamSize: number
  /** Humans needed before the countdown starts on its own. */
  minPlayers: number
  countdownTicks: number
  /** Fill empty seats with bots when the round starts. */
  bots: boolean
  /** The level bots start at; the lobby host can change it. */
  botLevel: BotLevel
  respawnTicks: number
  /** How long the end screen shows before everyone returns to the lobby. */
  endTicks: number
  timeline: TimelineEvent[]
  /** Chat commands such as /give and /tp. */
  cheats: boolean
  /** Arena layouts players can vote for in the lobby; the first is the default. */
  maps: string[]
}

const min = 60 * TPS

export const TIMELINE: TimelineEvent[] = [
  { at: 5 * min, kind: 'diamond-2', label: 'Diamond II' },
  { at: 10 * min, kind: 'emerald-2', label: 'Emerald II' },
  { at: 15 * min, kind: 'diamond-3', label: 'Diamond III' },
  { at: 20 * min, kind: 'emerald-3', label: 'Emerald III' },
  { at: 25 * min, kind: 'beds-gone', label: 'Beds destroyed' },
  { at: 35 * min, kind: 'game-end', label: 'Game end' },
]

export function arenaRules(overrides: Partial<GameRules> = {}): GameRules {
  return {
    mode: 'arena',
    teams: [...TEAMS],
    teamSize: 1,
    minPlayers: 2,
    countdownTicks: 10 * TPS,
    bots: true,
    botLevel: 'normal',
    respawnTicks: RESPAWN_TICKS,
    endTicks: 10 * TPS,
    timeline: TIMELINE,
    cheats: false,
    maps: ['skyreach', 'lanterns', 'dunes', 'frostpeak', 'ruins'],
    ...overrides,
  }
}

export function sandboxRules(overrides: Partial<GameRules> = {}): GameRules {
  return arenaRules({ mode: 'sandbox', bots: false, minPlayers: 1, respawnTicks: 2 * TPS, timeline: [], cheats: true, ...overrides })
}

/** The same timeline, faster, for trying the round flow without waiting half an hour. */
export function scaleTimeline(timeline: TimelineEvent[], factor: number): TimelineEvent[] {
  return timeline.map((e) => ({ ...e, at: Math.round(e.at / factor) }))
}

export type GeneratorKind = 'iron' | 'gold' | 'diamond' | 'emerald'

/** Ticks between drops. Forge levels speed up iron and gold and add emeralds from level 3. */
export const GENERATOR_INTERVAL: Record<GeneratorKind, number[]> = {
  iron: [24, 16, 12, 12, 8],
  gold: [120, 80, 60, 60, 40],
  diamond: [30 * TPS, 23 * TPS, 15 * TPS],
  emerald: [65 * TPS, 50 * TPS, 35 * TPS],
}
export const FORGE_EMERALD_INTERVAL = [Infinity, Infinity, Infinity, 75 * TPS, 50 * TPS]
/** Most drops a generator lets pile up before it pauses. */
export const GENERATOR_CAP: Record<GeneratorKind, number> = { iron: 48, gold: 12, diamond: 4, emerald: 2 }

/** Health regained naturally: one point every this many ticks once out of combat. */
export const REGEN_INTERVAL = 4 * TPS
export const REGEN_DELAY = 5 * TPS
export const HEAL_POOL_INTERVAL = 2 * TPS
/** Horizontal distance from a base centre that counts as "at base" for the heal pool. */
export const BASE_RADIUS = 12
