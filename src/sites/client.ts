import { connectRealtime } from '../../freebuff-realtime/browser.js'
import { TICK_MS } from '../engine/constants'
import { RelayGame, type RelayMessage, type Realtime } from './relay'
import { FLUSH_MS } from './wire'

export function connectSites(options: RelayGame['options']) {
  const room = `bedwars:${options.world}:${options.room}:${options.fast ? 'fast' : 'normal'}`
  let realtime: Realtime
  const game = new RelayGame(options, {
    broadcast: (event, data) => realtime.broadcast(event, data),
    presence: (data) => realtime.presence(data),
    close: () => realtime?.close(),
  })
  realtime = connectRealtime({ room, onMessage: (m: RelayMessage) => game.receive(m), onStatus: (s: string) => game.status(s) })
  let last = performance.now(), carry = 0, flushed = last
  const timer = setInterval(() => {
    const now = performance.now()
    carry += now - last
    last = now
    let steps = 0
    while (carry >= TICK_MS && steps++ < 5) { game.tick(); carry -= TICK_MS }
    if (carry > TICK_MS * 5) carry = 0
    if (now - flushed >= FLUSH_MS) { game.flush(); flushed = now }
  }, TICK_MS / 2)
  const close = game.close.bind(game)
  game.close = () => { clearInterval(timer); window.removeEventListener('pagehide', leave); close() }
  const leave = () => game.close()
  window.addEventListener('pagehide', leave)
  return game
}
