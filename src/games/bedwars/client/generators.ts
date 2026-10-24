import { BoxGeometry, Group, Mesh, MeshLambertMaterial, type Sprite } from 'three'
import { textSprite } from '../../../engine/render/entities'
import { TPS } from '../constants'
import type { GeneratorSpot } from '../maps/types'

const ROMAN = ['', 'I', 'II', 'III']

/**
 * Over each diamond and emerald generator: a spinning gem block, the
 * generator's tier and a countdown to its next drop, updated from the
 * room's once-a-second `gens` message.
 */
export class GeneratorDisplays {
  readonly group = new Group()
  private items: { spot: GeneratorSpot; gem: Mesh; label: Sprite | null; key: string; index: number }[] = []

  load(spots: GeneratorSpot[]) {
    this.group.clear()
    this.items = []
    spots.forEach((spot, index) => {
      if (spot.kind !== 'diamond' && spot.kind !== 'emerald') return
      const color = spot.kind === 'diamond' ? '#5fe0d8' : '#38d36b'
      const gem = new Mesh(new BoxGeometry(0.62, 0.62, 0.62), new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }))
      gem.position.set(spot.pos[0], spot.pos[1] + 2.6, spot.pos[2])
      this.group.add(gem)
      this.items.push({ spot, gem, label: null, key: '', index })
    })
  }

  /** `list` entries: [generator index, ticks to the next drop, tier]. */
  update(list: [number, number, number][]) {
    for (const [index, ticks, tier] of list) {
      const it = this.items.find((i) => i.index === index)
      if (!it) continue
      const name = it.spot.kind === 'diamond' ? 'Diamond' : 'Emerald'
      const key = `${tier}:${Math.ceil(ticks / TPS)}`
      if (key === it.key) continue
      it.key = key
      if (it.label) {
        this.group.remove(it.label)
        it.label.material.map?.dispose()
        it.label.material.dispose()
      }
      it.label = textSprite(`${name} ${ROMAN[tier] ?? tier}, spawns in ${Math.ceil(ticks / TPS)}s`, it.spot.kind === 'diamond' ? '#9ff4ee' : '#8af0a8', 0.32)
      it.label.position.set(it.spot.pos[0], it.spot.pos[1] + 3.45, it.spot.pos[2])
      this.group.add(it.label)
    }
  }

  frame(seconds: number) {
    for (const it of this.items) {
      it.gem.rotation.y = seconds * 1.2
      it.gem.rotation.x = Math.PI / 4
      it.gem.rotation.z = Math.PI / 4
      it.gem.position.y = it.spot.pos[1] + 2.6 + Math.sin(seconds * 1.6 + it.index) * 0.12
    }
  }
}
