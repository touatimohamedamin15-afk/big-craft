import type { Realtime, RelayMessage } from '../src/sites/relay'
export function connectRealtime(options: {
  room: string
  onMessage(message: RelayMessage): void
  onStatus(status: string): void
}): Realtime
