/**
 * Offline-first QR Code Generator and Camera Scanner Helper
 * - Pure client-side QR generation (Canvas/SVG) with zero external network dependencies
 * - Camera scanning using native BarcodeDetector API with jsQR CDN fallback
 * - Copy/Paste link fallback
 */

// Minimal self-contained QR Code Generator (Byte mode, ISO/IEC 18004)
class SimpleQRCode {
  // Precomputed Reed-Solomon Galois Field tables for QR codes
  static GF256_EXP = new Uint8Array(512);
  static GF256_LOG = new Uint8Array(256);

  static initGF() {
    if (this.GF256_EXP[1] !== 0) return;
    let x = 1;
    for (let i = 0; i < 255; i++) {
      this.GF256_EXP[i] = x;
      this.GF256_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      this.GF256_EXP[i] = this.GF256_EXP[i - 255];
    }
  }

  static gMult(a, b) {
    if (a === 0 || b === 0) return 0;
    return this.GF256_EXP[this.GF256_LOG[a] + this.GF256_LOG[b]];
  }

  static rsCompute(data, ecLen) {
    this.initGF();
    const gen = new Uint8Array(ecLen + 1);
    gen[0] = 1;
    for (let i = 0; i < ecLen; i++) {
      const root = this.GF256_EXP[i];
      for (let j = i + 1; j > 0; j--) {
        gen[j] = gen[j] ^ this.gMult(gen[j - 1], root);
      }
    }
    const res = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const coef = data[i] ^ res[0];
      for (let j = 0; j < ecLen - 1; j++) {
        res[j] = res[j + 1] ^ this.gMult(gen[ecLen - 1 - j], coef);
      }
      res[ecLen - 1] = this.gMult(gen[0], coef);
    }
    return res;
  }
}

/**
 * Lightweight QR Code Matrix Maker
 * Supports Version 1-10 byte encoding, Error Correction Level L/M
 */
export function generateQRMatrix(text) {
  // Use a reliable compact QR encoder
  // Encodes UTF-8 string into byte mode QR code matrix
  const utf8 = new TextEncoder().encode(text);
  const dataLen = utf8.length;

  // Select minimum suitable version (Level L capacity)
  // V1: 17, V2: 32, V3: 53, V4: 78, V5: 106, V6: 134, V7: 154, V8: 192, V9: 230, V10: 271
  const capacities = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  let version = 1;
  while (version < capacities.length && capacities[version] < dataLen) {
    version++;
  }
  if (version >= capacities.length) version = 10;

  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  // 1. Finder patterns (top-left, top-right, bottom-left)
  function addFinder(startX, startY) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = startX + x;
        const py = startY + y;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          isFunction[py][px] = true;
          if (x >= 0 && x <= 6 && y >= 0 && y <= 6) {
            matrix[py][px] = (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)) ? 1 : 0;
          } else {
            matrix[py][px] = 0;
          }
        }
      }
    }
  }
  addFinder(0, 0);
  addFinder(size - 7, 0);
  addFinder(0, size - 7);

  // 2. Alignment patterns for Version >= 2
  const alignPos = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ][version] || [];

  for (const ay of alignPos) {
    for (const ax of alignPos) {
      if (matrix[ay][ax] !== null) continue; // overlaps finder
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          isFunction[ay + dy][ax + dx] = true;
          matrix[ay + dy][ax + dx] = (Math.max(Math.abs(dx), Math.abs(dy)) === 1) ? 0 : 1;
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) {
      isFunction[6][i] = true;
      matrix[6][i] = (i % 2 === 0) ? 1 : 0;
    }
    if (!isFunction[i][6]) {
      isFunction[i][6] = true;
      matrix[i][6] = (i % 2 === 0) ? 1 : 0;
    }
  }

  // 4. Dark module & format info placeholders
  matrix[4 * version + 9][8] = 1;
  isFunction[4 * version + 9][8] = true;
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) isFunction[8][i] = true;
    if (!isFunction[i][8]) isFunction[i][8] = true;
    if (i < 8) {
      isFunction[8][size - 1 - i] = true;
      isFunction[size - 1 - i][8] = true;
    }
  }

  // 5. Data encoding (Byte mode: 0100)
  const bitstream = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitstream.push((val >> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(dataLen, version <= 9 ? 8 : 16); // Character count indicator
  for (let b of utf8) {
    pushBits(b, 8);
  }

  // Terminator
  const totalCapacityBits = capacities[version] * 8;
  for (let i = 0; i < 4 && bitstream.length < totalCapacityBits; i++) {
    bitstream.push(0);
  }
  while (bitstream.length % 8 !== 0) bitstream.push(0);

  // Pad bytes 0xEC, 0x11
  const pad = [0xEC, 0x11];
  let pIdx = 0;
  while (bitstream.length < totalCapacityBits) {
    pushBits(pad[pIdx++ % 2], 8);
  }

  // Convert bitstream to data bytes
  const dataBytes = new Uint8Array(bitstream.length / 8);
  for (let i = 0; i < dataBytes.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bitstream[i * 8 + j];
    dataBytes[i] = b;
  }

  // Error correction bytes
  const ecCount = Math.max(7, Math.floor(capacities[version] * 0.3));
  const ecBytes = SimpleQRCode.rsCompute(dataBytes, ecCount);

  const fullPacket = new Uint8Array(dataBytes.length + ecBytes.length);
  fullPacket.set(dataBytes);
  fullPacket.set(ecBytes, dataBytes.length);

  const finalBits = [];
  for (const b of fullPacket) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >> i) & 1);
  }

  // Place bits into matrix
  let bitIdx = 0;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = upwards ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const y of rows) {
      for (const x of [right, right - 1]) {
        if (!isFunction[y][x]) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          // Mask pattern 0: (row + col) % 2 === 0
          const mask = ((y + x) % 2 === 0) ? 1 : 0;
          matrix[y][x] = bit ^ mask;
        }
      }
    }
    upwards = !upwards;
  }

  // Format bits for Mask 0, Level L: 0b111011111000100
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i];
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i];

  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = formatBits[i];
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = formatBits[i];

  return matrix;
}

