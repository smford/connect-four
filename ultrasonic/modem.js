/**
 * Acoustic & Ultrasonic FSK Audio Modem (Web Audio API)
 * 100% offline, air-gapped communication using Speaker & Microphone.
 * Supports Near-Ultrasonic (17.5 - 19.5 kHz) and Audible Arcade (1.3 - 2.2 kHz) modes.
 */

export const MODEM_MODES = {
  ULTRASONIC: 'ULTRASONIC',
  AUDIBLE: 'AUDIBLE'
};

const FREQ_PROFILES = {
  ULTRASONIC: {
    preamble: 17600,
    bit0: 18400,
    bit1: 19200
  },
  AUDIBLE: {
    preamble: 1300,
    bit0: 1700,
    bit1: 2200
  }
};

const BIT_DURATION = 0.050; // 50ms per bit
const PREAMBLE_DURATION = 0.160; // 160ms preamble
const GUARD_DURATION = 0.040; // 40ms guard space
const SYNC_BYTE = 0xA5;

export class AcousticModem {
  constructor(options = {}) {
    this.mode = options.mode || MODEM_MODES.ULTRASONIC;
    this.onPacketReceived = options.onPacketReceived || (() => {});
    this.onTxStart = options.onTxStart || (() => {});
    this.onTxEnd = options.onTxEnd || (() => {});
    this.onRxSignal = options.onRxSignal || (() => {});

    this.audioCtx = null;
    this.analyser = null;
    this.micStream = null;
    this.rxLoopId = null;
    this.isListening = false;
    this.isTransmitting = false;

    // Rx State Machine
    this.rxState = 'IDLE'; // 'IDLE', 'PREAMBLE', 'READING_BITS'
    this.bitBuffer = [];
    this.rxStartTime = 0;
    this.lastPacketTime = 0;
  }

