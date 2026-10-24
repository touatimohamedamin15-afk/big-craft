import { TICK_MS } from '../constants'

/**
 * Maps server ticks to local time, so remote players are drawn on the server's
 * timeline a little in the past rather than whenever packets happen to land.
 * The offset is a running average of when ticks arrive (the server sends some
 * in bursts while catching up, so the earliest arrival is not a safe anchor),
 * and the render delay grows with how far arrivals stray from it, so a jittery
 * link stays smooth and a clean one stays responsive.
 */
export class ServerClock {
  private offset: number | null = null
  private deviation = 0

  observe(tick: number, now: number): void {
    const o = now - tick * TICK_MS
    if (this.offset === null) {
      this.offset = o
      return
    }
    const off = o - this.offset
    // A big jump (a stall, a tab in the background) resets rather than drags the average.
    if (Math.abs(off) > 1000) {
      this.offset = o
      this.deviation = 0
      return
    }
    this.offset += off * 0.05
    this.deviation += (Math.abs(off) - this.deviation) * 0.05
  }

  /** The (fractional) server tick to draw others at: two ticks behind a typical arrival, plus up to four for jitter. */
  renderTick(now: number): number {
    if (this.offset === null) return 0
    const delay = 2 + Math.min(4, (this.deviation * 2) / TICK_MS)
    return (now - this.offset) / TICK_MS - delay
  }
}
