import { TEAMS, type TeamId } from '../blocks'

export const ARENA_SIZE = 128
export const ARENA_HEIGHT = 80
/** Players stand at this height on every island. */
export const TOP = 40
export const MID = ARENA_SIZE / 2

export type ThemeId = 'forest' | 'village' | 'desert' | 'frost' | 'ruins'

/**
 * Where things go on an arena, as offsets from the middle, and how it looks.
 * `out` is the axis-aligned direction a base's back faces: the forge is
 * behind the spawn and the bed in front, toward the middle.
 */
export interface ArenaLayout {
  id: string
  name: string
  theme: ThemeId
  bases: Record<TeamId, { at: [number, number]; out: [number, number] }>
  diamonds: [number, number][]
  /** Half-size of the middle island. */
  middle: number
  /** Seed for the terrain and decoration noise. */
  seed: number
  /** Sky colour hint for the client. */
  sky: string
}

/**
 * A base in its own frame: `u` from the back (forge, u = -5) through the
 * spawn (-2) to the bed (3 and 4) and out toward the middle; `v` across,
 * with the shop at (-1, 4) and the upgrades keeper at (-1, -4).
 */
export const BASE = {
  spawn: -2,
  forge: -5,
  bed: 3,
  shop: [-1, 4] as const,
  upgrades: [-1, -4] as const,
  /** Where a bot stands to cover its bed: 2.5 behind the foot's centre. */
  stand: 0.5,
  /** The paved yard and the open lanes through it. */
  spine: 2,
  door: [-3, 2] as const,
}

export interface BasePlan {
  team: TeamId
  cx: number
  cz: number
  out: [number, number]
  /** World x/z of a frame cell. */
  at(u: number, v: number): [number, number]
}

export function basePlan(layout: ArenaLayout, team: TeamId): BasePlan {
  const { at, out } = layout.bases[team]
  const cx = MID + at[0]
  const cz = MID + at[1]
  const [ox, oz] = out
  return { team, cx, cz, out, at: (u, v) => [cx - u * ox - v * oz, cz - u * oz + v * ox] }
}

/** An inclusive rectangle of cells on the walking level: [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number]

/**
 * The bridging lanes between bases, three blocks wide. They follow the route
 * a bot takes from where it covers its bed to each enemy bed (and spawn, once
 * the bed is gone): out along its own base axis when the base sits on the
 * middle's cross, else along x first, then one turn (see `leave()` in
 * bots.ts). Nothing may stand in them, since nobody can dig map blocks.
 */
export function walkways(layout: ArenaLayout): Rect[] {
  const rects: Rect[] = []
  const lane = (ax: number, az: number, bx: number, bz: number) => {
    // Points are cell centres (k + 0.5); a lane is the cell row under them and one either side.
    const [x0, x1] = [Math.floor(Math.min(ax, bx)), Math.floor(Math.max(ax, bx))]
    const [z0, z1] = [Math.floor(Math.min(az, bz)), Math.floor(Math.max(az, bz))]
    rects.push(ax === bx ? [x0 - 1, z0, x1 + 1, z1] : [x0, z0 - 1, x1, z1 + 1])
  }
  for (const a of TEAMS) {
    const own = basePlan(layout, a)
    const [fx, fz] = own.at(BASE.bed, 0)
    const [hx, hz] = [-own.out[0], -own.out[1]]
    const stand = [fx + 0.5 - hx * 2.5, fz + 0.5 - hz * 2.5]
    // A bot stops within half a block of the stand, so it may start from either neighbouring cell.
    const starts = new Set<string>()
    for (const sx of [stand[0] - 0.49, stand[0] + 0.49]) for (const sz of [stand[1] - 0.49, stand[1] + 0.49]) starts.add(`${Math.floor(sx) + 0.5},${Math.floor(sz) + 0.5}`)
    const alongZ = Math.abs(own.cx + 0.5 - MID) < 1
    for (const t of TEAMS) {
      if (t === a) continue
      const target = basePlan(layout, t)
      const [tfx, tfz] = target.at(BASE.bed, 0)
      const [sx, sz] = target.at(BASE.spawn, 0)
      const goals = [
        [tfx + 0.5 + target.out[0] * 2, tfz + 0.5 + target.out[1] * 2],
        [sx + 0.5, sz + 0.5],
      ]
      for (const s of starts) {
        const [px, pz] = s.split(',').map(Number)
        for (const [gx, gz] of goals) {
          const [cx, cz] = alongZ ? [px, gz] : [gx, pz]
          lane(px, pz, cx, cz)
          lane(cx, cz, gx, gz)
        }
      }
    }
  }
  return rects
}

/** Whether the bases sit on the middle's cross (lanes run through the middle) or in the corners. */
export function onCross(layout: ArenaLayout): boolean {
  return TEAMS.every((t) => layout.bases[t].at[0] === 0 || layout.bases[t].at[1] === 0)
}
