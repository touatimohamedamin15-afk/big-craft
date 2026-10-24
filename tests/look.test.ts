import { describe, expect, test } from 'bun:test'
import { CAPES, decodeLook, DEFAULT_LOOK, encodeLook, randomLook } from '../src/games/bedwars/look'
import { rng } from '../src/engine/random'
import { duel } from './room-helpers'

describe('looks', () => {
  test('round-trip through the short code, and bad codes fall back field by field', () => {
    const look = randomLook(rng(4))
    expect(decodeLook(encodeLook(look))).toEqual(look)
    expect(decodeLook('zzzzzzzzz')).toEqual(DEFAULT_LOOK)
    expect(decodeLook(42)).toEqual(DEFAULT_LOOK)
    expect(decodeLook(`${encodeLook(look).slice(0, 6)}z`).cape).toBe(DEFAULT_LOOK.cape)
    expect(CAPES.length).toBeLessThan(36)
  })

  test('the server keeps only valid looks and shows them to everyone', () => {
    const { room, a, b } = duel()
    a.send({ t: 'look', look: '512432321' })
    expect(room.playerView(a.p).look).toBe('512432321')
    a.send({ t: 'look', look: '<script>' })
    expect(decodeLook(room.playerView(a.p).look)).toEqual(decodeLook('<script>'))
    expect(room.playerView(a.p).look).toMatch(/^[0-9a-z]{9}$/)
    void b
  })

  test('a kill by someone with a kill effect broadcasts it where the victim fell', () => {
    const { room, a, b } = duel()
    a.send({ t: 'look', look: encodeLook({ ...DEFAULT_LOOK, killEffect: 2 }) })
    room.die(b.p, 'melee', a.p)
    expect(b.last('effect')).toMatchObject({ effect: 2 })
  })
})
