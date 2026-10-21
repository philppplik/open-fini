// Self-signed TLS certificate for `scripts/relay.mjs --lan` (no dependencies: a minimal DER/X.509 writer on top of
// node:crypto). Browsers only give WebCrypto (which the end-to-end encryption needs) to secure pages, so a phone or
// laptop that opens the relay-served app over the network must use https://. The certificate lists every LAN address
// (subjectAltName), is valid for 397 days and is kept in ~/.openfini-relay/ so people accept the browser warning only
// once; a new one is made when the addresses change.
//
// API: selfSignedCert({ ips, dns, days }) → { cert, key, fingerprint }   loadOrCreateCert({ ips, dir }) → same + path
import { generateKeyPairSync, sign, randomBytes, X509Certificate, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isIP } from "node:net";

const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const oid = (s) => {
  const n = s.split(".").map(Number);
  const out = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const b = [v & 0x7f];
    for (let x = v >>> 7; x; x >>>= 7) b.unshift(0x80 | (x & 0x7f));
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
};
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const time = (d) => {
  const s = d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"; // UTCTime YYMMDDHHMMSSZ
  return tlv(0x17, Buffer.from(s));
};
const ipBytes = (ip) => (isIP(ip) === 4 ? Buffer.from(ip.split(".").map(Number)) : Buffer.from(expand6(ip), "hex"));
function expand6(ip) {
  const [a, b = ""] = ip.split("::");
  const l = a ? a.split(":") : [];
  const r = b ? b.split(":") : [];
  const mid = ip.includes("::") ? new Array(8 - l.length - r.length).fill("0") : [];
  return [...l, ...mid, ...r].map((x) => x.padStart(4, "0")).join("");
}

/** A self-signed ECDSA P-256 certificate for the given IP addresses and host names. */
export function selfSignedCert({ ips = [], dns = ["localhost"], days = 397, name = "OpenFini relay (self-signed)" } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const dn = seq(set(seq(oid("2.5.4.3"), utf8(name))));
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const now = new Date(Date.now() - 60_000);
  const until = new Date(now.getTime() + days * 86400_000);
  const san = seq(...dns.map((d) => tlv(0x82, Buffer.from(d))), ...ips.map((ip) => tlv(0x87, ipBytes(ip))));
  const ext = (id, value, critical = false) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));
  const extensions = tlv(
    0xa3,
    seq(
      ext("2.5.29.17", san),
      ext("2.5.29.19", seq(), true), // basicConstraints: not a CA
      ext("2.5.29.15", tlv(0x03, Buffer.from([0x07, 0x80])), true), // keyUsage: digitalSignature
      ext("2.5.29.37", seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
    ),
  );
  const tbs = seq(tlv(0xa0, int(Buffer.from([2]))), int(serial), ecdsaSha256, dn, seq(time(now), time(until)), dn, spki, extensions);
  const sig = sign("sha256", tbs, privateKey); // DER-encoded ECDSA signature
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const key = privateKey.export({ type: "pkcs8", format: "pem" });
  return { cert, key, fingerprint: fingerprintOf(der) };
}

const fingerprintOf = (der) => createHash("sha256").update(der).digest("hex").toUpperCase().match(/../g).join(":");

/** Reuses the certificate in `dir` when it still covers every address, otherwise makes and stores a new one. */
export function loadOrCreateCert({ ips = [], dns = ["localhost"], dir = join(homedir(), ".openfini-relay") } = {}) {
  const certPath = join(dir, "relay-cert.pem");
  const keyPath = join(dir, "relay-key.pem");
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, "utf8");
      const x = new X509Certificate(cert);
      const alt = x.subjectAltName || "";
      const covers = ips.every((ip) => alt.includes(`IP Address:${ip}`)) && Date.parse(x.validTo) > Date.now() + 7 * 86400_000;
      if (covers) return { cert, key: readFileSync(keyPath, "utf8"), fingerprint: x.fingerprint256, certPath, created: false };
    } catch {
      /* unreadable: make a new one */
    }
  }
  const made = selfSignedCert({ ips, dns });
  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, made.cert);
  writeFileSync(keyPath, made.key, { mode: 0o600 });
  return { ...made, certPath, created: true };
}
