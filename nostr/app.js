/**
 * Connect 4 Nostr Relays Application Coordinator
 */

import { Connect4Engine, PLAYER_1, PLAYER_2 } from '../shared/connect4.js';
import { UIBoard } from '../shared/ui-board.js';
import { audioFx } from '../shared/audio-fx.js';
import { generateQRSVG, QRScannerController, copyToClipboard } from '../shared/qr.js';
import { CryptoHelper } from '../mqtt/mqtt-transport.js';
import { NostrTransport, NOSTR_RELAYS } from './nostr-transport.js';

class NostrApp {
  constructor() {
    this.engine = new Connect4Engine();
    this.board = null;
    this.transport = null;
    this.localPlayer = null;
    this.isHost = false;
    this.peerConnected = false;
    this.scanner = null;
    this.relayStatuses = new Map();

    this.cacheElements();
    this.initBoard();
    this.parseURLHash();
  }

  cacheElements() {
    this.hudEl = document.getElementById('game-hud');
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.turnBanner = document.getElementById('turn-banner');
    this.localRoleBadge = document.getElementById('local-role-badge');
    this.boardContainer = document.getElementById('board-container');
    this.lobbyControls = document.getElementById('lobby-controls');
    this.gameControls = document.getElementById('game-controls');

    this.btnHost = document.getElementById('btn-host');
    this.btnScan = document.getElementById('btn-scan');
    this.btnRematch = document.getElementById('btn-rematch');
    this.btnLeave = document.getElementById('btn-leave');

    // Modals
    this.qrModal = document.getElementById('qr-modal');
    this.qrBox = document.getElementById('qr-box');
    this.qrClose = document.getElementById('qr-close');
    this.btnCopyLink = document.getElementById('btn-copy-link');

    this.scannerModal = document.getElementById('scanner-modal');
    this.scannerVideo = document.getElementById('scanner-video');
    this.scannerClose = document.getElementById('scanner-close');

    this.toastEl = document.getElementById('toast');

    // Sound toggle
    this.btnSound = document.getElementById('btn-sound');
    this.btnSound.textContent = audioFx.isMuted ? '🔇' : '🔊';
    this.btnSound.addEventListener('click', () => {
      const muted = audioFx.toggleMute();
      this.btnSound.textContent = muted ? '🔇' : '🔊';
      if (!muted) audioFx.playClick();
    });

    this.setupLobbyEvents();
  }

  initBoard() {
    this.board = new UIBoard(this.boardContainer, {
      onColumnClick: (col) => this.handleLocalColumnClick(col)
    });
    this.board.setInteractive(false, PLAYER_1, PLAYER_1);
  }

  setupLobbyEvents() {
    this.btnHost.addEventListener('click', () => this.startHost());
    this.btnScan.addEventListener('click', () => this.startScanner());
    this.scannerClose.addEventListener('click', () => this.stopScanner());
    this.qrClose.addEventListener('click', () => this.qrModal.classList.remove('active'));

    this.btnCopyLink.addEventListener('click', async () => {
      audioFx.playClick();
      const success = await copyToClipboard(this.joinUrl);
      this.showToast(success ? 'Invite link copied!' : 'Failed to copy link');
    });

    this.btnRematch.addEventListener('click', () => {
      audioFx.playClick();
      if (this.isHost) {
        this.engine.reset();
        this.board.clear();
        this.updateTurnUI();
        this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
        this.transport.send({
          type: 'RESTART',
          state: this.engine.serialize()
        });
      } else {
        this.transport.send({ type: 'RESTART_REQUEST' });
        this.showToast('Rematch request sent to host');
      }
    });

    this.btnLeave.addEventListener('click', () => {
      audioFx.playClick();
      window.location.hash = '';
      window.location.reload();
    });
  }

