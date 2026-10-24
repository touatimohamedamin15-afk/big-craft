/**
 * Server-side lag compensation, after Voxelize's lag_comp.rs (MIT, (c) 2022
 * Shaoru Ian Huang): keep a short ring of every player's pose per tick so an
 * attack can be judged against where the target was when the attacker saw
 * it, not where it has moved since. The client's claim is clamped to a few
 * ticks back, so a forged value can never reach further into the past.
 */

export interface Pose {
  x: number
  y: number
  z: number
  sneaking: boolean
}

/** 500 ms at 20 TPS: the client's jitter buffer (up to 300 ms) plus a long one-way latency. */
export const MAX_REWIND_TICKS = 10
const RING = 16

export class PositionHistory {
  private rings = new Map<number, { tick: number; pose: Pose }[]>()

  record(id: number, tick: number, pose: Pose): void {
    let ring = this.rings.get(id)
    if (!ring) this.rings.set(id, (ring = []))
    ring.push({ tick, pose: { ...pose } })
    if (ring.length > RING) ring.shift()
  }

  /** The pose at the latest recorded tick at or before `tick`, if any. */
  at(id: number, tick: number): Pose | undefined {
    const ring = this.rings.get(id)
    if (!ring) return undefined
    for (let i = ring.length - 1; i >= 0; i--) if (ring[i].tick <= tick) return ring[i].pose
    return ring[0]?.pose
  }

  forget(id: number): void {
    this.rings.delete(id)
  }
}

/** The tick to judge against: what the client says it saw, clamped to [now - max, now]. */
export function rewindTick(now: number, seen: number | undefined, max = MAX_REWIND_TICKS): number {
  if (seen === undefined || !Number.isFinite(seen)) return now
  return Math.max(now - max, Math.min(now, Math.floor(seen)))
}
