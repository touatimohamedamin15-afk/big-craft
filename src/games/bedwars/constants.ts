export * from '../../engine/constants'
import { TPS } from '../../engine/constants'

/** The product name shown in the window title, menus and chat. Change it once here. */
export const BRAND = 'Buffcraft'

export const MAX_HEALTH = 20
/** Ticks a player cannot be hurt again after a hit. */
export const HURT_TICKS = 10
/** A death within this many ticks of a hit is credited to the attacker (void knocks). */
export const KILL_CREDIT_TICKS = 10 * TPS
export const SPAWN_PROTECTION_TICKS = 3 * TPS
export const RESPAWN_TICKS = 5 * TPS
