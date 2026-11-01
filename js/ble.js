// Web Bluetooth client for the SPIKE Prime hub (firmware 3.x), following LEGO's published protocol:
// https://lego.github.io/spike-prime-docs/ — COBS-escaped, XOR 0x03, 0x02-delimited frames; CRC32 chunked upload.

const SERVICE = '0000fd02-0000-1000-8000-00805f9b34fb';
const RX_CHAR = '0000fd02-0001-1000-8000-00805f9b34fb';   // hub receives
const TX_CHAR = '0000fd02-0002-1000-8000-00805f9b34fb';   // hub transmits

const MSG = {
  InfoRequest: 0x00, InfoResponse: 0x01,
  StartFileUploadRequest: 0x0C, StartFileUploadResponse: 0x0D,
  TransferChunkRequest: 0x10, TransferChunkResponse: 0x11,
  ProgramFlowRequest: 0x1E, ProgramFlowResponse: 0x1F, ProgramFlowNotification: 0x20,
  ConsoleNotification: 0x21,
  DeviceNotificationRequest: 0x28, DeviceNotificationResponse: 0x29, DeviceNotification: 0x3C,
  ClearSlotRequest: 0x46, ClearSlotResponse: 0x47,
};

// ---------- COBS (SPIKE variant: escapes 0x00, 0x01, 0x02) ----------
const DELIMITER = 0x02, NO_DELIMITER = 0xFF, CODE_OFFSET = 0x02, MAX_BLOCK = 84, XOR = 0x03;

export function cobsEncode(data) {
  const out = [];
  let codeIndex = 0, block = 0;
  const begin = () => { codeIndex = out.length; out.push(NO_DELIMITER); block = 1; };
  begin();
  for (const byte of data) {
    if (byte > DELIMITER) { out.push(byte); block++; }
    if (byte <= DELIMITER || block > MAX_BLOCK) {
      if (byte <= DELIMITER) out[codeIndex] = byte * MAX_BLOCK + block + CODE_OFFSET;
      begin();
    }
  }
  out[codeIndex] = block + CODE_OFFSET;
  return Uint8Array.from(out);
}

export function cobsDecode(data) {
  const out = [];
  const unescape = (code) => {
    if (code === 0xFF) return [null, MAX_BLOCK + 1];
    let value = Math.floor((code - CODE_OFFSET) / MAX_BLOCK), block = (code - CODE_OFFSET) % MAX_BLOCK;
    if (block === 0) { block = MAX_BLOCK; value -= 1; }
    return [value, block];
  };
  let [value, block] = unescape(data[0]);
  for (let i = 1; i < data.length; i++) {
    block--;
    if (block > 0) { out.push(data[i]); continue; }
    if (value !== null) out.push(value);
    [value, block] = unescape(data[i]);
  }
  return Uint8Array.from(out);
}

export function pack(payload) {
  const enc = cobsEncode(payload);
  const out = new Uint8Array(enc.length + 1);
  for (let i = 0; i < enc.length; i++) out[i] = enc[i] ^ XOR;
  out[enc.length] = DELIMITER;
  return out;
}

export function unpack(frame) {
  let start = 0;
  if (frame[0] === 0x01) start = 1;
  const body = frame.slice(start, frame.length - 1).map((x) => x ^ XOR);
  return cobsDecode(body);
}

// ---------- CRC32 (zlib-compatible, seedable, 4-byte zero padding like LEGO's example) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(data, seed = 0, align = 4) {
  let bytes = data;
  const rem = data.length % align;
  if (rem) { bytes = new Uint8Array(data.length + (align - rem)); bytes.set(data); }
  let c = (seed ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- message builders ----------
const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

export const messages = {
  info: () => Uint8Array.from([MSG.InfoRequest]),
  clearSlot: (slot) => Uint8Array.from([MSG.ClearSlotRequest, slot]),
  startFileUpload: (name, slot, crc) => {
    const nameBytes = new TextEncoder().encode(name);
    if (nameBytes.length > 31) throw new Error('file name too long');
    return Uint8Array.from([MSG.StartFileUploadRequest, ...nameBytes, 0, slot, ...u32(crc)]);
  },
  transferChunk: (runningCrc, chunk) => Uint8Array.from([MSG.TransferChunkRequest, ...u32(runningCrc), ...u16(chunk.length), ...chunk]),
  programFlow: (stop, slot) => Uint8Array.from([MSG.ProgramFlowRequest, stop ? 1 : 0, slot]),
  deviceNotification: (intervalMs) => Uint8Array.from([MSG.DeviceNotificationRequest, ...u16(intervalMs)]),
};

function parseInfo(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    rpc: `${d[1]}.${d[2]}.${dv.getUint16(3, true)}`,
    firmware: `${d[5]}.${d[6]}.${dv.getUint16(7, true)}`,
    maxPacketSize: dv.getUint16(9, true),
    maxMessageSize: dv.getUint16(11, true),
    maxChunkSize: dv.getUint16(13, true),
    productGroupDevice: dv.getUint16(15, true),
  };
}

