/** Player settings: controls, view, video and audio. Kept in localStorage; every field is validated on load. */

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint' | 'drop' | 'inventory' | 'shop' | 'chat' | 'command' | 'players' | 'perspective' | 'debug'

export interface ActionInfo {
  id: Action
  label: string
  /** What it does, shown in the Controls tab. */
  help: string
  keys: string[]
}

/** Rebindable keyboard actions, in the order the Controls tab lists them. */
export const ACTIONS: ActionInfo[] = [
  { id: 'forward', label: 'Walk forward', help: 'Move ahead. Double-tap to sprint when that option is on.', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Walk back', help: 'Step backwards. You cannot sprint backwards.', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Strafe left', help: 'Move sideways without turning.', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Strafe right', help: 'Move sideways without turning.', keys: ['KeyD', 'ArrowRight'] },
  { id: 'jump', label: 'Jump', help: 'Hold to keep jumping. Jump and place under yourself to pillar up.', keys: ['Space'] },
  { id: 'sneak', label: 'Sneak', help: 'Walk slowly and never fall off an edge. Hold it while bridging.', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'sprint', label: 'Sprint', help: 'Run faster and hit harder knockback. Hold or toggle (see Game).', keys: ['ControlLeft', 'KeyR'] },
  { id: 'drop', label: 'Drop item', help: 'Throw one of what you are holding, for a teammate to pick up. Hold Ctrl to throw the whole stack.', keys: ['KeyQ'] },
  { id: 'inventory', label: 'Inventory', help: 'Open your inventory to move items to the hotbar.', keys: ['KeyE'] },
  { id: 'shop', label: 'Nearest shop', help: 'Open the item shop or upgrades if a shopkeeper is close.', keys: ['KeyB'] },
  { id: 'chat', label: 'Chat', help: 'Talk to your team; start with ! to talk to everyone.', keys: ['KeyT', 'Enter'] },
  { id: 'command', label: 'Command', help: 'Open chat with / typed, for commands like /help.', keys: ['Slash'] },
  { id: 'players', label: 'Player list', help: 'Hold to see everyone in the room.', keys: ['Tab'] },
  { id: 'perspective', label: 'Camera', help: 'Switch between first person and a view from behind, to see your skin and cape.', keys: ['F5', 'KeyV'] },
  { id: 'debug', label: 'Debug screen', help: 'Position, speed, what you are looking at, frame rate.', keys: ['F3'] },
]

/** Mouse and fixed keys, shown in the Controls tab but not rebindable. */
export const FIXED_CONTROLS: { label: string; input: string; help: string }[] = [
  { label: 'Attack or break', input: 'Left click', help: 'Hit players. Hold on a block to break it; tools break their blocks faster.' },
  { label: 'Use or place', input: 'Right click', help: 'Place blocks (hold to keep placing), eat, drink, throw, raise a shield, talk to shopkeepers.' },
  { label: 'Draw a bow', input: 'Hold right click', help: 'The longer you draw (up to one second), the harder the arrow hits.' },
  { label: 'Hotbar', input: '1 to 9, mouse wheel', help: 'Choose what is in your hand.' },
  { label: 'Pause or menus', input: 'Esc', help: 'Free the mouse, open the lobby or pause menu, close windows.' },
]

export type SprintMode = 'hold' | 'toggle' | 'always'
export type Quality = 'low' | 'medium' | 'high'

export interface Settings {
  sensitivity: number
  invertY: boolean
  fov: number
  sprintMode: SprintMode
  doubleTapSprint: boolean
  viewBobbing: boolean
  showFps: boolean
  /** Blocks until the fog fully hides the world. */
  renderDistance: number
  quality: Quality
  volume: number
  keys: Record<Action, string[]>
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.6,
  invertY: false,
  fov: 75,
  sprintMode: 'hold',
  doubleTapSprint: true,
  viewBobbing: true,
  showFps: false,
  renderDistance: 150,
  quality: 'high',
  volume: 0.6,
  keys: Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])) as Record<Action, string[]>,
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)

/** Defaults overlaid with whatever valid values were saved; anything malformed falls back. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const d = DEFAULT_SETTINGS
  const keys = { ...d.keys }
  if (r.keys && typeof r.keys === 'object')
    for (const a of ACTIONS) {
      const k = (r.keys as Record<string, unknown>)[a.id]
      if (Array.isArray(k) && k.every((c) => typeof c === 'string')) keys[a.id] = (k as string[]).slice(0, 2)
    }
  // Settings saved before version 2 carry the old default sensitivity of 1; they get the new one.
  const oldDefault = (raw as { version?: number } | null)?.version === undefined && r.sensitivity === 1
  return {
    sensitivity: oldDefault ? d.sensitivity : clamp(r.sensitivity, 0.1, 4, d.sensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    fov: clamp(r.fov, 50, 110, d.fov),
    sprintMode: oneOf(r.sprintMode, ['hold', 'toggle', 'always'] as const, d.sprintMode),
    doubleTapSprint: typeof r.doubleTapSprint === 'boolean' ? r.doubleTapSprint : d.doubleTapSprint,
    viewBobbing: typeof r.viewBobbing === 'boolean' ? r.viewBobbing : d.viewBobbing,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
    renderDistance: clamp(r.renderDistance, 60, 300, d.renderDistance),
    quality: oneOf(r.quality, ['low', 'medium', 'high'] as const, d.quality),
    volume: clamp(r.volume, 0, 1, d.volume),
    keys,
  }
}

const STORAGE_KEY = 'settings'
const SETTINGS_VERSION = 2

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return parseSettings({})
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, version: SETTINGS_VERSION }))
  } catch {}
}

/** The action a key code is bound to, if any. */
export function actionFor(settings: Settings, code: string): Action | undefined {
  return ACTIONS.find((a) => settings.keys[a.id]?.includes(code))?.id
}

/** Binds `code` to `action` (as its first key), unbinding it from any other action. */
export function bind(settings: Settings, action: Action, code: string, slot = 0): Settings {
  const keys = Object.fromEntries(Object.entries(settings.keys).map(([a, codes]) => [a, codes.filter((c) => c !== code)])) as Record<Action, string[]>
  const mine = [...(keys[action] ?? [])]
  mine[slot] = code
  keys[action] = mine.filter(Boolean).slice(0, 2)
  return { ...settings, keys }
}

const NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left Cmd',
  MetaRight: 'Right Cmd',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Slash: '/',
  Tab: 'Tab',
  Backquote: '`',
  CapsLock: 'Caps Lock',
}

/** A readable name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

/** Device pixel ratio cap for each quality level. */
export function pixelRatio(quality: Quality, device: number): number {
  return quality === 'low' ? 0.75 : quality === 'medium' ? 1 : Math.min(2, device)
}
