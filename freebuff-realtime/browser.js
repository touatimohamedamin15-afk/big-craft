// No tickets are persisted. Every reconnect reauthorizes through your app API.
export function connectRealtime({ ticketUrl = '/api/realtime/ticket', room, onMessage = () => {}, onStatus = () => {}, websocketUrl = (url) => url }) {
  const endpoint = new URL(ticketUrl, window.location.href);
  if (endpoint.origin !== window.location.origin) throw new Error('The realtime ticket endpoint must be same-origin.');
  let socket, timer, renewal, stopped = false, retry = 0, pending;
  const members = new Map(), encoder = new TextEncoder();
  function send(message) {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024) return false;
    try {
      if (message.type === 'presence' && encoder.encode(JSON.stringify(message.data)).length > 1024) return false;
      const payload = JSON.stringify(message);
      if (encoder.encode(payload).length > 16 * 1024) return false;
      socket.send(payload); return true;
    } catch { return false; }
  }
  const retire = (connection) => {
    clearTimeout(renewal); renewal = undefined;
    if (!connection) return;
    connection.onmessage = connection.onclose = connection.onerror = null;
    if (socket === connection) socket = undefined;
    try { connection.close(1000, 'Authorization renewal'); } catch {}
  };
  const schedule = () => {
    clearTimeout(timer);
    if (stopped) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(retry++, 6)) * (0.5 + Math.random());
    timer = setTimeout(() => { timer = undefined; open(); }, delay);
  };
  async function open() {
    if (stopped || pending) return;
    onStatus('connecting');
    const controller = new AbortController(); pending = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }), signal: controller.signal });
      if (stopped) return;
      if (response.status === 401 || response.status === 403) { stopped = true; onStatus('unauthorized'); return; }
      if (!response.ok) throw new Error('Ticket request failed.');
      const ticket = await response.json();
      if (stopped) return;
      const connection = new WebSocket(websocketUrl(ticket.websocketUrl));
      socket = connection;
      connection.onmessage = ({ data }) => {
        if (stopped || socket !== connection) return;
        let message; try { message = JSON.parse(data); } catch { return; }
        if (message.type === 'ready') {
          retry = 0; members.clear(); clearTimeout(renewal);
          const expiresInMs = Number.isFinite(message.expiresInMs) ? Math.max(1_000, Math.min(300_000, message.expiresInMs)) : 300_000;
          // Renew shortly before expiry, even if the server's Close handshake
          // lingers. One browser timer replaces heartbeats and server timers.
          const delay = Math.max(250, expiresInMs - 500 - Math.random() * 500);
          renewal = setTimeout(() => {
            if (stopped || socket !== connection) return;
            retire(connection); open();
          }, delay);
          onStatus('connected');
        }
        if (message.type === 'presence') { members.clear(); for (const member of message.members) members.set(member.connectionId, member); }
        if (message.type === 'presence_update') {
          members.set(message.member.connectionId, message.member);
          onMessage({ type: 'presence', members: [...members.values()] }); return;
        }
        onMessage(message);
      };
      connection.onclose = () => {
        if (stopped || socket !== connection) return;
        retire(connection); onStatus('disconnected'); schedule();
      };
      connection.onerror = () => {
        if (stopped || socket !== connection) return;
        retire(connection); onStatus('disconnected'); schedule();
      };
    } catch { if (!stopped) { onStatus('disconnected'); schedule(); } }
    finally { clearTimeout(timeout); if (pending === controller) pending = undefined; }
  }
  open();
  return {
    broadcast(event, data) { return send({ type: 'broadcast', event, data }); },
    presence(data) { return send({ type: 'presence', data }); },
    close() { stopped = true; clearTimeout(timer); pending?.abort(); retire(socket); onStatus('closed'); },
  };
}
