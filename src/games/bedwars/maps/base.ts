import { DARK_PLANKS, PLANKS, POLE, SNOW, ICE, STAINED_GLASS, WHITE_WOOL, WOOL, type TeamId } from '../blocks'
import { layeredIsland, type IslandStrata } from '../../../engine/terrain'
import { BASE } from './plan'
import type { Frame, Mat } from './builder'
import type { Random } from './parts'

export type RoofKind = 'gable' | 'snowy' | 'flat' | 'ruined'

/** The materials one theme builds its bases from. */
export interface BaseStyle {
  /** Yard paving, its border and the paths along the lanes. */
  floor: Mat
  trim: Mat
  path: Mat
  foundation: Mat
  wall: Mat
  pillar: Mat
  beam: Mat
  roof: Mat
  ridge: Mat
  roofKind: RoofKind
  lamp: number
  /** Under the forge, with `forgeCore` (a lamp, so the generator glows) in the middle. */
  forgePad: Mat
  forgeCore: number
  spawnPad: Mat
  /** One-block-high yard clutter: crates, hay, planters. */
  clutter: Mat[]
}

/*
 * Bots cannot dig map blocks and walk in straight, axis-aligned legs from
 * wherever a fight leaves them, so a solid block at body height that faces
 * open floor would stop one for good. Bases keep every walkable cell clear
 * at body height: the house stands on the island's back rim (and, on
 * corner arenas, its outer side), where no route leads; the yard holds only
 * floor-level detail, one-high clutter anyone can hop, and overhead roofs
 * on non-solid poles. The frame's u axis points toward the middle.
 */

/** The yard runs from u = -7 (the back row) forward; the house is behind it. */
const BACK = -7
/** The house's front wall and the half-width of the open gap ("sky gate") behind the forge. */
const FACADE = -8
const GATE = 2

/**
 * Reserves the walks inside a base before anything is built: the spine from
 * the back row out through the bed's tent, the side doors (only the inner
 * one on a corner arena), and the straight lines bots walk between forge,
 * spawn, shopkeepers and the bed.
 */
export function reserveBase(f: Frame, corner: boolean): void {
  const s = BASE.spine
  f.reserve(BACK, 0, -s, 20, 2, s)
  f.reserve(BASE.door[0], 0, corner ? -2 : -14, BASE.door[1], 2, 14)
  const forge = [BASE.forge, 0] as const
  const spawn = [BASE.spawn, 0] as const
  const stand = [BASE.stand, 0] as const
  for (const npc of [BASE.shop, BASE.upgrades]) for (const from of [forge, spawn, stand]) f.reserveWalk(from, npc, 1.1)
}

/**
 * A base: a two-winged house along the back with team-glass windows, a
 * jettied upper floor, banners and a gable (or theme) roof, joined over an
 * open sky gate behind the forge; on corner arenas a side wing closes the
 * outer side. In front, a paved yard: the forge between lamp posts with
 * lamps set in its pad, the spawn ringed in team wool, striped awnings over
 * the shopkeepers, and the bed under a team-coloured tent, open at the
 * front and back.
 */
