/**
 * A player's look: skin, hair, outfit, cape, trail and kill effect. Sent as a
 * short code (one base-36 character per field) and validated on the server, so
 * a client can only ever choose from these lists. Everything is drawn in code
 * (client/avatar.ts); add a choice by appending to a list and its painter.
 */

export const SKIN_TONES = ['#f2d0b1', '#e8b48f', '#d49a6a', '#b07a4e', '#8a5a3a', '#5e3b26']
export const HAIR_STYLES = ['Short', 'Long', 'Buzz', 'Curly', 'Ponytail', 'Bald'] as const
export const HAIR_COLORS = ['#2b1d14', '#5a3a1e', '#8a5a2b', '#c99a4a', '#e8d27a', '#b23a1e', '#9a9a9a', '#3a4a9a']
export const EYE_COLORS = ['#3a6ad8', '#4a8a3a', '#6a4a2a', '#2a2a2a', '#8a4ad8']
export const OUTFITS = ['Hoodie', 'Jacket', 'Tunic', 'Striped', 'Vest', 'Plain'] as const
export const OUTFIT_COLORS = ['#3a6ad8', '#2a2a2a', '#d8d8d8', '#c0392b', '#2e8b57', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d', '#c9a227']
export const CAPES = ['None', 'Team', 'Flame', 'Galaxy', 'Checker', 'Royal', 'Leaf', 'Sunset', 'Frost'] as const
export const TRAILS = ['None', 'Sparkle', 'Flame', 'Hearts', 'Notes', 'Cloud'] as const
export const KILL_EFFECTS = ['None', 'Burst', 'Lightning', 'Confetti'] as const

export interface Look {
  skin: number
  hairStyle: number
  hairColor: number
  eyes: number
  outfit: number
  outfitColor: number
  cape: number
  trail: number
  killEffect: number
}

const FIELDS: [keyof Look, number][] = [
  ['skin', SKIN_TONES.length],
  ['hairStyle', HAIR_STYLES.length],
  ['hairColor', HAIR_COLORS.length],
  ['eyes', EYE_COLORS.length],
  ['outfit', OUTFITS.length],
  ['outfitColor', OUTFIT_COLORS.length],
  ['cape', CAPES.length],
  ['trail', TRAILS.length],
  ['killEffect', KILL_EFFECTS.length],
]

export const DEFAULT_LOOK: Look = { skin: 1, hairStyle: 0, hairColor: 1, eyes: 0, outfit: 0, outfitColor: 0, cape: 1, trail: 0, killEffect: 1 }

export function encodeLook(look: Look): string {
  return FIELDS.map(([k]) => look[k].toString(36)).join('')
}

/** Any string becomes a valid look: unknown or out-of-range fields take the default. */
export function decodeLook(code: unknown): Look {
  const s = typeof code === 'string' ? code.slice(0, FIELDS.length) : ''
  const look = { ...DEFAULT_LOOK }
  FIELDS.forEach(([k, count], i) => {
    const v = parseInt(s[i] ?? '', 36)
    if (Number.isInteger(v) && v >= 0 && v < count) look[k] = v
  })
  return look
}

/** A different look each call, for "Surprise me" and for bots. */
export function randomLook(random: () => number = Math.random): Look {
  const pick = (n: number) => Math.floor(random() * n)
  return {
    skin: pick(SKIN_TONES.length),
    hairStyle: pick(HAIR_STYLES.length),
    hairColor: pick(HAIR_COLORS.length),
    eyes: pick(EYE_COLORS.length),
    outfit: pick(OUTFITS.length),
    outfitColor: pick(OUTFIT_COLORS.length),
    cape: pick(CAPES.length),
    trail: pick(TRAILS.length),
    killEffect: pick(KILL_EFFECTS.length),
  }
}
