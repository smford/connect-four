/**
 * Nostr Decentralized Transport Layer
 * Uses ephemeral events (Kind 20004) across public Nostr relay pool
 * Content encrypted end-to-end via Web Crypto AES-256-GCM
 */

import { CryptoHelper } from '../mqtt/mqtt-transport.js';

export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social'
];

export const NOSTR_KIND_CONNECT4 = 20004;

export class NostrTransport {
  constructor(options = {}) {
    this.relays = options.relays || NOSTR_RELAYS;
    this.sockets = new Map(); // relayUrl -> WebSocket
    this.roomId = null;
    this.sharedKey = null;
    this.isHost = false;
    this.secretKey = null;
    this.publicKey = null;
    this.subId = `c4_sub_${Math.random().toString(36).slice(2, 8)}`;
    this.seenEvents = new Set();

    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onRelayStatus = options.onRelayStatus || (() => {});

    this.nostrTools = null;
  }

  async init(roomId, sharedKey, isHost) {
    this.roomId = roomId;
    this.sharedKey = sharedKey;
    this.isHost = isHost;

    // Load nostr-tools dynamically if available
    try {
      this.nostrTools = await import('https://cdn.jsdelivr.net/npm/nostr-tools@2.7.2/+esm');
      this.secretKey = this.nostrTools.generateSecretKey();
      this.publicKey = this.nostrTools.getPublicKey(this.secretKey);
    } catch (e) {
      console.warn('Dynamic nostr-tools import fallback:', e);
      // Fallback random 32-byte hex key
      const randBytes = window.crypto.getRandomValues(new Uint8Array(32));
      this.secretKey = randBytes;
      this.publicKey = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    this.connectRelays();
  }

  connectRelays() {
    let connectedCount = 0;

    for (const relayUrl of this.relays) {
      try {
        const ws = new WebSocket(relayUrl);

        ws.onopen = () => {
          console.log(`[Nostr] Connected to relay: ${relayUrl}`);
          this.sockets.set(relayUrl, ws);
          connectedCount++;
          this.onRelayStatus(relayUrl, true);
          if (connectedCount === 1) {
            this.onConnected();
          }
          this.subscribeRelay(ws);
        };

        ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            const [type, subId, nostrEvent] = data;

            if (type === 'EVENT' && nostrEvent) {
              if (this.seenEvents.has(nostrEvent.id)) return;
              this.seenEvents.add(nostrEvent.id);

              // Ignore own events
              if (nostrEvent.pubkey === this.publicKey) return;

              // Check roomId tag
              const roomTag = (nostrEvent.tags || []).find(t => t[0] === 'r');
              if (!roomTag || roomTag[1] !== this.roomId) return;

              // Decrypt content
              const rawPayload = JSON.parse(nostrEvent.content);
              const decrypted = await CryptoHelper.decrypt(rawPayload, this.sharedKey);

              this.onMessage(decrypted);
            }
          } catch (err) {
            // Non-game message or decrypt failure
          }
        };

        ws.onclose = () => {
          this.sockets.delete(relayUrl);
          this.onRelayStatus(relayUrl, false);
          if (this.sockets.size === 0) {
            this.onDisconnected();
          }
        };

        ws.onerror = (e) => {
          console.warn(`[Nostr] Relay error on ${relayUrl}:`, e);
        };
      } catch (err) {
        console.warn(`[Nostr] Failed to initiate connection to ${relayUrl}:`, err);
      }
    }
  }

  subscribeRelay(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const filter = {
      kinds: [NOSTR_KIND_CONNECT4],
      '#r': [this.roomId],
      since: Math.floor(Date.now() / 1000) - 30
    };
    const reqMessage = JSON.stringify(['REQ', this.subId, filter]);
    ws.send(reqMessage);
  }

  async send(data) {
    if (!this.sharedKey || this.sockets.size === 0) return;

    try {
      const payload = { ...data, _sender: this.isHost ? 'host' : 'guest' };
      const encrypted = await CryptoHelper.encrypt(payload, this.sharedKey);

      let eventObj = {
        kind: NOSTR_KIND_CONNECT4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['r', this.roomId],
          ['p', this.isHost ? 'guest' : 'host']
        ],
        content: JSON.stringify(encrypted)
      };

      if (this.nostrTools && this.nostrTools.finalizeEvent) {
        eventObj = this.nostrTools.finalizeEvent(eventObj, this.secretKey);
      } else {
        // Fallback event format with sha256 id
        eventObj.pubkey = this.publicKey;
        const serialized = JSON.stringify([0, eventObj.pubkey, eventObj.created_at, eventObj.kind, eventObj.tags, eventObj.content]);
        const hashBuf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
        eventObj.id = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        eventObj.sig = '0'.repeat(128); // ephemeral sig placeholder if nostr-tools is offline
      }

      this.seenEvents.add(eventObj.id);

      const publishMessage = JSON.stringify(['EVENT', eventObj]);
      for (const [url, ws] of this.sockets.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(publishMessage);
        }
      }
    } catch (err) {
      console.error('[Nostr] Failed to send event:', err);
    }
  }

  destroy() {
    for (const [url, ws] of this.sockets.entries()) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', this.subId]));
          ws.close();
        }
      } catch (e) {}
    }
    this.sockets.clear();
  }
}
