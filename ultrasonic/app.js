/**
 * Connect 4 Ultrasonic / Acoustic Modem Application Coordinator
 * 100% Offline, Air-Gapped PWA Communication
 */

import { Connect4Engine, PLAYER_1, PLAYER_2 } from '../shared/connect4.js';
import { UIBoard } from '../shared/ui-board.js';
import { audioFx } from '../shared/audio-fx.js';
import { AcousticModem, MODEM_MODES } from './modem.js';

class UltrasonicApp {
  constructor() {
    this.engine = new Connect4Engine();
    this.board = null;
    this.modem = null;
    this.localPlayer = null;
    this.turnCounter = 0;
    this.lastLocalMove = null;

    this.cacheElements();
    this.initBoard();
    this.initModem();
  }

  cacheElements() {
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.turnBanner = document.getElementById('turn-banner');
    this.localRoleBadge = document.getElementById('local-role-badge');
    this.boardContainer = document.getElementById('board-container');
    this.roleSelection = document.getElementById('role-selection');
    this.gameControls = document.getElementById('game-controls');

    this.btnP1 = document.getElementById('btn-p1');
    this.btnP2 = document.getElementById('btn-p2');
    this.btnResend = document.getElementById('btn-resend');
    this.btnRematch = document.getElementById('btn-rematch');
    this.btnLeave = document.getElementById('btn-leave');
    this.toastEl = document.getElementById('toast');

    // Modem Controls
    this.btnModeToggle = document.getElementById('btn-mode-toggle');
    this.waterfallCanvas = document.getElementById('waterfall-canvas');
    this.waterfallCtx = this.waterfallCanvas.getContext('2d');
    this.txStatusEl = document.getElementById('tx-status');

    // Sound toggle
    this.btnSound = document.getElementById('btn-sound');
    this.btnSound.textContent = audioFx.isMuted ? '🔇' : '🔊';
    this.btnSound.addEventListener('click', () => {
      const muted = audioFx.toggleMute();
      this.btnSound.textContent = muted ? '🔇' : '🔊';
      if (!muted) audioFx.playClick();
    });

    this.setupEvents();
  }

  initBoard() {
    this.board = new UIBoard(this.boardContainer, {
      onColumnClick: (col) => this.handleLocalDrop(col)
    });
    this.board.setInteractive(false, PLAYER_1, PLAYER_1);
  }

  initModem() {
    this.modem = new AcousticModem({
      mode: MODEM_MODES.ULTRASONIC,
      onTxStart: () => {
        this.txStatusEl.textContent = '🔊 Transmitting Move over Sound...';
        this.txStatusEl.style.color = '#38bdf8';
      },
      onTxEnd: () => {
        this.txStatusEl.textContent = '👂 Listening for Inbound Acoustic Signals...';
        this.txStatusEl.style.color = '#34d399';
      },
      onRxSignal: (freqData, analyser) => this.drawWaterfall(freqData, analyser),
      onPacketReceived: (packet) => this.handleInboundPacket(packet)
    });
  }

  setupEvents() {
    this.btnP1.addEventListener('click', () => this.selectPlayerRole(PLAYER_1));
    this.btnP2.addEventListener('click', () => this.selectPlayerRole(PLAYER_2));

    this.btnModeToggle.addEventListener('click', () => {
      audioFx.playClick();
      const newMode = this.modem.mode === MODEM_MODES.ULTRASONIC
        ? MODEM_MODES.AUDIBLE
        : MODEM_MODES.ULTRASONIC;
      this.modem.setMode(newMode);
      this.btnModeToggle.textContent = newMode === MODEM_MODES.ULTRASONIC
        ? 'Mode: Near-Ultrasonic (Silent)'
        : 'Mode: Audible Arcade (8-bit)';
    });

    this.btnResend.addEventListener('click', async () => {
      if (!this.lastLocalMove || this.modem.isTransmitting) return;
      audioFx.playClick();
      this.btnResend.disabled = true;
      this.btnResend.style.opacity = '0.6';
      this.showToast(`Resending Move (Col ${this.lastLocalMove.col + 1})...`);

      try {
        await this.modem.transmit({
          type: 0, // MOVE
          player: this.lastLocalMove.player,
          col: this.lastLocalMove.col,
          counter: this.lastLocalMove.counter
        });
        this.showToast('Last move sound resent!');
      } catch (err) {
        console.error('Failed to resend move:', err);
      } finally {
        this.btnResend.disabled = false;
        this.btnResend.style.opacity = '1';
      }
    });

    this.btnRematch.addEventListener('click', async () => {
      audioFx.playClick();
      this.engine.reset();
      this.board.clear();
      this.lastLocalMove = null;
      if (this.btnResend) this.btnResend.style.display = 'none';
      this.updateTurnUI();

      // Transmit restart packet
      await this.modem.transmit({
        type: 2, // RESTART
        player: this.localPlayer,
        col: 0,
        counter: 0
      });
    });

    this.btnLeave.addEventListener('click', () => {
      audioFx.playClick();
      this.modem.stopListening();
      window.location.reload();
    });
  }

