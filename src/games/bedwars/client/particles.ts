import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three'

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  size: number
  gravity: number
}

const MAX = 900
const GRAVITY = 14

/** Small falling cubes for broken blocks and hits, drawn as one instanced mesh. */
export class Particles {
  readonly mesh: InstancedMesh
  private particles: (Particle | null)[] = new Array(MAX).fill(null)
  private next = 0
  private m = new Matrix4()
  private q = new Quaternion()
  private s = new Vector3()
  private p = new Vector3()

  constructor() {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0xffffff }), MAX)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = MAX
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0))
      this.mesh.setColorAt(i, new Color(1, 1, 1))
    }
  }

  /** A burst of `n` particles of `color` from around (x, y, z). */
  burst(x: number, y: number, z: number, color: string, n = 12, spread = 0.5, speed = 3, gravity = GRAVITY, size = 1) {
    const c = new Color(color)
    for (let k = 0; k < n; k++) {
      const i = this.next
      this.next = (this.next + 1) % MAX
      const shade = 0.75 + Math.random() * 0.35
      this.mesh.setColorAt(i, c.clone().multiplyScalar(shade))
      this.particles[i] = {
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * speed,
        vy: Math.random() * speed * 0.9 + 1,
        vz: (Math.random() - 0.5) * speed,
        life: 0.5 + Math.random() * 0.5,
        size: (0.06 + Math.random() * 0.08) * size,
        gravity,
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  frame(dt: number) {
    let any = false
    for (let i = 0; i < MAX; i++) {
      const p = this.particles[i]
      if (!p) continue
      any = true
      p.life -= dt
      if (p.life <= 0) {
        this.particles[i] = null
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0))
        continue
      }
      p.vy -= p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const size = p.size * Math.min(1, p.life * 3)
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.set(size, size, size)))
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true
  }
}
