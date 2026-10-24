import { item } from './items'

export interface Slot {
  id: string
  count: number
}

export const HOTBAR = 9
export const INVENTORY_SIZE = 36

export type Inventory = (Slot | null)[]

export function emptyInventory(): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, () => null)
}

export function countItem(inv: Inventory, id: string): number {
  let n = 0
  for (const s of inv) if (s?.id === id) n += s.count
  return n
}

/** Adds as many as fit (topping up stacks first, hotbar first). Returns what did not fit. */
export function addItem(inv: Inventory, id: string, count: number): number {
  const max = item(id)?.maxStack ?? 64
  for (let i = 0; i < inv.length && count > 0; i++) {
    const s = inv[i]
    if (s?.id === id && s.count < max) {
      const take = Math.min(count, max - s.count)
      s.count += take
      count -= take
    }
  }
  for (let i = 0; i < inv.length && count > 0; i++) {
    if (inv[i] === null) {
      const take = Math.min(count, max)
      inv[i] = { id, count: take }
      count -= take
    }
  }
  return count
}

export function canFit(inv: Inventory, id: string, count: number): boolean {
  const max = item(id)?.maxStack ?? 64
  let room = 0
  for (const s of inv) {
    if (s === null) room += max
    else if (s.id === id) room += max - s.count
    if (room >= count) return true
  }
  return false
}

/** Removes exactly `count` or nothing; returns whether it did. Takes from storage before the hotbar. */
export function removeItem(inv: Inventory, id: string, count: number): boolean {
  if (countItem(inv, id) < count) return false
  for (let i = inv.length - 1; i >= 0 && count > 0; i--) {
    const s = inv[i]
    if (s?.id !== id) continue
    const take = Math.min(count, s.count)
    s.count -= take
    count -= take
    if (s.count === 0) inv[i] = null
  }
  return true
}

export function removeFromSlot(inv: Inventory, index: number, count = 1): boolean {
  const s = inv[index]
  if (!s || s.count < count) return false
  s.count -= count
  if (s.count === 0) inv[index] = null
  return true
}

/** Replaces every item matching `match` with `id` in the first matching slot, or adds it. */
export function replaceItem(inv: Inventory, match: (id: string) => boolean, id: string): void {
  const index = inv.findIndex((s) => s !== null && match(s.id))
  if (index >= 0) {
    inv[index] = { id, count: 1 }
    for (let i = index + 1; i < inv.length; i++) if (inv[i] && match(inv[i]!.id)) inv[i] = null
  } else addItem(inv, id, 1)
}

export function swapSlots(inv: Inventory, a: number, b: number): void {
  if (a < 0 || b < 0 || a >= inv.length || b >= inv.length) return
  ;[inv[a], inv[b]] = [inv[b], inv[a]]
}