export function buildBase(f: Frame, team: TeamId, s: BaseStyle, strata: IslandStrata, corner: boolean, seed: number, rnd: Random): void {
  const wool = WOOL[team]
  const onIsland = (u: number, v: number) => f.solid(u, -1, v)

  // Ground for the house: two wing foundations behind the yard (and a side wing's), the sky gate left open.
  const wings: [number, number, number, number][] = [[-11, FACADE, GATE + 1, 9], [-11, FACADE, -9, -GATE - 1]]
  if (corner) wings.push([-11, 2, -12, -10])
  for (const [i, [u0, u1, v0, v1]] of wings.entries()) {
    const [x0, z0] = [f.x(u0, v0), f.z(u0, v0)]
    const [x1, z1] = [f.x(u1, v1), f.z(u1, v1)]
    layeredIsland(f.b.world, strata, { cx: (x0 + x1) / 2 + 0.5, cz: (z0 + z1) / 2 + 0.5, rx: Math.abs(x1 - x0) / 2, rz: Math.abs(z1 - z0) / 2, top: f.top, depth: 7, seed: seed + i, squareness: 8 })
  }
  // Nothing walkable behind the yard but the house itself.
  for (let u = -14; u < BACK; u++) for (let v = -14; v <= 14; v++) if (!wings.some(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1)) for (let h = -12; h <= 0; h++) f.set(u, h, v, 0)

  // Paving: the yard, a cross of paths along the lanes, lamps set in the floor along the spine.
  for (let u = BACK; u <= 10; u++)
    for (let v = -10; v <= 10; v++) {
      if (!onIsland(u, v)) continue
      const yard = u <= 2 && Math.abs(v) <= 7
      const lane = Math.abs(v) <= 1 || (u >= BASE.door[0] && u <= BASE.door[1] && Math.abs(v) <= 7)
      if (yard) f.set(u, -1, v, Math.abs(v) === 7 ? s.trim : lane ? s.path : s.floor)
      else if (Math.abs(v) <= 1) f.set(u, -1, v, s.path)
      else if (Math.abs(v) <= 4 && u <= 7) f.set(u, -1, v, s.floor)
    }
  for (const u of [-1, 2, 5, 8]) for (const side of [-1, 1]) if (onIsland(u, 2 * side)) f.set(u, -1, 2 * side, s.lamp)
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) f.set(BASE.spawn + du, -1, dv, du || dv ? wool : s.spawnPad)
  for (let du = -2; du <= 2; du++)
    for (let dv = -2; dv <= 2; dv++) {
      const m = Math.max(Math.abs(du), Math.abs(dv))
      f.set(BASE.forge + du, -1, dv, m === 0 ? s.forgeCore : m === 2 && (du + dv) % 2 === 0 ? s.lamp : s.forgePad)
    }

  // The house.
  for (const [u0, u1, v0, v1] of wings.slice(0, 2)) wing(f, u0, u1, v0, v1, s, team, rnd)
  if (corner) sideWing(f, s, team)
  // The roof and upper floor carry on over the sky gate as a bridge, a lamp hanging from its middle.
  f.fill(-11, 4, -GATE, FACADE + 1, 4, GATE, s.beam)
  f.fill(-11, 5, -GATE, FACADE + 1, 6, GATE, s.wall)
  for (let v = -GATE; v <= GATE; v++) f.set(FACADE + 1, 5, v, v === 0 ? wool : STAINED_GLASS[team])
  f.set(FACADE + 1, 3, 0, s.lamp)
  roof(f, -11, FACADE + 1, -9, 9, s)

  // Lamp posts by the forge.
  for (const side of [-1, 1]) post(f, BASE.forge - 1, 2 * side, s.lamp)

  // The bed's tent: a striped roof on four poles, open front and back, valances hanging at the sides.
  for (const u of [3, 7]) for (const side of [-1, 1]) for (let h = 0; h <= 3; h++) f.set(u, h, 3 * side, POLE)
  for (let u = 2; u <= 8; u++)
    for (let v = -4; v <= 4; v++) {
      f.set(u, 4, v, Math.abs(v) % 2 === 1 ? WHITE_WOOL : wool)
      if (Math.abs(v) === 4) f.set(u, 3, v, wool)
    }
  f.fill(3, 5, -2, 7, 5, 2, wool)
  f.fill(4, 6, -1, 6, 6, 1, wool)
  for (const side of [-1, 1]) f.set(8, 2, 4 * side, wool)

  // Awnings over the shopkeepers on two back poles, a lamp on top.
  for (const side of [-1, 1]) {
    for (const v of [4, 6]) for (let h = 0; h <= 2; h++) f.set(-4, h, v * side, POLE)
    for (let u = -4; u <= 0; u++) for (let v = 4; v <= 6; v++) f.set(u, 3, v * side, (u + v) % 2 ? WHITE_WOOL : wool)
    f.set(-4, 4, 5 * side, s.lamp)
  }

  // Yard clutter, one block high, wherever it leaves room to hop over.
  for (const side of corner ? [1] : [-1, 1])
    for (const [u, v] of [[-6, 5], [-6, 6], [-5, 6], [1, 6], [-6, -5]] as const) if (rnd() < 0.8) f.b.bump(f.x(u, v * side), f.top, f.z(u, v * side), s.clutter[Math.floor(rnd() * s.clutter.length)])
}

/** A lamp on a non-solid pole, three high so it hangs over people's heads. */
function post(f: Frame, u: number, v: number, lamp: number): void {
  if (!f.solid(u, -1, v) || f.reserved(u, 0, v)) return
  for (let h = 0; h <= 2; h++) f.set(u, h, v, POLE)
  f.set(u, 3, v, lamp)
}

/**
 * One wing of the house, its front wall at `u1` facing the yard: a stone
 * foot, two floors (the upper one jutting out over the yard), team-glass
 * windows, a painted door, a team-wool band and banners under the jetty.
 */
