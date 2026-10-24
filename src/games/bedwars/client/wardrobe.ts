import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import type { TeamId } from '../blocks'
import { CAPES, DEFAULT_LOOK, decodeLook, encodeLook, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, KILL_EFFECTS, OUTFIT_COLORS, OUTFITS, randomLook, SKIN_TONES, TRAILS, type Look } from '../look'
import { Avatar } from './avatar'

const STORAGE_KEY = 'look'

export function loadLook(): Look {
  try {
    return decodeLook(localStorage.getItem(STORAGE_KEY) ?? encodeLook(DEFAULT_LOOK))
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeLook(look))
  } catch {}
}

/**
 * The wardrobe: a turning preview of your figure and a row of choices for each
 * part of your look. Every change is saved and handed to `onChange` at once.
 */
export function openWardrobe(host: HTMLElement, team: TeamId | null, onChange: (look: Look) => void, onClose: () => void): () => void {
  let look = loadLook()
  const overlay = document.createElement('div')
  overlay.className = 'modal show settings-overlay'
  host.append(overlay)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setSize(240, 320)
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.4))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(1, 2, -2)
  scene.add(sun)
  const camera = new PerspectiveCamera(35, 240 / 320, 0.1, 50)
  camera.position.set(0, 1.1, -4.2)
  camera.lookAt(0, 0.95, 0)
  const avatar = new Avatar()
  scene.add(avatar.root)
  let angle = Math.PI + 0.5
  let dragging = false
  let lastX = 0
  let running = true
  let t = 0
  const loop = () => {
    if (!running) return
    requestAnimationFrame(loop)
    if (!dragging) angle += 0.006
    t += 1 / 60
    avatar.root.rotation.y = angle
    // A gentle walk so the cape and trail choices read.
    avatar.animate(1 / 60, { sneak: false, swing: 20, hurt: 20, shield: false, pitch: 0, speed: 2.5 + Math.sin(t) * 1.5, vy: 0 })
    renderer.render(scene, camera)
  }

  const swatches = (key: keyof Look, colors: string[]) =>
    `<div class="swatches">${colors.map((c, i) => `<button class="swatch${look[key] === i ? ' chosen' : ''}" style="background:${c}" data-pick="${key}" data-value="${i}" aria-label="${key} ${i + 1}"></button>`).join('')}</div>`
  const buttons = (key: keyof Look, names: readonly string[]) =>
    `<div class="choice wrap">${names.map((n, i) => `<button class="btn small-btn${look[key] === i ? ' chosen' : ''}" data-pick="${key}" data-value="${i}">${n}</button>`).join('')}</div>`
  const row = (label: string, body: string) => `<div class="setting"><div><b>${label}</b></div>${body}</div>`

  function render() {
    overlay.innerHTML = `<div class="window settings-window wardrobe">
      <div class="window-head"><h2>Wardrobe</h2><button class="btn ghost" data-close>Done</button></div>
      <div class="wardrobe-body">
        <div class="preview"></div>
        <div class="settings-body">
          ${row('Skin', swatches('skin', SKIN_TONES))}
          ${row('Hair', buttons('hairStyle', HAIR_STYLES))}
          ${row('Hair colour', swatches('hairColor', HAIR_COLORS))}
          ${row('Eyes', swatches('eyes', EYE_COLORS))}
          ${row('Outfit', buttons('outfit', OUTFITS))}
          ${row('Outfit colour', swatches('outfitColor', OUTFIT_COLORS))}
          ${row('Cape', buttons('cape', CAPES))}
          ${row('Trail', buttons('trail', TRAILS))}
          ${row('Kill effect', buttons('killEffect', KILL_EFFECTS))}
        </div>
      </div>
      <div class="row"><button class="btn" data-random>Surprise me</button><p class="muted small">Your team colour shows on your armour, armbands and team cape.</p></div>
    </div>`
    overlay.querySelector('.preview')!.append(renderer.domElement)
    overlay.querySelector('[data-close]')!.addEventListener('click', close)
    overlay.querySelector('[data-random]')!.addEventListener('click', () => update(randomLook()))
    overlay.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => update({ ...look, [b.dataset.pick as keyof Look]: Number(b.dataset.value) })))
    const canvas = renderer.domElement
    canvas.onpointerdown = (e) => {
      dragging = true
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
    }
    canvas.onpointermove = (e) => {
      if (!dragging) return
      angle += (e.clientX - lastX) * 0.012
      lastX = e.clientX
    }
    canvas.onpointerup = () => (dragging = false)
  }

  function update(next: Look) {
    look = next
    saveLook(look)
    avatar.dress(look, team, 'leather')
    onChange(look)
    render()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    close()
  }
  window.addEventListener('keydown', onKey, true)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })

  let closed = false
  function close() {
    if (closed) return
    closed = true
    running = false
    window.removeEventListener('keydown', onKey, true)
    avatar.dispose()
    renderer.dispose()
    overlay.remove()
    onClose()
  }

  avatar.dress(look, team, 'leather')
  render()
  loop()
  return close
}