  showToast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    setTimeout(() => this.toastEl.classList.remove('show'), 2500);
  }

  async parseURLHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const roomId = params.get('room');
    const keyStr = params.get('key');

    if (roomId && keyStr) {
      try {
        const key = await CryptoHelper.importKey(keyStr);
        await this.startGuest(roomId, key);
      } catch (err) {
        console.error('Failed to parse Nostr join link:', err);
        this.showToast('Invalid invite link');
      }
    }
  }

  async startHost() {
    audioFx.playClick();
    this.isHost = true;
    this.localPlayer = PLAYER_1;
    this.localRoleBadge.textContent = 'You: Player 1 (Red)';

    const roomId = 'nostr-c4-' + Math.random().toString(36).substring(2, 8);
    const key = await CryptoHelper.generateKey();
    const keyExport = await CryptoHelper.exportKey(key);

    const baseUrl = window.location.href.split('#')[0];
    this.joinUrl = `${baseUrl}#room=${roomId}&key=${keyExport}`;

    this.qrBox.innerHTML = generateQRSVG(this.joinUrl);
    this.qrModal.classList.add('active');

    await this.initTransport(roomId, key);
    this.updateStatus('connecting', 'Waiting for Player 2 to join...');
  }

  async startGuest(roomId, key) {
    this.isHost = false;
    this.localPlayer = PLAYER_2;
    this.localRoleBadge.textContent = 'You: Player 2 (Yellow)';

    this.lobbyControls.style.display = 'none';
    this.gameControls.style.display = 'flex';

    await this.initTransport(roomId, key);
    this.updateStatus('connecting', 'Connecting to Nostr relays...');

    setTimeout(() => {
      this.transport.send({ type: 'GUEST_JOIN' });
    }, 1000);
  }

  async initTransport(roomId, key) {
    this.transport = new NostrTransport({
      relays: NOSTR_RELAYS,
      onConnected: () => {
        if (!this.peerConnected) {
          this.updateStatus('connecting', this.isHost ? 'Relays ready, awaiting peer...' : 'Relays connected...');
        }
      },
      onDisconnected: () => {
        this.updateStatus('disconnected', 'Disconnected from relays');
      },
      onRelayStatus: (url, isUp) => {
        this.relayStatuses.set(url, isUp);
        const count = Array.from(this.relayStatuses.values()).filter(Boolean).length;
        if (this.peerConnected) {
          this.statusText.textContent = `Connected (${count}/${NOSTR_RELAYS.length} Relays)`;
        }
      },
      onMessage: (msg) => this.handleTransportMessage(msg)
    });

    await this.transport.init(roomId, key, this.isHost);
  }

  handleTransportMessage(msg) {
    if (this.isHost) {
      if (msg.type === 'GUEST_JOIN') {
        this.onPeerJoined();
        this.transport.send({
          type: 'HOST_WELCOME',
          state: this.engine.serialize()
        });
      } else if (msg.type === 'MOVE_INTENT') {
        this.handleGuestMoveIntent(msg.col);
      } else if (msg.type === 'RESTART_REQUEST') {
        this.engine.reset();
        this.board.clear();
        this.updateTurnUI();
        this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
        this.transport.send({
          type: 'RESTART',
          state: this.engine.serialize()
        });
        audioFx.playConnect();
      }
    } else {
      if (msg.type === 'HOST_WELCOME') {
        this.onPeerJoined();
        this.engine.deserialize(msg.state);
        this.board.renderBoard(this.engine.board);
        this.updateTurnUI();
        this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
      } else if (msg.type === 'STATE_SYNC') {
        this.applyHostStateSync(msg);
      } else if (msg.type === 'RESTART') {
        this.engine.deserialize(msg.state);
        this.board.clear();
        this.updateTurnUI();
        this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
        audioFx.playConnect();
      }
    }
  }

  onPeerJoined() {
    this.peerConnected = true;
    this.qrModal.classList.remove('active');
    this.lobbyControls.style.display = 'none';
    this.gameControls.style.display = 'flex';
    this.updateStatus('connected', 'Connected (Nostr Relays)');
    audioFx.playConnect();

    this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
    this.updateTurnUI();
  }

  handleLocalColumnClick(col) {
    if (!this.engine.canDrop(col)) {
      audioFx.playIllegal();
      return;
    }

    if (this.isHost) {
      const dropResult = this.engine.dropPiece(col, PLAYER_1);
      this.board.animateDrop(dropResult.row, dropResult.col, PLAYER_1, () => {
        this.onMoveFinished(dropResult);
      });

      this.transport.send({
        type: 'STATE_SYNC',
        state: this.engine.serialize(),
        lastDrop: dropResult
      });
      this.updateTurnUI();
      this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);
    } else {
      this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);
      this.transport.send({
        type: 'MOVE_INTENT',
        col
      });
    }
  }

  handleGuestMoveIntent(col) {
    if (!this.engine.canDrop(col) || this.engine.currentTurn !== PLAYER_2) {
      return;
    }

    const dropResult = this.engine.dropPiece(col, PLAYER_2);
    this.board.animateDrop(dropResult.row, dropResult.col, PLAYER_2, () => {
      this.onMoveFinished(dropResult);
    });

    this.transport.send({
      type: 'STATE_SYNC',
      state: this.engine.serialize(),
      lastDrop: dropResult
    });
    this.updateTurnUI();
    this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
  }

  applyHostStateSync(msg) {
    const { state, lastDrop } = msg;
    this.engine.deserialize(state);

    if (lastDrop) {
      this.board.animateDrop(lastDrop.row, lastDrop.col, lastDrop.player, () => {
        this.onMoveFinished(lastDrop);
      });
    } else {
      this.board.renderBoard(this.engine.board);
      this.updateTurnUI();
    }

    this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
    this.updateTurnUI();
  }

  onMoveFinished(result) {
    if (result.winner) {
      this.board.highlightWinningCells(result.winningCells);
      if (result.winner === this.localPlayer) {
        audioFx.playWin();
        this.turnBanner.className = 'turn-banner win';
        this.turnBanner.textContent = '🎉 You Won!';
      } else {
        this.turnBanner.className = 'turn-banner loss';
        this.turnBanner.textContent = 'Opponent Won!';
      }
      this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);
    } else if (result.isTie) {
      this.turnBanner.className = 'turn-banner tie';
      this.turnBanner.textContent = "It's a Tie Game!";
      this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);
    }
  }

  updateTurnUI() {
    if (this.engine.winner || this.engine.isTie) return;

    if (this.engine.currentTurn === this.localPlayer) {
      this.turnBanner.className = 'turn-banner my-turn';
      this.turnBanner.textContent = '👉 Your Turn!';
      this.board.setInteractive(true, this.localPlayer, this.engine.currentTurn);
    } else {
      this.turnBanner.className = 'turn-banner opp-turn';
      this.turnBanner.textContent = "Waiting for Opponent's Move...";
      this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);
    }
  }

  updateStatus(state, text) {
    this.statusDot.className = `status-dot ${state}`;
    this.statusText.textContent = text;
  }

  async startScanner() {
    audioFx.playClick();
    this.scannerModal.classList.add('active');
    try {
      this.scanner = new QRScannerController(this.scannerVideo, (code) => {
        audioFx.playConnect();
        this.stopScanner();
        window.location.href = code;
        window.location.reload();
      });
      await this.scanner.start();
    } catch (err) {
      this.stopScanner();
      const code = prompt('Camera unavailable. Paste the Nostr join URL here:');
      if (code) {
        window.location.href = code;
        window.location.reload();
      }
    }
  }

  stopScanner() {
    if (this.scanner) {
      this.scanner.stop();
      this.scanner = null;
    }
    this.scannerModal.classList.remove('active');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new NostrApp();
});
