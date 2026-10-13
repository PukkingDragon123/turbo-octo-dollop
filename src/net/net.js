// Networking: host-authoritative star topology over WebRTC (PeerJS).
// The same code path runs offline, as host and as client:
//   net.toHost(type, data)   -> runs the host handler (locally if we ARE the host/offline)
//   net.toAll(type, data)    -> (host only) runs client handlers on every peer incl. ourselves
//   net.toPeer(id, type, d)  -> (host only) runs client handler on one peer
// Handlers: net.onHost(type, (data, fromId) => ...), net.onClient(type, (data) => ...)
import { Peer } from 'peerjs';

const PREFIX = 'room-corp-dimdispatch-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// Optional self-hosted signalling server: ?peerhost=localhost&peerport=9000&peerpath=/myapp
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: 1 };
  if (q.get('peerhost')) {
    o.host = q.get('peerhost');
    o.port = Number(q.get('peerport') || 9000);
    o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') === '1';
  }
  return o;
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

class Net {
  constructor() {
    this.mode = 'offline';
    this.selfId = 'local';
    this.hostId = 'local';
    this.peer = null;
    this.conns = new Map(); // host: peerId -> DataConnection
    this.hostConn = null;   // client: connection to host
    this.hostHandlers = new Map();
    this.clientHandlers = new Map();
    this.eventHandlers = new Map();
    this.roomCode = null;
    this.stats = { sent: 0, recv: 0, bytesOut: 0 };
    this.maxPeers = 3; // + host = 4 players
  }

  get isHost() { return this.mode !== 'client'; }
  get isOnline() { return this.mode !== 'offline'; }

  on(evt, fn) {
    if (!this.eventHandlers.has(evt)) this.eventHandlers.set(evt, []);
    this.eventHandlers.get(evt).push(fn);
  }
  emit(evt, ...args) {
    for (const fn of this.eventHandlers.get(evt) || []) fn(...args);
  }
  onHost(type, fn) { this.hostHandlers.set(type, fn); }
  onClient(type, fn) { this.clientHandlers.set(type, fn); }

  startOffline() {
    this.shutdown();
    this.mode = 'offline';
    this.selfId = 'local';
    this.hostId = 'local';
    return Promise.resolve();
  }

  async host() {
    this.shutdown();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode();
      try {
        const peer = new Peer(PREFIX + code, peerOptions());
        await withTimeout(new Promise((res, rej) => {
          peer.once('open', res);
          peer.once('error', rej);
        }), 12000, 'Could not reach the matchmaking server.');
        this.peer = peer;
        this.mode = 'host';
        this.selfId = peer.id;
        this.hostId = peer.id;
        this.roomCode = code;
        peer.on('connection', (conn) => this._acceptConn(conn));
        peer.on('error', (e) => console.warn('[net] peer error', e?.type || e));
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
        peer.on('call', (call) => this.emit('call', call));
        return code;
      } catch (e) {
        if (String(e?.type) !== 'unavailable-id' && attempt >= 1) throw e;
      }
    }
    throw new Error('Could not create a room.');
  }

  _acceptConn(conn) {
    conn.on('open', () => {
      if (this.conns.size >= this.maxPeers) {
        conn.send(['full', {}]);
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(conn.peer, conn);
      this.emit('peerJoined', conn.peer, conn.metadata || {});
    });
    conn.on('data', (msg) => this._recvHost(msg, conn.peer));
    const drop = () => {
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.emit('peerLeft', conn.peer);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  async join(code, metadata = {}) {
    this.shutdown();
    code = code.trim().toUpperCase();
    const peer = new Peer(peerOptions());
    await withTimeout(new Promise((res, rej) => {
      peer.once('open', res);
      peer.once('error', rej);
    }), 12000, 'Could not reach the matchmaking server.');
    this.peer = peer;
    peer.on('call', (call) => this.emit('call', call));
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'binary', metadata });
    await withTimeout(new Promise((res, rej) => {
      conn.once('open', res);
      conn.once('error', rej);
      peer.once('error', (e) => rej(new Error(e?.type === 'peer-unavailable' ? 'No shift found with that code.' : String(e?.type || e))));
    }), 12000, 'No shift found with that code.');
    this.hostConn = conn;
    this.mode = 'client';
    this.selfId = peer.id;
    this.hostId = PREFIX + code;
    this.roomCode = code;
    conn.on('data', (msg) => {
      if (Array.isArray(msg) && msg[0] === 'full') {
        this.emit('disconnected', 'That shift is full (4/4 clones).');
        return;
      }
      this._recvClient(msg);
    });
    conn.on('close', () => this.emit('disconnected', 'Connection to host lost.'));
    peer.on('error', (e) => console.warn('[net] peer error', e?.type || e));
  }

  _recvHost(msg, from) {
    if (!Array.isArray(msg)) return;
    this.stats.recv++;
    const [type, data] = msg;
    if (type === '__relay') {
      // client -> host -> everyone (except sender)
      this.toOthers(data[0], data[1], from);
      const h = this.clientHandlers.get(data[0]);
      if (h) h(data[1], from);
      return;
    }
    const h = this.hostHandlers.get(type);
    if (h) {
      try { h(data, from); } catch (e) { console.error('[net] host handler', type, e); }
    }
  }

  _recvClient(msg) {
    if (!Array.isArray(msg)) return;
    this.stats.recv++;
    const [type, data, from] = msg;
    const h = this.clientHandlers.get(type);
    if (h) {
      try { h(data, from); } catch (e) { console.error('[net] client handler', type, e); }
    }
  }

  _send(conn, packet) {
    if (!conn || !conn.open) return;
    try {
      conn.send(packet);
      this.stats.sent++;
    } catch (e) { /* channel closing */ }
  }

  // --- API ---
  toHost(type, data) {
    if (this.mode === 'client') this._send(this.hostConn, [type, data]);
    else this._recvHost([type, data], this.selfId);
  }

  toAll(type, data, from) {
    if (this.mode === 'client') return;
    const packet = [type, data, from];
    for (const c of this.conns.values()) this._send(c, packet);
    const h = this.clientHandlers.get(type);
    if (h) {
      try { h(data, from); } catch (e) { console.error('[net] local client handler', type, e); }
    }
  }

  // host: send to clients except one (does not run locally)
  toOthers(type, data, exceptId) {
    if (this.mode === 'client') return;
    const packet = [type, data, exceptId];
    for (const [id, c] of this.conns) if (id !== exceptId) this._send(c, packet);
  }

  // host: send to remote clients only (not locally)
  toRemotes(type, data) {
    if (this.mode === 'client') return;
    const packet = [type, data];
    for (const c of this.conns.values()) this._send(c, packet);
  }

  toPeer(peerId, type, data) {
    if (this.mode === 'client') return;
    if (peerId === this.selfId) {
      const h = this.clientHandlers.get(type);
      if (h) h(data);
      return;
    }
    this._send(this.conns.get(peerId), [type, data]);
  }

  // client -> everyone else via host (e.g. cosmetic-only events)
  relay(type, data) {
    if (this.mode === 'client') this._send(this.hostConn, ['__relay', [type, data]]);
    else this.toAll(type, data, this.selfId);
  }

  kick(peerId) {
    const c = this.conns.get(peerId);
    if (c) c.close();
  }

  shutdown() {
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.hostConn) { try { this.hostConn.close(); } catch (e) { /* ignore */ } }
    this.hostConn = null;
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null;
    this.mode = 'offline';
    this.selfId = 'local';
    this.hostId = 'local';
    this.roomCode = null;
  }
}

export const net = new Net();
