// Import only from server-side Worker code. Authentication and room membership
// must be checked before calling createRealtimeTicket or publishRealtime.
function hub(env) {
  if (!env.REALTIME) throw new Error('Enable realtime in the Sites deploy manifest and configure the local REALTIME binding.');
  return env.REALTIME.get(env.REALTIME.idFromName('hub'));
}
async function call(env, path, body) {
  const response = await hub(env).fetch(new Request('https://realtime' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  if (!response.ok) throw new Error('Realtime request failed (' + response.status + ').');
  return response;
}
export async function createRealtimeTicket(env, { room, userId, origin, publish = false, presence = false }) {
  return (await call(env, '/ticket', { room, userId, origin, publish, presence })).json();
}
export async function publishRealtime(env, { room, event, data }) {
  await call(env, '/publish', { room, event, data });
}
