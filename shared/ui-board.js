/**
 * Reusable Connect 4 Board Renderer with Bouncy Drop Physics & Animations
 */

import { ROWS, COLS, EMPTY, PLAYER_1, PLAYER_2 } from './connect4.js';
import { audioFx } from './audio-fx.js';

export class UIBoard {
  /**
   * @param {HTMLElement} container - The DOM container element to mount the board in
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onColumnClick = options.onColumnClick || (() => {});
    this.interactive = true;
    this.localPlayer = PLAYER_1; // The player role on this client
    this.activeTurn = PLAYER_1;  // Whose turn it currently is
    this.cells = [];             // 2D array [row][col] of DOM cell elements
    this.previewCol = null;

    this.mount();
  }

  mount() {
    this.container.innerHTML = '';
    this.container.classList.add('c4-board-wrapper');

    // Indicator / Preview row
    this.indicatorRow = document.createElement('div');
    this.indicatorRow.classList.add('c4-indicator-row');
    for (let c = 0; c < COLS; c++) {
      const slot = document.createElement('div');
      slot.classList.add('c4-indicator-slot');
      slot.dataset.col = c;
      this.indicatorRow.appendChild(slot);
    }
    this.container.appendChild(this.indicatorRow);

    // Main Board Grille
    this.boardEl = document.createElement('div');
    this.boardEl.classList.add('c4-board');
    this.boardEl.style.setProperty('--c4-cols', COLS);
    this.boardEl.style.setProperty('--c4-rows', ROWS);

    this.cells = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.classList.add('c4-cell');
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Inner hole & piece container
        const hole = document.createElement('div');
        hole.classList.add('c4-hole');
        cell.appendChild(hole);

        this.boardEl.appendChild(cell);
        this.cells[r][c] = cell;
      }
    }
    this.container.appendChild(this.boardEl);

    // Event listeners for user interaction
    this.setupEvents();
  }

  setupEvents() {
    // Column hover preview
    this.container.addEventListener('pointermove', (e) => {
      if (!this.interactive || this.localPlayer !== this.activeTurn) {
        this.clearPreview();
        return;
      }
      const target = e.target.closest('[data-col]');
      if (target) {
        const col = parseInt(target.dataset.col, 10);
        this.showPreview(col);
      }
    });

    this.container.addEventListener('pointerleave', () => {
      this.clearPreview();
    });

    // Column click / tap
    this.container.addEventListener('click', (e) => {
      if (!this.interactive) return;
      const target = e.target.closest('[data-col]');
      if (!target) return;
      const col = parseInt(target.dataset.col, 10);
      if (this.localPlayer !== this.activeTurn) {
        audioFx.playIllegal();
        return;
      }
      this.onColumnClick(col);
    });
  }

  showPreview(col) {
    if (this.previewCol === col) return;
    this.clearPreview();
    this.previewCol = col;

    const slots = this.indicatorRow.children;
    if (slots[col]) {
      const piece = document.createElement('div');
      piece.classList.add('c4-piece', `p${this.localPlayer}`, 'preview');
      slots[col].appendChild(piece);
    }
  }

  clearPreview() {
    this.previewCol = null;
    const slots = this.indicatorRow.children;
    for (const slot of slots) {
      slot.innerHTML = '';
    }
  }

  setInteractive(canPlay, localPlayer, activeTurn) {
    this.interactive = canPlay;
    this.localPlayer = localPlayer;
    this.activeTurn = activeTurn;
    this.container.classList.toggle('interactive', canPlay && localPlayer === activeTurn);
    if (!canPlay || localPlayer !== activeTurn) {
      this.clearPreview();
    }
  }

  /**
   * Animate a dropped piece into a slot
   */
  animateDrop(row, col, player, onComplete) {
    this.clearPreview();
    const cell = this.cells[row][col];
    const hole = cell.querySelector('.c4-hole');

    const piece = document.createElement('div');
    piece.classList.add('c4-piece', `p${player}`);

    // Compute vertical drop distance from indicator row
    const dropDistance = (row + 1) * 100; // in percentage of slot height
    piece.style.setProperty('--drop-distance', `-${dropDistance}%`);
    piece.classList.add('dropping');

    hole.innerHTML = '';
    hole.appendChild(piece);

    audioFx.playDrop(player);

    piece.addEventListener('animationend', () => {
      piece.classList.remove('dropping');
      if (onComplete) onComplete();
    }, { once: true });
  }

  /**
   * Render static board state without full drop animations
   */
  renderBoard(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = board[r][c];
        const cell = this.cells[r][c];
        const hole = cell.querySelector('.c4-hole');

        if (val === EMPTY) {
          hole.innerHTML = '';
        } else {
          // If piece already exists with correct player, preserve it
          const existing = hole.querySelector('.c4-piece');
          if (!existing || !existing.classList.contains(`p${val}`)) {
            hole.innerHTML = `<div class="c4-piece p${val}"></div>`;
          }
        }
      }
    }
  }

  /**
   * Highlight winning pieces
   */
  highlightWinningCells(winningCells) {
    if (!winningCells || winningCells.length === 0) return;
    for (const { r, c } of winningCells) {
      const cell = this.cells[r][c];
      const piece = cell.querySelector('.c4-piece');
      if (piece) {
        piece.classList.add('winner-pulse');
      }
    }
  }

  /**
   * Reset board visuals
   */
  clear() {
    this.clearPreview();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const hole = this.cells[r][c].querySelector('.c4-hole');
        hole.innerHTML = '';
      }
    }
  }
}