  setMode(mode) {
    if (MODEM_MODES[mode]) {
      this.mode = mode;
      console.log(`[Modem] Mode switched to: ${mode}`);
    }
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Transmit a packet of data:
   * @param {Object} data - { type: number (0-3), player: number (1-2), col: number (0-6), counter: number (0-3) }
   */
  async transmit(data) {
    this.ensureAudioContext();
    if (this.isTransmitting) return;
    this.isTransmitting = true;
    this.onTxStart();

    const freqs = FREQ_PROFILES[this.mode];
    const typeBits = (data.type & 0x03) << 6;
    const playerBit = ((data.player === 2 ? 1 : 0) & 0x01) << 5;
    const colBits = (data.col & 0x07) << 2;
    const counterBits = (data.counter || 0) & 0x03;
    const payloadByte = typeBits | playerBit | colBits | counterBits;
    const checksumByte = (SYNC_BYTE ^ payloadByte ^ 0x3C) & 0xFF;

    const packetBytes = [SYNC_BYTE, payloadByte, checksumByte];
    const bits = [];
    for (const byte of packetBytes) {
      for (let i = 7; i >= 0; i--) {
        bits.push((byte >> i) & 1);
      }
    }

    const now = this.audioCtx.currentTime + 0.05;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    gain.gain.setValueAtTime(0.001, now);

    // 1. Preamble Tone
    osc.frequency.setValueAtTime(freqs.preamble, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain.gain.setValueAtTime(0.3, now + PREAMBLE_DURATION - 0.01);
    gain.gain.linearRampToValueAtTime(0.001, now + PREAMBLE_DURATION);

    // Guard gap
    let bitStartTime = now + PREAMBLE_DURATION + GUARD_DURATION;

    // 2. Transmit each bit tone
    for (const bit of bits) {
      const targetFreq = bit === 1 ? freqs.bit1 : freqs.bit0;
      osc.frequency.setValueAtTime(targetFreq, bitStartTime);
      gain.gain.setValueAtTime(0.3, bitStartTime + 0.005);
      gain.gain.setValueAtTime(0.3, bitStartTime + BIT_DURATION - 0.005);
      bitStartTime += BIT_DURATION;
    }

    gain.gain.linearRampToValueAtTime(0.0001, bitStartTime + 0.01);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(now);
    const totalDuration = (bitStartTime + 0.02 - now) * 1000;
    osc.stop(bitStartTime + 0.02);

    await new Promise((resolve) => setTimeout(resolve, totalDuration));

    this.isTransmitting = false;
    this.onTxEnd();
  }

  /**
   * Start microphone listening & demodulation
   */
  async startListening() {
    this.ensureAudioContext();
    if (this.isListening) return;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;
      source.connect(this.analyser);

      this.isListening = true;
      this.rxLoop();
      console.log('[Modem] Microphone listening active');
    } catch (err) {
      console.error('[Modem] Microphone access error:', err);
      throw err;
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.rxLoopId) {
      cancelAnimationFrame(this.rxLoopId);
      this.rxLoopId = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.rxState = 'IDLE';
  }

  rxLoop() {
    if (!this.isListening || !this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(freqData);

    this.onRxSignal(freqData, this.analyser);

    // If currently transmitting from this same device, ignore microphone to prevent self-echo
    if (!this.isTransmitting) {
      this.processFrequencies(freqData);
    }

    this.rxLoopId = requestAnimationFrame(() => this.rxLoop());
  }

  getBinIndex(freq) {
    const nyquist = this.audioCtx.sampleRate / 2;
    return Math.round((freq / nyquist) * this.analyser.frequencyBinCount);
  }

  getBinEnergy(freqData, centerFreq, span = 2) {
    const bin = this.getBinIndex(centerFreq);
    let max = 0;
    for (let i = Math.max(0, bin - span); i <= Math.min(freqData.length - 1, bin + span); i++) {
      if (freqData[i] > max) max = freqData[i];
    }
    return max;
  }

  processFrequencies(freqData) {
    const freqs = FREQ_PROFILES[this.mode];
    const preambleEnergy = this.getBinEnergy(freqData, freqs.preamble);
    const threshold = this.mode === MODEM_MODES.ULTRASONIC ? 45 : 60;

    const now = performance.now();

    if (this.rxState === 'IDLE') {
      if (preambleEnergy > threshold && now - this.lastPacketTime > 1500) {
        this.rxState = 'PREAMBLE';
        this.rxStartTime = now;
      }
    } else if (this.rxState === 'PREAMBLE') {
      // Wait for preamble duration + guard interval
      if (now - this.rxStartTime >= (PREAMBLE_DURATION + GUARD_DURATION) * 1000) {
        this.rxState = 'READING_BITS';
        this.bitBuffer = [];
        this.sampleBitIndex = 0;
        this.nextBitSampleTime = now + (BIT_DURATION / 2) * 1000;
      }
    } else if (this.rxState === 'READING_BITS') {
      if (now >= this.nextBitSampleTime) {
        const energy0 = this.getBinEnergy(freqData, freqs.bit0);
        const energy1 = this.getBinEnergy(freqData, freqs.bit1);

        const bit = energy1 > energy0 ? 1 : 0;
        this.bitBuffer.push(bit);
        this.sampleBitIndex++;
        this.nextBitSampleTime += BIT_DURATION * 1000;

        if (this.bitBuffer.length === 24) {
          this.decodePacket(this.bitBuffer);
          this.rxState = 'IDLE';
          this.lastPacketTime = now;
        }
      }

      // Timeout safety: if bits take too long, abort back to IDLE
      if (now - this.rxStartTime > 3000) {
        this.rxState = 'IDLE';
      }
    }
  }

  decodePacket(bits) {
    const bytes = [0, 0, 0];
    for (let b = 0; b < 3; b++) {
      for (let i = 0; i < 8; i++) {
        bytes[b] = (bytes[b] << 1) | bits[b * 8 + i];
      }
    }

    const [sync, payload, checksum] = bytes;
    const expectedChecksum = (SYNC_BYTE ^ payload ^ 0x3C) & 0xFF;

    if (sync === SYNC_BYTE && checksum === expectedChecksum) {
      const type = (payload >> 6) & 0x03;
      const player = ((payload >> 5) & 0x01) === 1 ? 2 : 1;
      const col = (payload >> 2) & 0x07;
      const counter = payload & 0x03;

      console.log(`[Modem] Packet decoded! type=${type}, player=${player}, col=${col}, counter=${counter}`);
      this.onPacketReceived({ type, player, col, counter });
    } else {
      console.warn('[Modem] Packet checksum or sync mismatch, dropped.');
    }
  }
}
