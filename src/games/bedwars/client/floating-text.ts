import { Group, type Sprite } from 'three'
import { textSprite } from '../../../engine/render/entities'

/** Damage numbers that rise and fade over a player's head. */
export class FloatingText {
  readonly group = new Group()
  private items: { sprite: Sprite; life: number }[] = []

  show(x: number, y: number, z: number, text: string, color: string) {
    const sprite = textSprite(text, color, 0.42, 'rgba(0,0,0,0)')
    sprite.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4)
    sprite.material.depthTest = false
    sprite.renderOrder = 10
    this.group.add(sprite)
    this.items.push({ sprite, life: 0.9 })
  }

  frame(dt: number) {
    this.items = this.items.filter((it) => {
      it.life -= dt
      it.sprite.position.y += dt * 0.9
      it.sprite.material.opacity = Math.min(1, it.life * 2.5)
      if (it.life > 0) return true
      this.group.remove(it.sprite)
      it.sprite.material.map?.dispose()
      it.sprite.material.dispose()
      return false
    })
  }
}
