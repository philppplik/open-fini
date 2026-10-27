// A minimal WebSocket client for tests, built on node:http upgrade (Node 20 has no global WebSocket client).
// It mimics the browser API used by app/src/collab/transport.js: new TestWebSocket(url), onopen, onmessage({data}),
// onclose, onerror, send(text), close(), readyState. Extra test helpers: sendRaw(buffer) writes arbitrary bytes,
// frameText(text, { mask }) builds a client frame.
import { request } from "node:http";
import { randomBytes } from "node:crypto";

export function frameText(text, { mask = true, opcode = 1, fin = true } = {}) {
  const payload = Buffer.isBuffer(text) ? text : Buffer.from(text);
  const len = payload.length;
  const parts = [];
  const b0 = (fin ? 0x80 : 0) | opcode;
  const m = mask ? 0x80 : 0;
  if (len < 126) parts.push(Buffer.from([b0, m | len]));
  else if (len < 65536) {
    const h = Buffer.alloc(4);
    h[0] = b0;
    h[1] = m | 126;
    h.writeUInt16BE(len, 2);
    parts.push(h);
  } else {
    const h = Buffer.alloc(10);
    h[0] = b0;
    h[1] = m | 127;
    h.writeBigUInt64BE(BigInt(len), 2);
    parts.push(h);
  }
  if (mask) {
    const key = randomBytes(4);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
    parts.push(key, body);
  } else parts.push(payload);
  return Buffer.concat(parts);
}

export class TestWebSocket {
  constructor(url, { origin, hostHeader } = {}) {
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.status = 0;
    const u = new URL(url);
    const req = request({
      host: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), ...(origin ? { Origin: origin } : {}), ...(hostHeader ? { Host: hostHeader } : {}) },
    });
    req.on("upgrade", (res, socket) => {
      this.socket = socket;
      this.readyState = 1;
      let buf = Buffer.alloc(0);
      socket.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) this.onmessage?.({ data: payload.toString("utf8") });
          else if (op === 9) socket.write(frameText(Buffer.from(payload), { opcode: 10 }));
          else if (op === 8) {
            this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
            socket.end();
          }
        }
      });
      socket.on("close", () => {
        this.readyState = 3;
        this.onclose?.({ code: this.closeCode || 1006 });
      });
      socket.on("error", () => {});
      this.onopen?.();
    });
    req.on("response", (res) => {
      this.status = res.statusCode;
      this.readyState = 3;
      this.onerror?.({});
      this.onclose?.({ code: 1006, status: res.statusCode });
    });
    req.on("error", () => {
      this.readyState = 3;
      this.onerror?.({});
      this.onclose?.({ code: 1006 });
    });
    req.end();
  }
  send(text) {
    if (this.readyState === 1) this.socket.write(frameText(text));
  }
  sendRaw(buf) {
    this.socket.write(buf);
  }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this.socket.write(frameText(Buffer.from([0x03, 0xe8]), { opcode: 8 }));
    this.socket.end();
  }
}
