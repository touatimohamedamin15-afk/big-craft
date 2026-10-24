import { ACTIONS, bind, DEFAULT_SETTINGS, FIXED_CONTROLS, keyLabel, saveSettings, type Action, type Settings } from './settings'

type Tab = 'game' | 'controls' | 'video' | 'audio'

/**
 * The settings window, used from the main menu and the pause menu. Every
 * change is saved and handed to `onChange` at once, so it applies live.
 */
export function openSettings(host: HTMLElement, initial: Settings, onChange: (s: Settings) => void, onClose: () => void): () => void {
  let settings = initial
  let tab: Tab = 'game'
  let waiting: { action: Action; slot: number } | null = null
  const overlay = document.createElement('div')
  overlay.className = 'modal show settings-overlay'
  host.append(overlay)

  const update = (next: Settings) => {
    settings = next
    saveSettings(settings)
    onChange(settings)
    render()
  }

  const onKey = (e: KeyboardEvent) => {
    if (!waiting) {
      if (e.code === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close()
      }
      return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
    const { action, slot } = waiting
    waiting = null
    if (e.code === 'Escape') return render()
    if (e.code === 'Backspace' || e.code === 'Delete') {
      const keys = { ...settings.keys, [action]: settings.keys[action].filter((_, i) => i !== slot) }
      return update({ ...settings, keys })
    }
    update(bind(settings, action, e.code, slot))
  }
  window.addEventListener('keydown', onKey, true)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })

  let closed = false
  function close() {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onKey, true)
    overlay.remove()
    onClose()
  }

  const toggle = (label: string, value: boolean, key: keyof Settings, help: string) =>
    `<div class="setting"><div><b>${label}</b><p>${help}</p></div><button class="btn small-btn" data-toggle="${key}">${value ? 'On' : 'Off'}</button></div>`
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, shown: string, help: string) =>
    `<div class="setting"><div><b>${label}: <span data-show="${key}">${shown}</span></b><p>${help}</p></div><input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"></div>`
  const choice = <T extends string>(label: string, key: keyof Settings, options: [T, string][], help: string) =>
    `<div class="setting"><div><b>${label}</b><p>${help}</p></div><div class="choice">${options.map(([v, l]) => `<button class="btn small-btn${settings[key] === v ? ' chosen' : ''}" data-choice="${key}" data-value="${v}">${l}</button>`).join('')}</div></div>`

  function body(): string {
    switch (tab) {
      case 'game':
        return [
          slider('Mouse sensitivity', 'sensitivity', 0.1, 4, 0.05, `${Math.round(settings.sensitivity * 100)}%`, 'How far the view turns for each move of the mouse.'),
          toggle('Invert mouse', settings.invertY, 'invertY', 'Moving the mouse up looks down.'),
          slider('Field of view', 'fov', 50, 110, 1, `${settings.fov}°`, 'Wider shows more around you; sprinting widens it a little more.'),
          choice('Sprint', 'sprintMode', [['hold', 'Hold'], ['toggle', 'Toggle'], ['always', 'Always']], 'Hold: sprint while the key is down. Toggle: press once to sprint, again to walk. Always: sprint whenever you move forward.'),
          toggle('Double-tap forward to sprint', settings.doubleTapSprint, 'doubleTapSprint', 'Tap forward twice quickly to start sprinting, as well as the sprint key.'),
          toggle('View bobbing', settings.viewBobbing, 'viewBobbing', 'Your hand bobs as you walk.'),
          toggle('Show frame rate', settings.showFps, 'showFps', 'A small frame counter in the corner.'),
        ].join('')
      case 'controls': {
        const rows = ACTIONS.map((a) => {
          const keys = settings.keys[a.id] ?? []
          const btn = (slot: number) => {
            const active = waiting?.action === a.id && waiting.slot === slot
            return `<button class="btn key${active ? ' chosen' : ''}" data-bind="${a.id}" data-slot="${slot}">${active ? 'Press a key' : keys[slot] ? keyLabel(keys[slot]) : 'None'}</button>`
          }
          return `<div class="setting control"><div><b>${a.label}</b><p>${a.help}</p></div><div class="choice">${btn(0)}${btn(1)}</div></div>`
        }).join('')
        const fixed = FIXED_CONTROLS.map((c) => `<div class="setting control"><div><b>${c.label}</b><p>${c.help}</p></div><span class="fixed">${c.input}</span></div>`).join('')
        return `<p class="note">Click a key to change it, then press the new key. Backspace clears it, Esc cancels. In a browser, Ctrl+W closes the tab, so sprint with R or a double-tap there.</p>${rows}${fixed}<div class="row"><button class="btn" data-reset="keys">Reset controls</button></div>`
      }
      case 'video':
        return [
          slider('Render distance', 'renderDistance', 60, 300, 10, `${settings.renderDistance} blocks`, 'How far you see before fog. Lower is faster on slow machines.'),
          choice('Quality', 'quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'Rendering resolution. Low draws fewer pixels for a faster frame rate.'),
          `<div class="setting"><div><b>Full screen</b><p>Also F11 in the desktop app.</p></div><button class="btn small-btn" data-act="fullscreen">${document.fullscreenElement ? 'Leave' : 'Enter'}</button></div>`,
        ].join('')
      case 'audio':
        return slider('Volume', 'volume', 0, 1, 0.05, `${Math.round(settings.volume * 100)}%`, 'Hits, blocks, explosions, pickups and the countdown.')
    }
  }

  function render() {
    const tabs: [Tab, string][] = [['game', 'Game'], ['controls', 'Controls'], ['video', 'Video'], ['audio', 'Audio']]
    overlay.innerHTML = `<div class="window settings-window">
      <div class="window-head"><h2>Settings</h2><button class="btn ghost" data-close>Done</button></div>
      <div class="tabs">${tabs.map(([id, label]) => `<button class="tab${id === tab ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="settings-body">${body()}</div>
      <div class="row"><button class="btn" data-reset="all">Reset everything</button></div>
    </div>`
    overlay.querySelector('[data-close]')!.addEventListener('click', close)
    overlay.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab as Tab
        waiting = null
        render()
      }),
    )
    overlay.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
      const key = b.dataset.toggle as keyof Settings
      b.addEventListener('click', () => update({ ...settings, [key]: !settings[key] }))
    })
    overlay.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => b.addEventListener('click', () => update({ ...settings, [b.dataset.choice as keyof Settings]: b.dataset.value })))
    overlay.querySelectorAll<HTMLInputElement>('[data-range]').forEach((input) => {
      const key = input.dataset.range as keyof Settings
      // Live while dragging; saved and re-rendered when let go.
      input.addEventListener('input', () => {
        settings = { ...settings, [key]: Number(input.value) }
        onChange(settings)
        const shown = overlay.querySelector(`[data-show="${key}"]`)
        if (shown) shown.textContent = key === 'fov' ? `${input.value}°` : key === 'renderDistance' ? `${input.value} blocks` : `${Math.round(Number(input.value) * 100)}%`
      })
      input.addEventListener('change', () => update(settings))
    })
    overlay.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((b) =>
      b.addEventListener('click', () => {
        waiting = { action: b.dataset.bind as Action, slot: Number(b.dataset.slot) }
        render()
      }),
    )
    overlay.querySelector('[data-reset="keys"]')?.addEventListener('click', () => update({ ...settings, keys: DEFAULT_SETTINGS.keys }))
    overlay.querySelector('[data-reset="all"]')?.addEventListener('click', () => update({ ...DEFAULT_SETTINGS }))
    overlay.querySelector('[data-act="fullscreen"]')?.addEventListener('click', async () => {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      else await document.documentElement.requestFullscreen().catch(() => {})
      render()
    })
  }

  render()
  return close
}
