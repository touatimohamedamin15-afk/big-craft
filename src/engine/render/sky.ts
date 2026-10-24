import { BufferGeometry, Float32BufferAttribute, Group, Mesh, SphereGeometry, type ShaderMaterial } from 'three'
import { hash2 } from '../random'
import { createCloudMaterial, createSkyMaterial, type Environment } from './shaders'

/** Sky dome that follows the camera, and a drifting layer of blocky clouds. */
export function createSky(env: Environment, cloudY: number, center: [number, number]) {
  const group = new Group()
  const dome = new Mesh(new SphereGeometry(400, 32, 16), createSkyMaterial(env))
  dome.renderOrder = -1
  dome.frustumCulled = false
  group.add(dome)

  const clouds = new Mesh(cloudGeometry(), createCloudMaterial(env))
  clouds.position.set(center[0] - 192, cloudY, center[1] - 192)
  clouds.renderOrder = 2
  const root = new Group()
  root.add(group, clouds)
  return {
    root,
    cloudMaterial: clouds.material as ShaderMaterial,
    update(cameraX: number, cameraY: number, cameraZ: number, seconds: number) {
      dome.position.set(cameraX, cameraY, cameraZ)
      clouds.position.x = center[0] - 192 + ((seconds * 0.6) % 48)
    },
  }
}

/** Cloud cells on a 2D noise threshold, culled like Voxelize's cloud mesher: only faces against empty cells. */
function cloudGeometry(): BufferGeometry {
  const N = 48
  const S = 8
  const H = 3
  const on = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return false
    const n = hash2(x >> 1, z >> 1, 9) * 0.6 + hash2(x, z, 3) * 0.4
    return n > 0.68
  }
  const pos: number[] = []
  const nor: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    pos.push(...a, ...b, ...c, ...c, ...b, ...d)
    for (let i = 0; i < 6; i++) nor.push(...n)
  }
  for (let x = 0; x < N; x++)
    for (let z = 0; z < N; z++) {
      if (!on(x, z)) continue
      const x0 = x * S
      const x1 = x0 + S
      const z0 = z * S
      const z1 = z0 + S
      quad([x0, H, z0], [x0, H, z1], [x1, H, z0], [x1, H, z1], [0, 1, 0])
      quad([x1, 0, z0], [x1, 0, z1], [x0, 0, z0], [x0, 0, z1], [0, -1, 0])
      if (!on(x + 1, z)) quad([x1, H, z1], [x1, 0, z1], [x1, H, z0], [x1, 0, z0], [1, 0, 0])
      if (!on(x - 1, z)) quad([x0, H, z0], [x0, 0, z0], [x0, H, z1], [x0, 0, z1], [-1, 0, 0])
      if (!on(x, z + 1)) quad([x0, H, z1], [x0, 0, z1], [x1, H, z1], [x1, 0, z1], [0, 0, 1])
      if (!on(x, z - 1)) quad([x1, H, z0], [x1, 0, z0], [x0, H, z0], [x0, 0, z0], [0, 0, -1])
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  return g
}

