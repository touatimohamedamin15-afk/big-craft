# Freebuff Sites realtime

Room broadcasts and presence use a platform-managed hibernating Cloudflare
Durable Object. Add "realtime": true to your Sites deploy manifest. Each site
environment has its own REALTIME binding; no account keys or npm SDK are needed.
These generated workspace files are never overwritten by preparation. Read and
adapt server.js/browser.js; keep worker.js and wrangler.jsonc for local testing
only. Do not upload that helper Worker as your site's Worker.

## Authorize tickets in an HTTP route

Import createRealtimeTicket from ./freebuff-realtime/server.js on the server.
Implement POST /api/realtime/ticket using @freebuff/auth's documented getUser
and isSameOriginRequest helpers. Require JSON, authenticate the session, validate
room, and query D1 to verify that user.sub is a member of that room. Reject
unauthorized requests with 401/403. Never accept userId, origin, publish or
presence from the browser. Choose capabilities based on the user's permissions:

    const ticket = await createRealtimeTicket(env, {
      room, userId: user.sub, origin: env.APP_ORIGIN,
      publish: false, presence: true,
    });
    return Response.json(ticket, { headers: { 'Cache-Control': 'private, no-store' } });

Use the exact configured application origin, not a Host header. For local tests
use your configured development auth APP_ORIGIN. Production connections use the
canonical Sites origin; a custom-domain app needs deliberate canonical-origin
navigation for this first version. Tickets are single-use and expire in 30s.
Sockets reconnect after 5 minutes, rechecking application access through this
route. Sign-out should close the socket immediately. Membership removal takes
effect on the next ticket request (at most the current socket lifetime).

Next.js: implement a normal HTTP route with @freebuff/auth/next and
getCloudflareContext().env. There is no WebSocket upgrade inside a Next route;
the Sites dispatcher owns /.well-known/freebuff/realtime. Call
sites_prepare_next with realtime:true to include the manifest and local binding.

## Connect in the browser

    import { connectRealtime } from './freebuff-realtime/browser.js';
    const connection = connectRealtime({ room: 'project:123', onMessage(message) {
      if (message.type === 'ready') reloadAuthoritativeSnapshot();
      if (message.type === 'broadcast') applyEvent(message);
      if (message.type === 'presence') renderPresence(message.members);
    }});
    connection.presence({ cursor: { x: 10, y: 20 } });
    // Only if your server issued publish:true (untrusted client events):
    connection.broadcast('cursor', { x: 10, y: 20 });
    // On unmount/sign-out:
    connection.close();

Protocol: ready contains connectionId, userId, room, expiresAt and expiresInMs.
The client uses one renewal timer based on the server's remaining expiresInMs
duration, so a skewed browser clock cannot cause a renewal loop. It obtains a
fresh ticket shortly before expiry and
does not wait for a potentially delayed socket close handshake. broadcast contains event,
data, userId and connectionId. presence contains members [{connectionId,userId,data}].
The wire protocol sends presence_update {member} for individual changes; browser.js
normalizes these deltas into presence snapshots for onMessage. broadcast/presence
return false when disconnected, oversized or the outgoing socket buffer is full;
coalesce transient updates instead of queuing them. Messages are at most 16 KiB;
presence data is at most 1 KiB. A room supports 32 connections, and an environment
supports 128 connections across 32 rooms. These limits are shared across users.
Treat all payloads and presence data as untrusted; render text safely. Broadcasts
are ephemeral, without replay or delivery guarantees. Keep durable state in D1/R2
and refresh a snapshot on every ready event; reconcile concurrent snapshots and
updates using application revisions. Persist critical actions through an
authenticated HTTP mutation and call publishRealtime(env,{room,event,data})
AFTER the database transaction succeeds. These server events are trusted only
when the room's clients cannot publish the same event. The server should own
scores, inventory, money and game rules. Realtime is not automatic D1 changefeed
or a high-frequency authoritative physics engine. Batch/throttle cursor updates;
do not send heartbeats. Limits apply per environment and per connection.

## Local Workers preview

Install Wrangler 4.148.0, the supported version used by Sites,
with your project package manager (for npm: npm install --save-dev --save-exact
wrangler@4.148.0). Add this binding to your
application's local Wrangler configuration, preserving its existing bindings:

    "durable_objects": { "bindings": [{
      "name": "REALTIME", "class_name": "FreebuffRealtime",
      "script_name": "freebuff-sites-realtime-local"
    }] }

Start the helper first in one terminal, then the app in a second terminal:

    npx wrangler dev --local -c freebuff-realtime/wrangler.jsonc --inspector-port 9230
    npx wrangler dev --local -c wrangler.jsonc --inspector-port 9229

The helper listens on 8788 and the app normally on 8787. Separate dev processes
connect through Wrangler's local registry on the same machine/user; the app
should show REALTIME as connected. A single multi-config command only exposes
the first Worker's HTTP port, so it cannot serve the helper WebSocket URL.
Use distinct inspector ports as shown, and stop both servers after testing.
For Next.js, replace the app config with freebuff.wrangler.jsonc after
sites_prepare_next({realtime:true}); use this Workers preview to test realtime.
The ordinary next dev preview does not start the helper Worker automatically;
neither preview mode needs an application route that proxies WebSocket upgrades.
No Cloudflare login/credentials are used; storage is local. Open two browser
tabs, verify broadcasts/presence, reject a nonmember, disconnect/reconnect and
verify snapshot recovery. Preview and production are isolated on deploy.
Local helper URLs use ws://127.0.0.1:8788. In a Cloud VM, add --ip 0.0.0.0 to both
commands, expose helper port 8788 using the preview network and pass
websocketUrl: url => { const parsed = new
URL(url); return 'wss://YOUR_HELPER_PREVIEW_HOST' + parsed.pathname + parsed.search; }
to connectRealtime. Never rewrite a production ticket URL to an untrusted host.
Use the exact Cloud application preview origin in the ticket route; do not send
real user data through a publicly exposed development helper. Test hosted auth
on a deployed Sites preview when the provider does not accept the VM origin.

Publishing: deploy the application's prebuilt modules/assets only. Set realtime:
true in the manifest, or retain the local REALTIME binding for automatic Worker
publishing. Sites provisions the managed helper and injects REALTIME. The local
worker source/config and generated SDK files alone do not deploy or publish.