  async selectPlayerRole(player) {
    audioFx.playClick();
    this.localPlayer = player;
    this.localRoleBadge.textContent = player === PLAYER_1
      ? 'You: Player 1 (Red)'
      : 'You: Player 2 (Yellow)';

    this.roleSelection.style.display = 'none';
    this.gameControls.style.display = 'flex';

    try {
      await this.modem.startListening();
      this.statusDot.className = 'status-dot connected';
      this.statusText.textContent = 'Acoustic Modem Active';
      this.txStatusEl.textContent = '👂 Listening for Inbound Acoustic Signals...';
      audioFx.playConnect();
    } catch (err) {
      alert('Microphone permission is required for air-gapped acoustic modem communication.');
      this.statusDot.className = 'status-dot disconnected';
      this.statusText.textContent = 'Microphone Denied';
      return;
    }

    this.updateTurnUI();
  }

  async handleLocalDrop(col) {
    if (!this.engine.canDrop(col)) {
      audioFx.playIllegal();
      return;
    }

    // Disable interaction while transmitting
    this.board.setInteractive(false, this.localPlayer, this.engine.currentTurn);

    const dropResult = this.engine.dropPiece(col, this.localPlayer);
    this.board.animateDrop(dropResult.row, dropResult.col, this.localPlayer, () => {
      this.onMoveFinished(dropResult);
    });

    this.updateTurnUI();

    // Save last local move for resend if opponent missed the acoustic signal
    this.turnCounter = (this.turnCounter + 1) % 4;
    this.lastLocalMove = {
      col,
      player: this.localPlayer,
      counter: this.turnCounter
    };
    if (this.btnResend) {
      this.btnResend.style.display = 'inline-flex';
    }

    // Transmit move over acoustic modem
    await this.modem.transmit({
      type: 0, // MOVE
      player: this.localPlayer,
      col,
      counter: this.turnCounter
    });
  }

  handleInboundPacket(packet) {
    if (packet.type === 0) {
      // Incoming Move from opponent
      if (packet.player === this.localPlayer) {
        // Echo of own move, ignore
        return;
      }

      // If opponent resent their move but we already processed it, ignore duplicate
      if (this.engine.currentTurn !== packet.player) {
        console.log('[Modem] Received move for player', packet.player, 'but currentTurn is', this.engine.currentTurn, '- duplicate resend ignored.');
        this.showToast('Opponent resent move (already applied)');
        return;
      }

      if (!this.engine.canDrop(packet.col)) {
        console.warn('Inbound acoustic move is invalid for column:', packet.col);
        return;
      }

      const dropResult = this.engine.dropPiece(packet.col, packet.player);
      this.board.animateDrop(dropResult.row, dropResult.col, packet.player, () => {
        this.onMoveFinished(dropResult);
      });

      this.updateTurnUI();
    } else if (packet.type === 2) {
      // Incoming Rematch
      this.engine.reset();
      this.board.clear();
      this.lastLocalMove = null;
      if (this.btnResend) this.btnResend.style.display = 'none';
      this.updateTurnUI();
      audioFx.playConnect();
    }
  }

  showToast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    setTimeout(() => this.toastEl.classList.remove('show'), 2500);
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

  drawWaterfall(freqData) {
    const canvas = this.waterfallCanvas;
    const ctx = this.waterfallCtx;
    const w = canvas.width;
    const h = canvas.height;

    // Shift previous frame down by 2px (waterfall roll)
    ctx.drawImage(canvas, 0, 0, w, h - 2, 0, 2, w, h - 2);

    // Draw new top scanline
    const barWidth = w / freqData.length;
    for (let i = 0; i < freqData.length; i++) {
      const val = freqData[i];
      if (val > 15) {
        const hue = (val / 255) * 280; // Blue to Red/Magenta
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(i * barWidth, 0, barWidth + 1, 2);
      } else {
        ctx.fillStyle = '#060b18';
        ctx.fillRect(i * barWidth, 0, barWidth + 1, 2);
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new UltrasonicApp();
});