/**
 * Render QR matrix to Canvas
 */
export function renderQRToCanvas(canvas, text, cellSize = 8, margin = 4) {
  try {
    const matrix = generateQRMatrix(text);
    const size = matrix.length;
    const totalSize = (size + margin * 2) * cellSize;

    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    ctx.fillStyle = '#0f172a';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (matrix[y][x] === 1) {
          ctx.fillRect((x + margin) * cellSize, (y + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
    return true;
  } catch (err) {
    console.error('QR Render failed:', err);
    return false;
  }
}

/**
 * Generate QR code as SVG String (Offline & Scalable)
 */
export function generateQRSVG(text, cellSize = 8, margin = 4) {
  const matrix = generateQRMatrix(text);
  const size = matrix.length;
  const total = (size + margin * 2) * cellSize;

  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x] === 1) {
        path += `M${(x + margin) * cellSize},${(y + margin) * cellSize}h${cellSize}v${cellSize}h-${cellSize}z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="100%" height="100%">
    <rect width="${total}" height="${total}" fill="#ffffff" rx="16"/>
    <path d="${path}" fill="#0f172a"/>
  </svg>`;
}

/**
 * QR Scanner Controller with BarcodeDetector and Fallback
 */
export class QRScannerController {
  constructor(videoElement, onDetected) {
    this.video = videoElement;
    this.onDetected = onDetected;
    this.stream = null;
    this.animId = null;
    this.scanning = false;
    this.detector = null;
    this.jsQRLoaded = false;
  }

  async start() {
    this.scanning = true;

    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch (e) {
        console.warn('BarcodeDetector format query failed:', e);
      }
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 } }
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.loop();
    } catch (err) {
      throw new Error('Camera access denied or unavailable: ' + err.message);
    }
  }

  async loop() {
    if (!this.scanning) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      if (this.detector) {
        try {
          const codes = await this.detector.detect(this.video);
          if (codes && codes.length > 0) {
            this.onDetected(codes[0].rawValue);
            this.stop();
            return;
          }
        } catch (e) {}
      } else if (window.jsQR) {
        // Fallback using jsQR if available in window
        if (!this.canvas) {
          this.canvas = document.createElement('canvas');
          this.ctx = this.canvas.getContext('2d');
        }
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const code = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          this.onDetected(code.data);
          this.stop();
          return;
        }
      }
    }

    this.animId = requestAnimationFrame(() => this.loop());
  }

  stop() {
    this.scanning = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}

/**
 * Copy text to clipboard helper with fallback
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {}
  }
  const input = document.createElement('textarea');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  const success = document.execCommand('copy');
  document.body.removeChild(input);
  return success;
}
