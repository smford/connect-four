/**
 * Offline-first QR Code Generator and Camera Scanner Helper
 * - ISO/IEC 18004 compliant QR generation with crisp rendering & standard quiet zones
 * - Camera scanning using native BarcodeDetector API with jsQR CDN fallback
 * - Copy/Paste link fallback
 */

import { qrcode } from './qrcode-lib.js';

/**
 * Render standard QR code to Canvas
 */
export function renderQRToCanvas(canvas, text, cellSize = 8, margin = 4) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const totalModules = count + margin * 2;
    const totalSize = totalModules * cellSize;

    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext('2d');

    // Solid white background with required quiet zone
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    // Solid black modules
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
    return true;
  } catch (err) {
    console.error('[QR] Render failed:', err);
    return false;
  }
}

/**
 * Generate standard compliant SVG tag with crisp edges for camera scanning
 */
export function generateQRSVG(text, cellSize = 6, margin = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = (count + margin * 2) * cellSize;

  let path = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        path += `M${(c + margin) * cellSize},${(r + margin) * cellSize}h${cellSize}v${cellSize}h-${cellSize}z `;
      }
    }
  }

  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
    <rect width="${total}" height="${total}" fill="#ffffff"/>
    <path d="${path}" fill="#000000"/>
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
    this.canvas = null;
    this.ctx = null;
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
        video: { facingMode: 'environment', width: { ideal: 1280 } }
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
