import { expect, test } from 'bun:test'
import worker, { ticket, type Env } from '../src/sites/worker'

const origin = 'https://game.example'
function request(body: unknown = { room: 'bedwars:arena:test:normal' }, from = origin) {
  return new Request(origin + '/api/realtime/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body) })
}
function setup() {
  const calls: unknown[] = []
  const env: Env = {
    APP_ORIGIN: origin,
    ASSETS: { fetch: async () => new Response('assets') },
    REALTIME: { idFromName: (name) => name, get: () => ({ fetch: async (req) => {
      calls.push(await req.json())
      return Response.json({ websocketUrl: 'wss://game.example/.well-known/freebuff/realtime?ticket=ephemeral' })
    } }) },
  }
  return { env, calls }
}
test('ticket derives identity, origin and permissions on the server', async () => {
  const { env, calls } = setup()
  const response = await ticket(request({ room: 'bedwars:arena:test:normal', userId: 'forged', origin: 'https://elsewhere.example', publish: false }), env, 'signed-in-user')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(calls).toEqual([{ room: 'bedwars:arena:test:normal', userId: 'signed-in-user', origin, publish: true, presence: true }])
})
test('anonymous, cross-origin, oversized and invalid room requests do not mint tickets', async () => {
  const { env, calls } = setup()
  expect((await ticket(request(), env, null)).status).toBe(401)
  expect((await ticket(request({}, 'https://elsewhere.example'), env, 'user')).status).toBe(403)
  expect((await ticket(request({ room: '../another-room' }), env, 'user')).status).toBe(400)
  expect((await ticket(request({ room: 'x'.repeat(1000) }), env, 'user')).status).toBe(413)
  expect(calls).toEqual([])
})
test('deployed worker fails closed without auth and never enables the local socket proxy', async () => {
  const { env, calls } = setup()
  expect((await worker.fetch(request(), env)).status).toBe(401)
  expect((await worker.fetch(new Request(origin + '/.well-known/freebuff/realtime', { headers: { Upgrade: 'websocket' } }), env)).status).toBe(404)
  expect(calls).toEqual([])
  expect(await (await worker.fetch(new Request(origin), env)).text()).toBe('assets')
})
test('missing canonical origin or realtime binding produces an actionable setup error', async () => {
  const { env } = setup()
  expect((await ticket(request(), { ...env, APP_ORIGIN: undefined }, 'user')).status).toBe(503)
  expect((await ticket(request(), { ...env, REALTIME: undefined }, 'user')).status).toBe(503)
})
