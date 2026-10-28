# Connect 4 — Zero-Backend PWA Suite

A client-side Progressive Web App (PWA) suite for two-player Connect 4 with **zero custom backend**, running entirely in the browser and hosted on GitHub Pages.

Features three decentralized communication transports:
1. **Public MQTT (`/mqtt`)**: Single QR scan handshake, end-to-end encrypted with Web Crypto AES-256-GCM over public WebSocket brokers (`hivemq.com` / `emqx.io`).
2. **Nostr Relays (`/nostr`)**: Decentralized, censorship-resistant peer matching over open Nostr relays using Ephemeral in-memory events (Kind 20004) and AES-256-GCM.
3. **Ultrasonic Acoustic Modem (`/ultrasonic`)**: 100% offline, air-gapped gameplay using speaker and microphone acoustic FSK modulation (in near-ultrasonic 17.5–19.5 kHz or audible 8-bit arcade tones).

---

## Architecture & Directory Structure

```text
/
├── index.html                 # Root portal / variant selection screen
├── styles.css                 # Shared theme and landing styles
├── manifest.json              # Root PWA manifest
├── sw.js                      # Root service worker for offline asset caching
├── icons/
│   └── icon.svg               # Scalable vector app icon
├── shared/
│   ├── connect4.js            # Core deterministic game engine (7x6 board, gravity, win checking)
│   ├── ui-board.js            # Reusable DOM board renderer with bouncy drop physics
│   ├── audio-fx.js            # Procedural Web Audio API sound synthesis (drop, win, illegal, chimes)
│   └── qr.js                  # Pure-JS offline QR code generator & camera scanner
├── mqtt/
│   ├── index.html             # Public MQTT implementation
│   ├── mqtt-transport.js      # MQTT client + Web Crypto AES-GCM encryption layer
│   └── app.js                 # Glue code binding UI, game engine, and MQTT transport
├── nostr/
│   ├── index.html             # Nostr Relays implementation
│   ├── nostr-transport.js     # Multi-relay WebSocket pool + Kind 20004 ephemeral events
│   └── app.js                 # Glue code binding UI, game engine, and Nostr transport
└── ultrasonic/
    ├── index.html             # Acoustic / Ultrasonic modem implementation
    ├── modem.js               # Web Audio FSK modulator (speaker) & demodulator (mic)
    └── app.js                 # Glue code binding UI, game engine, and Acoustic transport
```

---

## Features

- **Zero Custom Backend**: All state is managed peer-to-peer using public protocols and client-side cryptography.
- **PWA & Offline-First**: Installed as a standalone app with offline asset caching via Service Worker.
- **Micro-Interactions & Audio**: Bouncy CSS physics drops, real-time frequency waterfall visualizer for acoustic signals, and procedural Web Audio chimes without external audio files.
- **Privacy & Security**: Game rooms and join keys are passed via URL hash fragments (`#room=...&key=...`), never leaked to HTTP request headers or server logs.
