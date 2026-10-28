/**
 * MQTT Transport Layer with Web Crypto AES-256-GCM End-to-End Encryption
 */

export class CryptoHelper {
  /**
   * Generate a 256-bit AES-GCM symmetric key
   */
  static async generateKey() {
    return await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Export CryptoKey to Base64 string for URL hash sharing
   */
  static async exportKey(key) {
    const raw = await window.crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Import CryptoKey from Base64 string
   */
  static async importKey(base64) {
    let str = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    return await window.crypto.subtle.importKey(
      'raw',
      bytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt an arbitrary JS object to { iv, data } Base64 strings
   */
  static async encrypt(obj, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(obj));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    return {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    };
  }

  /**
   * Decrypt { iv, data } Base64 strings back to JS object
   */
  static async decrypt(payload, key) {
    const iv = new Uint8Array(atob(payload.iv).split('').map(c => c.charCodeAt(0)));
    const cipherBytes = new Uint8Array(atob(payload.data).split('').map(c => c.charCodeAt(0)));

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  }
}

export class MQTTTransport {
  constructor(options = {}) {
    this.brokers = [
      'wss://broker.hivemq.com:8884/mqtt',
      'wss://broker.emqx.io:8084/mqtt'
    ];
    this.currentBrokerIndex = 0;
    this.client = null;
    this.roomId = null;
    this.sharedKey = null;
    this.isHost = false;

    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onLatency = options.onLatency || (() => {});
    this.onError = options.onError || (() => {});

    this.pingInterval = null;
  }

  async init(roomId, sharedKey, isHost) {
    this.roomId = roomId;
    this.sharedKey = sharedKey;
    this.isHost = isHost;

    await this.connectToBroker();
  }

  connectToBroker() {
    return new Promise((resolve, reject) => {
      if (!window.mqtt) {
        reject(new Error('MQTT.js library not loaded'));
        return;
      }

      const brokerUrl = this.brokers[this.currentBrokerIndex];
      const clientId = `c4_${this.isHost ? 'h' : 'g'}_${Math.random().toString(16).slice(2, 8)}`;

      console.log(`[MQTT] Connecting to ${brokerUrl} as ${clientId}...`);
      this.client = window.mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000
      });

      this.client.on('connect', () => {
        console.log('[MQTT] Connected successfully to broker');
        this.setupSubscriptions();
        this.startPingLoop();
        this.onConnected();
        resolve();
      });

      this.client.on('message', async (topic, messageBuffer) => {
        try {
          const raw = JSON.parse(messageBuffer.toString());
          if (!raw.iv || !raw.data) return;

          const decrypted = await CryptoHelper.decrypt(raw, this.sharedKey);

          // Handle internal ping/pong
          if (decrypted.type === '_PING') {
            this.send({ type: '_PONG', time: decrypted.time });
            return;
          } else if (decrypted.type === '_PONG') {
            const rtt = Date.now() - decrypted.time;
            this.onLatency(Math.round(rtt / 2));
            return;
          }

          this.onMessage(decrypted);
        } catch (err) {
          console.warn('[MQTT] Failed to decrypt or parse incoming message:', err);
        }
      });

      this.client.on('error', (err) => {
        console.error('[MQTT] Connection error:', err);
        this.onError(err);
      });

      this.client.on('close', () => {
        this.onDisconnected();
      });
    });
  }

  setupSubscriptions() {
    if (!this.client || !this.roomId) return;
    // Both peers subscribe to the room channel
    const topic = `c4/games/${this.roomId}/#`;
    this.client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscription error:', err);
      else console.log('[MQTT] Subscribed to:', topic);
    });
  }

  async send(data) {
    if (!this.client || !this.client.connected || !this.sharedKey) return;

    try {
      // Add sender role flag to ignore echo
      const payload = { ...data, _sender: this.isHost ? 'host' : 'guest' };
      const encrypted = await CryptoHelper.encrypt(payload, this.sharedKey);
      const subtopic = this.isHost ? 'host' : 'guest';
      const topic = `c4/games/${this.roomId}/${subtopic}`;

      this.client.publish(topic, JSON.stringify(encrypted), { qos: 1 });
    } catch (err) {
      console.error('[MQTT] Failed to encrypt & publish:', err);
    }
  }

  startPingLoop() {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      if (this.client && this.client.connected) {
        this.send({ type: '_PING', time: Date.now() });
      }
    }, 5000);
  }

  stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  destroy() {
    this.stopPingLoop();
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  }
}