function wing(f: Frame, u0: number, u1: number, v0: number, v1: number, s: BaseStyle, team: TeamId, rnd: Random): void {
  const glass = STAINED_GLASS[team]
  const wool = WOOL[team]
  const ruined = s.roofKind === 'ruined'
  const top = (v: number) => (ruined ? 3 + Math.floor(rnd() * 4) + (Math.abs(v) % 3 === 0 ? 1 : 0) : 6)
  for (let v = v0; v <= v1; v++) {
    const high = top(v)
    for (let u = u0; u <= u1 + 1; u++) {
      for (let h = 0; h <= high; h++) {
        if (h < 4 && u > u1) continue
        const edge = u === u0 || u === (h < 4 ? u1 : u1 + 1) || v === v0 || v === v1
        if (!edge) continue
        const corner = (u === u0 || u === u1 || u === u1 + 1) && (v === v0 || v === v1)
        let m: Mat = h === 0 ? s.foundation : h === 4 ? s.beam : corner ? s.pillar : s.wall
        const front = u === (h < 4 ? u1 : u1 + 1) && !corner
        if (front) {
          const bay = v - v0
          if (h === 3) m = wool
          else if ((h === 1 || h === 2) && (bay === 1 || bay === 5)) m = glass
          else if (h === 5 && bay % 2 === 1) m = glass
        }
        f.set(u, h, v, m)
      }
    }
  }
  // A plank floor and a lamp inside, so the windows glow.
  f.fill(u0 + 1, -1, v0 + 1, u1 - 1, -1, v1 - 1, PLANKS)
  f.fill(u0 + 1, 0, v0 + 1, u1 - 1, 3, v1 - 1, 0)
  f.set(u0 + 2, 2, (v0 + v1) >> 1, s.lamp)
  // A door, lanterns either side of it and banners hanging from the jetty.
  const door = v0 + 3
  f.set(u1, 0, door, DARK_PLANKS)
  f.set(u1, 1, door, DARK_PLANKS)
  for (const dv of [-1, 1]) f.set(u1, 2, door + dv, s.lamp)
  for (const v of [v0 + 1, v1 - 1]) {
    f.set(u1 + 1, 3, v, wool)
    f.set(u1 + 1, 2, v, wool)
  }
}

/** The outer side wing of a corner base, its wall facing the yard (+v). */
function sideWing(f: Frame, s: BaseStyle, team: TeamId): void {
  const glass = STAINED_GLASS[team]
  const [u0, u1, v0, v1] = [-11, 2, -12, -10]
  for (let u = u0; u <= u1; u++)
    for (let v = v0; v <= v1; v++)
      for (let h = 0; h <= 4; h++) {
        const edge = u === u0 || u === u1 || v === v0 || v === v1
        if (!edge) continue
        const corner = (u === u0 || u === u1) && (v === v0 || v === v1)
        const front = v === v1 && !corner
        f.set(u, h, v, h === 0 ? s.foundation : h === 4 ? s.beam : corner ? s.pillar : front && (h === 1 || h === 2) && u % 3 === 0 ? glass : front && h === 3 ? WOOL[team] : s.wall)
      }
  for (let u = u0; u <= u1; u++) for (let v = v0 - 1; v <= v1 + 1; v++) f.set(u, 5, v, Math.abs(v - (v0 + 1)) === 0 ? s.ridge : s.roof)
  for (let u = u0; u <= u1; u += 4) f.set(u, 3, v1 + 1, s.lamp)
}

/** A roof over a block whose front is at `u1`: gable, snowy gable, flat with parapet and dome, or none (ruins). */
function roof(f: Frame, u0: number, u1: number, v0: number, v1: number, s: BaseStyle): void {
  const base = 7
  if (s.roofKind === 'ruined') return
  if (s.roofKind === 'flat') {
    f.fill(u0, base, v0, u1, base, v1, s.roof)
    for (let u = u0; u <= u1; u++) for (const v of [v0, v1]) if ((u + v) % 2 === 0) f.set(u, base + 1, v, s.ridge)
    for (let v = v0; v <= v1; v++) for (const u of [u0, u1]) if ((u + v) % 2 === 0) f.set(u, base + 1, v, s.ridge)
    const mid = Math.round((v0 + v1) / 2)
    const um = Math.round((u0 + u1) / 2)
    f.fill(um - 1, base + 1, mid - 1, um + 1, base + 1, mid + 1, s.ridge)
    f.set(um, base + 2, mid, s.ridge)
    return
  }
  // Stepped slopes front and back, the gable ends set back under the overhang.
  for (let k = 0; ; k++) {
    const a = u0 - 1 + k
    const b = u1 + 1 - k
    if (a > b) break
    for (let u = a; u <= b; u++)
      for (let v = v0 - 1; v <= v1 + 1; v++) {
        const slope = u === a || u === b
        const end = v === v0 - 1 || v === v1 + 1
        f.set(u, base + k, v, a === b || a + 1 === b ? s.ridge : slope ? s.roof : end ? 0 : v === v0 || v === v1 ? s.wall : s.roof)
        if (s.roofKind === 'snowy' && slope) f.set(u, base + k, v, SNOW)
      }
  }
  if (s.roofKind === 'snowy') for (let v = v0 - 1; v <= v1 + 1; v += 2) f.set(u1 + 1, base - 1, v, ICE)
}
