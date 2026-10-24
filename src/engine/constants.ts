/** The simulation runs at a fixed rate; everything below is per tick unless it says otherwise. */
export const TPS = 20
export const TICK_MS = 1000 / TPS

// Tuned to be forgiving: faster than the genre's classic feel, higher and
// longer jumps, and strong air control, so moving and bridging are easy.
export const GRAVITY = 0.08
export const AIR_DRAG = 0.98
/** About 1.6 blocks high: over one block with room to spare, never two. */
export const JUMP_VELOCITY = 0.48
export const SPRINT_JUMP_BOOST = 0.28
/** Ticks after walking off an edge during which a jump still works. */
export const COYOTE_TICKS = 3

export const WALK_SPEED = 0.26
export const SPRINT_MULTIPLIER = 1.35
export const SNEAK_MULTIPLIER = 0.3
export const SHIELD_MULTIPLIER = 0.35
/** Ground velocity keeps this fraction each tick; the rest is replaced by the wanted velocity. */
export const GROUND_FRICTION = 0.546
export const AIR_FRICTION = 0.91
export const AIR_ACCEL = 0.03
export const AIR_ACCEL_SPRINT = 0.036
/** How far below the hitbox sneaking looks for ground before refusing a step. */
export const SNEAK_EDGE_PROBE = 0.6

export const PLAYER_WIDTH = 0.6
export const PLAYER_HEIGHT = 1.8
export const SNEAK_HEIGHT = 1.5
export const EYE_HEIGHT = 1.62
export const SNEAK_EYE_HEIGHT = 1.27

export const BLOCK_REACH = 5
export const ATTACK_REACH = 3
/** The server accepts a little more than the client uses, for latency and interpolation. */
export const REACH_SLACK = 1

export const SAFE_FALL = 4

export const PICKUP_RADIUS = 1.6
export const DROP_GRAVITY = 0.04