export const isSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';

/** One hub connection. Events: 'status' (string), 'console' (text), 'disconnect', 'programFlow' (running boolean). */
export class SpikeHub {
  constructor() {
    this.device = null; this.rx = null; this.tx = null; this.info = null;
    this.listeners = {};
    this.pending = new Map();   // response id -> {resolve, reject, timer}
    this.buffer = [];
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, data) { (this.listeners[ev] || []).forEach((fn) => fn(data)); }
  get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }
  get name() { return this.device ? this.device.name || 'SPIKE hub' : ''; }

  async connect() {
    if (!isSupported()) throw new Error('Web Bluetooth is not available in this browser. Use Chrome or Edge on a laptop or Android, or the SPIKE App.');
    this.emit('status', 'Choose your hub in the browser dialog…');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => { this.rx = this.tx = null; this.rejectAll(new Error('Hub disconnected')); this.emit('disconnect'); });
    this.emit('status', `Connecting to ${this.name}…`);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    this.rx = await service.getCharacteristic(RX_CHAR);
    this.tx = await service.getCharacteristic(TX_CHAR);
    this.tx.addEventListener('characteristicvaluechanged', (e) => this.onData(new Uint8Array(e.target.value.buffer)));
    await this.tx.startNotifications();
    this.info = parseInfo(await this.request(messages.info(), MSG.InfoResponse));
    this.emit('status', `Connected to ${this.name} (firmware ${this.info.firmware})`);
    return this.info;
  }

  disconnect() { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); }

  onData(bytes) {
    for (const b of bytes) {
      this.buffer.push(b);
      if (b === DELIMITER) {
        const frame = Uint8Array.from(this.buffer);
        this.buffer = [];
        if (frame.length < 2) continue;
        let msg;
        try { msg = unpack(frame); } catch { continue; }
        this.onMessage(msg);
      }
    }
  }

  onMessage(msg) {
    const id = msg[0];
    const p = this.pending.get(id);
    if (p) { this.pending.delete(id); clearTimeout(p.timer); p.resolve(msg); }
    if (id === MSG.ConsoleNotification) {
      // the hub streams its console in fragments (a traceback arrives as a dozen pieces): hand out whole lines
      this.console = (this.console || '') + new TextDecoder().decode(msg.slice(1)).replace(/\0+$/, '');
      const lines = this.console.split('\n');
      this.console = lines.pop();
      for (const line of lines) if (line.trim()) this.emit('console', line);
      clearTimeout(this.consoleTimer);
      this.consoleTimer = setTimeout(() => { if (this.console && this.console.trim()) this.emit('console', this.console); this.console = ''; }, 400);
    }
    if (id === MSG.ProgramFlowNotification) this.emit('programFlow', msg[1] === 0);
  }

  rejectAll(err) { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }

  async send(payload) {
    if (!this.rx) throw new Error('Not connected');
    const frame = pack(payload);
    const size = this.info ? this.info.maxPacketSize : frame.length;
    for (let i = 0; i < frame.length; i += size) {
      const part = frame.slice(i, i + size);
      if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(part);
      else await this.rx.writeValue(part);
    }
  }

  request(payload, responseId, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(responseId); reject(new Error('The hub did not answer in time.')); }, timeoutMs);
      this.pending.set(responseId, { resolve, reject, timer });
      this.send(payload).catch((e) => { clearTimeout(timer); this.pending.delete(responseId); reject(e); });
    });
  }

  async status(payload, responseId, what) {
    const res = await this.request(payload, responseId);
    if (res[1] !== 0x00) throw new Error(`${what} was refused by the hub (status ${res[1]}).`);
    return res;
  }

  /** Upload Python source to a slot and (optionally) start it. */
  async uploadProgram(source, slot = 0, { start = true, onProgress } = {}) {
    if (!this.info) throw new Error('Not connected');
    const bytes = new TextEncoder().encode(source);
    this.emit('status', `Sending program to slot ${slot}…`);
    try { await this.status(messages.clearSlot(slot), MSG.ClearSlotResponse, 'Clearing the slot'); } catch { /* empty slot */ }
    await this.status(messages.startFileUpload('program.py', slot, crc32(bytes)), MSG.StartFileUploadResponse, 'Starting the upload');
    const chunkSize = this.info.maxChunkSize;
    let running = 0;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      running = crc32(chunk, running);
      await this.status(messages.transferChunk(running, chunk), MSG.TransferChunkResponse, 'Sending part of the program');
      if (onProgress) onProgress(Math.min(1, (i + chunk.length) / bytes.length));
    }
    if (start) {
      await this.status(messages.programFlow(false, slot), MSG.ProgramFlowResponse, 'Starting the program');
      this.emit('status', `Program running on ${this.name} (slot ${slot})`);
    } else {
      this.emit('status', `Program saved to slot ${slot}`);
    }
  }

  async stopProgram(slot = 0) {
    await this.status(messages.programFlow(true, slot), MSG.ProgramFlowResponse, 'Stopping the program');
    this.emit('status', 'Program stopped');
  }
}
