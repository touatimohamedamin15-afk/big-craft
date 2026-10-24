import { CanvasTexture, DoubleSide, Group, Mesh, MeshLambertMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three'
import type { DropLike } from '../../../engine/render/entities'
import { drawItemArt } from './icons'

/**
 * Items lying in the world (generator piles): each a flat pixel-art sprite
 * that spins and bobs, with up to three copies for a bigger pile.
 */
export class ItemDrops {
  readonly group = new Group()
  private drops = new Map<number, { obj: Group; view: DropLike }>()
  private materials = new Map<string, MeshLambertMaterial>()
  private plane = new PlaneGeometry(0.42, 0.42)

  private material(id: string): MeshLambertMaterial {
    let m = this.materials.get(id)
    if (!m) {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      drawItemArt(c.getContext('2d')!, id)
      const t = new CanvasTexture(c)
      t.magFilter = NearestFilter
      t.minFilter = NearestFilter
      t.colorSpace = SRGBColorSpace
      m = new MeshLambertMaterial({ map: t, alphaTest: 0.5, side: DoubleSide, emissive: '#222222' })
      this.materials.set(id, m)
    }
    return m
  }

  update(views: DropLike[]) {
    const seen = new Set<number>()
    for (const v of views) {
      seen.add(v.id)
      let d = this.drops.get(v.id)
      if (!d) {
        const obj = new Group()
        for (let i = 0; i < 3; i++) {
          const m = new Mesh(this.plane, this.material(v.item))
          m.position.set((i - 1) * 0.08, i * 0.06, (i % 2) * 0.06 - 0.03)
          m.rotation.y = i * 0.5
          obj.add(m)
        }
        d = { obj, view: v }
        this.drops.set(v.id, d)
        this.group.add(obj)
      }
      d.view = v
      d.obj.children.forEach((c, i) => (c.visible = i < Math.min(3, Math.ceil(v.count / 4))))
    }
    for (const [id, d] of this.drops)
      if (!seen.has(id)) {
        this.group.remove(d.obj)
        this.drops.delete(id)
      }
  }

  frame(seconds: number) {
    for (const d of this.drops.values()) {
      d.obj.position.set(d.view.x, d.view.y + 0.3 + Math.sin(seconds * 2 + d.view.id) * 0.07, d.view.z)
      d.obj.rotation.y = seconds * 1.6 + d.view.id
    }
  }

  clear() {
    for (const d of this.drops.values()) this.group.remove(d.obj)
    this.drops.clear()
  }
}
