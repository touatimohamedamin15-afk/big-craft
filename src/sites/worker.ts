import { createFreebuffAuth, isSameOriginRequest, type FreebuffAuth } from '@freebuff/auth'

type Fetcher = { fetch(request: Request): Promise<Response> }
export type Env = {
  ASSETS: Fetcher
  REALTIME?: { idFromName(name: string): unknown; get(id: unknown): Fetcher }
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
}
const PATH = '/.well-known/freebuff/realtime'
const loopback = (request: Request) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
const roomName = /^bedwars:(arena|sandbox):[a-zA-Z0-9-]{1,32}:(fast|normal)$/

/** Named rooms are open to signed-in visitors who know the code. They are not private ACLs. */
export async function ticket(request: Request, env: Env, userId: string | null): Promise<Response> {
  const origin = env.APP_ORIGIN ?? (loopback(request) ? new URL(request.url).origin : null)
  if (!origin) return json({ error: 'Enable Sign in with Freebuff in Sites before playing online.' }, 503)
  if (!isSameOriginRequest(request, origin)) return json({ error: 'Cross-origin request refused.' }, 403)
  if (!userId) return json({ error: 'Sign in with Freebuff to play online.' }, 401)
  if (!env.REALTIME) return json({ error: 'Enable realtime in the Sites deployment.' }, 503)
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Expected JSON.' }, 415)
  // Bound the body even when Content-Length is absent or forged.
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'Expected a room.' }, 400)
  let size = 0, text = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 512) { await reader.cancel(); return json({ error: 'Request too large.' }, 413) }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const body = JSON.parse(text)
    if (typeof body?.room !== 'string' || !roomName.test(body.room)) return json({ error: 'Invalid room code.' }, 400)
    const response = await env.REALTIME.get(env.REALTIME.idFromName('hub')).fetch(new Request('https://realtime/ticket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: body.room, userId, origin, publish: true, presence: true }),
    }))
    if (!response.ok) return json({ error: 'Realtime is unavailable. Try again shortly.' }, response.status === 429 ? 429 : 503)
    const result = await response.json() as { websocketUrl: string }
    // Local Vite proxies the reserved endpoint through the binding, so one port
    // serves the page and socket (also usable through a Cloud preview proxy).
    if (loopback(request)) {
      const socket = new URL(result.websocketUrl)
      const app = new URL(origin)
      socket.protocol = app.protocol === 'https:' ? 'wss:' : 'ws:'
      socket.host = app.host
      result.websocketUrl = socket.href
    }
    return json(result)
  } catch { return json({ error: 'Could not create a realtime ticket.' }, 400) }
  finally { reader.releaseLock() }
}

let cached: { key: string; auth: FreebuffAuth } | undefined
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    let auth: FreebuffAuth | undefined
    if (env.FREEBUFF_CLIENT_ID && env.APP_ORIGIN) {
      const key = JSON.stringify([env.FREEBUFF_CLIENT_ID, env.FREEBUFF_ISSUER, env.APP_ORIGIN])
      if (cached?.key !== key) cached = { key, auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID, issuer: env.FREEBUFF_ISSUER, baseUrl: env.APP_ORIGIN,
        allowInsecureLocalhost: env.APP_ORIGIN.startsWith('http:') && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.APP_ORIGIN).hostname),
      }) }
      auth = cached.auth
    }
    const handle = async (req: Request) => {
      if (path === '/api/player' && req.method === 'GET') return json({
        configured: !!env.REALTIME && (!!auth || (!env.FREEBUFF_CLIENT_ID && loopback(req))),
        signedIn: auth ? !!await auth.getUser(req) : !env.FREEBUFF_CLIENT_ID && loopback(req),
      })
      if (path === '/api/realtime/ticket') {
        if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
        const userId = auth ? (await auth.getUser(req))?.sub ?? null : !env.FREEBUFF_CLIENT_ID && loopback(req) ? 'local-player' : null
        return ticket(req, env, userId)
      }
      if (path === PATH && loopback(req) && env.REALTIME && req.method === 'GET' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket')
        return env.REALTIME.get(env.REALTIME.idFromName('hub')).fetch(req)
      if (path === '/healthz') return json({ ok: true, multiplayer: 'browser-hosted' })
      if (path.startsWith('/api/') || path === PATH) return json({ error: 'Not found.' }, 404)
      if (path.startsWith('/auth/')) return json({ error: 'Enable Sign in with Freebuff in Sites to play online. Solo play is available without setup.' }, 503)
      return env.ASSETS.fetch(req)
    }
    return auth ? auth.wrap(handle)(request) : handle(request)
  },
}
