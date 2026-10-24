import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type Object3D, type Texture } from 'three'
import type { AtlasLayout } from '../../../engine/render/atlas-layout'
import { blockCube } from '../../../engine/render/entities'
import { TNT } from '../blocks'
import { TICK_MS } from '../constants'
import type { ProjectileView } from '../protocol'

/**
 * Arrows, fireballs, pearls, eggs and lit TNT. Positions come 20 times a
 * second; between updates each one carries on along its velocity.
 */
export class ProjectileModels {
  readonly group = new Group()
  private items = new Map<number, { obj: Object3D; view: ProjectileView; at: number }>()
  private tntMaterial: MeshLambertMaterial

  constructor(
    private readonly layout: AtlasLayout,
    atlas: Texture,
  ) {
    this.tntMaterial = new MeshLambertMaterial({ map: atlas })
  }

  private make(kind: string): Object3D {
    switch (kind) {
      case 'arrow': {
        const g = new Group()
        const shaft = new Mesh(new BoxGeometry(0.05, 0.05, 0.6), new MeshLambertMaterial({ color: '#8a6a45' }))
        const tip = new Mesh(new BoxGeometry(0.08, 0.08, 0.1), new MeshLambertMaterial({ color: '#d8d8d8' }))
        tip.position.z = -0.33
        g.add(shaft, tip)
        return g
      }
      case 'fireball':
        return new Mesh(new BoxGeometry(0.45, 0.45, 0.45), new MeshBasicMaterial({ color: '#ff8a1a' }))
      case 'pearl':
        return new Mesh(new BoxGeometry(0.22, 0.22, 0.22), new MeshLambertMaterial({ color: '#1f8f86', emissive: '#0b3b37' }))
      case 'egg':
        return new Mesh(new BoxGeometry(0.2, 0.26, 0.2), new MeshLambertMaterial({ color: '#f2efe4' }))
      case 'tnt': {
        const m = new Mesh(blockCube(this.layout, TNT), this.tntMaterial.clone())
        m.scale.setScalar(0.98)
        return m
      }
      default:
        return new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshLambertMaterial({ color: '#ffffff' }))
    }
  }

  update(list: ProjectileView[], now: number) {
    const seen = new Set<number>()
    for (const v of list) {
      seen.add(v.id)
      let item = this.items.get(v.id)
      if (!item) {
        item = { obj: this.make(v.kind), view: v, at: now }
        this.items.set(v.id, item)
        this.group.add(item.obj)
      }
      item.view = v
      item.at = now
    }
    for (const [id, item] of this.items)
      if (!seen.has(id)) {
        this.group.remove(item.obj)
        this.items.delete(id)
      }
  }

  frame(now: number) {
    for (const { obj, view, at } of this.items.values()) {
      const t = Math.min(2, (now - at) / TICK_MS)
      obj.position.set(view.x + view.vx * t, view.y + view.vy * t, view.z + view.vz * t)
      if (view.kind === 'tnt') {
        obj.position.y += 0.49
        // Blink white faster as the fuse runs out.
        const blink = (view.fuse ?? 60) < 20 ? 4 : 8
        ;((obj as Mesh).material as MeshLambertMaterial).emissive.setRGB(Math.floor(now / (blink * TICK_MS)) % 2 ? 0.6 : 0, Math.floor(now / (blink * TICK_MS)) % 2 ? 0.6 : 0, Math.floor(now / (blink * TICK_MS)) % 2 ? 0.6 : 0)
      } else if (view.kind === 'arrow') {
        obj.lookAt(obj.position.x - view.vx, obj.position.y - view.vy, obj.position.z - view.vz)
      } else {
        obj.rotation.x = now / 200
        obj.rotation.y = now / 260
      }
    }
  }

  clear() {
    for (const item of this.items.values()) this.group.remove(item.obj)
    this.items.clear()
  }
}
