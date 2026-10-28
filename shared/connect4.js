/**
 * Core Deterministic Connect 4 Game Engine
 * 7 columns x 6 rows (Row 0 is top, Row 5 is bottom)
 * Authoritative Host Model with Gravity & Win Verification
 */

export const ROWS = 6;
export const COLS = 7;
export const EMPTY = 0;
export const PLAYER_1 = 1; // Host / Red
export const PLAYER_2 = 2; // Guest / Yellow

export const GameState = {
  IDLE: 'IDLE',
  PAIRING: 'PAIRING',
  ACTIVE_TURN: 'ACTIVE_TURN',
  WAITING_TURN: 'WAITING_TURN',
  GAME_OVER: 'GAME_OVER'
};

export class Connect4Engine {
  constructor() {
    this.board = this.createEmptyBoard();
    this.currentTurn = PLAYER_1;
    this.moveCount = 0;
    this.history = [];
    this.winner = null;
    this.winningCells = [];
    this.isTie = false;
    this.state = GameState.IDLE;
  }

  createEmptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  }

  reset() {
    this.board = this.createEmptyBoard();
    this.currentTurn = PLAYER_1;
    this.moveCount = 0;
    this.history = [];
    this.winner = null;
    this.winningCells = [];
    this.isTie = false;
    this.state = GameState.IDLE;
  }

  canDrop(col) {
    if (this.winner || this.isTie) return false;
    if (col < 0 || col >= COLS) return false;
    return this.board[0][col] === EMPTY;
  }

  getValidColumns() {
    const valid = [];
    for (let c = 0; c < COLS; c++) {
      if (this.canDrop(c)) valid.push(c);
    }
    return valid;
  }

  getLowestEmptyRow(col) {
    if (col < 0 || col >= COLS) return -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r][col] === EMPTY) return r;
    }
    return -1;
  }

  dropPiece(col, player) {
    if (!this.canDrop(col)) {
      throw new Error(`Cannot drop piece in column ${col}`);
    }

    const row = this.getLowestEmptyRow(col);
    this.board[row][col] = player;
    this.moveCount++;
    this.history.push({ row, col, player, moveNumber: this.moveCount });

    const winResult = this.checkWin(row, col);
    if (winResult) {
      this.winner = winResult.winner;
      this.winningCells = winResult.cells;
      this.state = GameState.GAME_OVER;
    } else if (this.moveCount >= ROWS * COLS) {
      this.isTie = true;
      this.state = GameState.GAME_OVER;
    } else {
      this.currentTurn = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
    }

    return {
      row,
      col,
      player,
      winner: this.winner,
      winningCells: this.winningCells,
      isTie: this.isTie,
      moveCount: this.moveCount,
      nextTurn: this.currentTurn
    };
  }

  checkWin(lastRow, lastCol) {
    const player = this.board[lastRow][lastCol];
    if (player === EMPTY) return null;

    const directions = [
      { dr: 0, dc: 1 },  // Horizontal
      { dr: 1, dc: 0 },  // Vertical
      { dr: 1, dc: 1 },  // Diagonal Down-Right (\)
      { dr: 1, dc: -1 }  // Diagonal Down-Left (/)
    ];

    for (const { dr, dc } of directions) {
      const cells = [{ r: lastRow, c: lastCol }];

      // Count positive direction
      for (let step = 1; step < 4; step++) {
        const nr = lastRow + dr * step;
        const nc = lastCol + dc * step;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && this.board[nr][nc] === player) {
          cells.push({ r: nr, c: nc });
        } else {
          break;
        }
      }

      // Count negative direction
      for (let step = 1; step < 4; step++) {
        const nr = lastRow - dr * step;
        const nc = lastCol - dc * step;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && this.board[nr][nc] === player) {
          cells.push({ r: nr, c: nc });
        } else {
          break;
        }
      }

      if (cells.length >= 4) {
        return {
          winner: player,
          cells: cells.slice(0, 4)
        };
      }
    }

    return null;
  }

  serialize() {
    return {
      board: this.board.map(row => [...row]),
      currentTurn: this.currentTurn,
      moveCount: this.moveCount,
      winner: this.winner,
      winningCells: this.winningCells,
      isTie: this.isTie,
      state: this.state
    };
  }

  deserialize(data) {
    if (!data) return;
    this.board = data.board.map(row => [...row]);
    this.currentTurn = data.currentTurn;
    this.moveCount = data.moveCount || 0;
    this.winner = data.winner || null;
    this.winningCells = data.winningCells || [];
    this.isTie = !!data.isTie;
    this.state = data.state || GameState.IDLE;
  }
}
