import { BEDROCK, CLAY, GLASS, GRASS, MOONSTONE, OBSIDIAN, PLANKS, STONE, WHITE_WOOL, WOOL } from '../blocks'
import { placeBed } from '../beds'
import type { Box } from '../../../engine/physics'
import { World } from '../../../engine/world'
import { yawToward } from './arena'
import { box } from '../../../engine/terrain'
import type { MapDef } from './types'

export const TOP = 20

/**
 * A flat test platform over the void with one station per core mechanic, so
 * each can be tried in isolation: movement, falling, sneaking at edges,
 * bridging, pillaring, breaking each block, combat against dummies, generators
 * and the shop.
 */
export function createSandbox(): MapDef {
  const world = new World(96, 48, 96)
  box(world, 20, TOP - 4, 20, 59, TOP - 2, 59, STONE)
  box(world, 20, TOP - 1, 20, 59, TOP - 1, 59, GRASS)
  const labels: MapDef['labels'] = []
  const label = (text: string, x: number, z: number, y = TOP + 2.5) => labels.push({ text, x, y, z })

  // Jump course along z = 24: single blocks with 1, 2 and 3-block gaps, then a two-step climb.
  for (const [x, h] of [[22, 1], [24, 1], [27, 1], [31, 1], [33, 2], [34, 3]]) box(world, x, TOP, 23, x, TOP + h - 1, 25, PLANKS)
  label('Jump course: 1, 2 and 3-block gaps', 28, 24, TOP + 3.5)

  // Fall tower: a staircase ten blocks up; jump off the side at the marked heights.
  for (let i = 0; i < 10; i++) box(world, 52, TOP, 22 + i, 53, TOP + i, 22 + i, i === 2 || i === 3 || i === 5 || i === 9 ? MOONSTONE : STONE)
  for (const h of [3, 4, 6, 10]) label(`Fall ${h}`, 54.5, 22 + h - 0.5, TOP + h + 1.5)

  // Sneak ledge: a one-wide walk over the void to a small landing.
  box(world, 60, TOP - 1, 40, 75, TOP - 1, 40, PLANKS)
  box(world, 76, TOP - 1, 39, 78, TOP - 1, 41, PLANKS)
  label('Sneak ledge', 66, 40.5)

  // Bridge gap: a target platform nine blocks off the north edge.
  box(world, 36, TOP - 1, 6, 44, TOP - 1, 10, PLANKS)
  label('Bridge across', 40, 18.5)

  // Pillar pit: a clay ring to pillar up inside.
  for (let i = -2; i <= 2; i++) for (const [x, z] of [[30 + i, 48], [30 + i, 52], [28, 50 + i], [32, 50 + i]]) world.set(x, TOP - 1, z, CLAY)
  label('Pillar up', 30.5, 50.5)

  // Break test: one of each buildable block, flagged as placed so they can be broken.
  const palette = [WOOL.red, WHITE_WOOL, CLAY, PLANKS, GLASS, MOONSTONE, OBSIDIAN, STONE, BEDROCK]
  palette.forEach((id, i) => world.set(44 + i * 2, TOP, 56, id, id !== BEDROCK))
  label('Break test', 52, 56.5)

  // Beds: an enemy bed to break and your own, which you cannot.
  placeBed(world, 'blue', 36, TOP, 30, 1, 0)
  placeBed(world, 'red', 44, TOP, 30, 1, 0)
  label('Enemy bed', 37, 30.5, TOP + 1.8)
  label('Your bed', 45, 30.5, TOP + 1.8)

  // Generators for pickup tests.
  const generators: MapDef['generators'] = [
    { kind: 'iron', team: 'red', pos: [26.5, TOP, 40.5] },
    { kind: 'gold', team: 'red', pos: [26.5, TOP, 40.5] },
    { kind: 'diamond', pos: [26.5, TOP, 44.5] },
    { kind: 'emerald', pos: [26.5, TOP, 48.5] },
  ]
  label('Forge', 26.5, 40.5)
  label('Diamond', 26.5, 44.5)
  label('Emerald', 26.5, 48.5)
  label('Dummies', 50.5, 46.5, TOP + 3)

  const zones: Box[] = [[39, TOP, 43, 41, TOP + 3, 45], [25, TOP, 39, 27, TOP + 3, 49]]
  const spawn: [number, number, number, number] = [40.5, TOP, 44.5, 0]
  return {
    name: 'Sandbox',
    world,
    bases: [
      { team: 'red', spawn, bed: { x: 44, y: TOP, z: 30, dx: 1, dz: 0 }, forge: [26.5, TOP, 40.5], center: [40.5, TOP, 40.5] },
      { team: 'blue', spawn: [48.5, TOP, 46.5, yawToward(0, -1)], bed: { x: 36, y: TOP, z: 30, dx: 1, dz: 0 }, forge: [26.5, TOP, 40.5], center: [36.5, TOP, 30.5] },
    ],
    generators,
    npcs: [
      { kind: 'shop', team: 'red', x: 34.5, y: TOP, z: 44.5, yaw: yawToward(1, 0) },
      { kind: 'upgrades', team: 'red', x: 46.5, y: TOP, z: 40.5, yaw: yawToward(-1, 0) },
      { kind: 'dummy', team: 'blue', x: 48.5, y: TOP, z: 46.5, yaw: yawToward(0, -1) },
      { kind: 'dummy', team: 'blue', x: 52.5, y: TOP, z: 46.5, yaw: yawToward(0, -1) },
    ],
    labels,
    lobby: null,
    spectator: [40.5, TOP + 12, 70, 0, -0.45],
    killY: 0,
    build: { minY: 1, maxY: 45, protectedZones: zones },
    sky: '#9fd0ff',
  }
}
