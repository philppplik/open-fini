//! Small, dependency-free building blocks shared by the built-in relay and the network clients:
//! SHA-1 (only for the WebSocket handshake, RFC 6455), SHA-256 (certificate fingerprints),
//! base64 (RFC 4648, standard alphabet) and the WebSocket frame codec. Everything here is pure
//! and unit-tested; nothing touches the network.

// ------------------------------------------------------------------ hashes

/// SHA-1 digest. Used only for `Sec-WebSocket-Accept`, which the WebSocket standard defines with SHA-1.
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    for block in padded(data).chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let t = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, v) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(v);
        }
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

const K256: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// SHA-256 digest (certificate fingerprints shown to the user and pinned on "trust").
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    for block in padded(data).chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = h;
        for (k, wi) in K256.iter().zip(w.iter()) {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(*k)
                .wrapping_add(*wi);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [
                t1.wrapping_add(t2),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t1),
                v[4],
                v[5],
                v[6],
            ];
        }
        for (x, y) in h.iter_mut().zip(v) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// Merkle–Damgård padding shared by SHA-1 and SHA-256 (64-byte blocks, big-endian bit length).
fn padded(data: &[u8]) -> Vec<u8> {
    let mut m = data.to_vec();
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_be_bytes());
    m
}

/// `AB:CD:…` (upper-case hex pairs), the form certificate viewers show.
pub fn fingerprint(der: &[u8]) -> String {
    sha256(der)
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

// ------------------------------------------------------------------ base64

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Decodes standard or URL-safe base64, with or without padding. Whitespace is ignored.
pub fn b64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b' ' | b'\r' | b'\n' | b'\t' => continue,
            _ => return Err("invalid base64 data".into()),
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

// ------------------------------------------------------------------ WebSocket (RFC 6455)

/// `Sec-WebSocket-Accept` for a client key.
pub fn ws_accept(key: &str) -> String {
    let mut s = key.as_bytes().to_vec();
    s.extend_from_slice(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    b64_encode(&sha1(&s))
}

/// A client key must be 16 random bytes in base64 (22 characters and `==`).
pub fn ws_key_valid(key: &str) -> bool {
    key.len() == 24
        && key.ends_with("==")
        && key[..22]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
}

/// One decoded client frame.
#[derive(Debug, PartialEq, Eq)]
pub struct Frame {
    pub fin: bool,
    pub opcode: u8,
    pub payload: Vec<u8>,
}

/// Why a connection must be closed, with the WebSocket close code.
#[derive(Debug, PartialEq, Eq)]
pub struct Violation(pub u16, pub &'static str);

/// Parses one masked client frame from the start of `buf`.
/// `Ok(None)` means more bytes are needed; `Ok(Some((frame, used)))` consumed `used` bytes.
pub fn parse_frame(buf: &[u8], max: usize) -> Result<Option<(Frame, usize)>, Violation> {
    if buf.len() < 2 {
        return Ok(None);
    }
    let (b0, b1) = (buf[0], buf[1]);
    if b0 & 0x70 != 0 {
        return Err(Violation(1002, "reserved bits"));
    }
    if b1 & 0x80 == 0 {
        return Err(Violation(1002, "unmasked client frame"));
    }
    let mut len = usize::from(b1 & 0x7f);
    let mut off = 2;
    if len == 126 {
        if buf.len() < 4 {
            return Ok(None);
        }
        len = usize::from(u16::from_be_bytes([buf[2], buf[3]]));
        off = 4;
    } else if len == 127 {
        if buf.len() < 10 {
            return Ok(None);
        }
        let mut b = [0u8; 8];
        b.copy_from_slice(&buf[2..10]);
        let big = u64::from_be_bytes(b);
        if big > max as u64 {
            return Err(Violation(1009, "too large"));
        }
        len = big as usize;
        off = 10;
    }
    if len > max {
        return Err(Violation(1009, "too large"));
    }
    if buf.len() < off + 4 + len {
        return Ok(None);
    }
    let mask = [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
    let payload = buf[off + 4..off + 4 + len]
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ mask[i & 3])
        .collect();
    Ok(Some((
        Frame {
            fin: b0 & 0x80 != 0,
            opcode: b0 & 0x0f,
            payload,
        },
        off + 4 + len,
    )))
}

/// Encodes one unmasked server frame (always final).
pub fn encode_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let len = payload.len();
    let mut out = Vec::with_capacity(len + 10);
    out.push(0x80 | opcode);
    if len < 126 {
        out.push(len as u8);
    } else if len < 65536 {
        out.push(126);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        out.push(127);
        out.extend_from_slice(&(len as u64).to_be_bytes());
    }
    out.extend_from_slice(payload);
    out
}

/// A close frame with a status code and a short reason.
pub fn close_frame(code: u16, reason: &str) -> Vec<u8> {
    let mut p = code.to_be_bytes().to_vec();
    p.extend_from_slice(&reason.as_bytes()[..reason.len().min(100)]);
    encode_frame(8, &p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn sha_vectors() {
        assert_eq!(
            hex(&sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hex(&sha256(
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert!(fingerprint(b"abc").starts_with("BA:78:16:BF:"));
    }

    #[test]
    fn base64_round_trip() {
        for (plain, enc) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(b64_encode(plain.as_bytes()), enc);
            assert_eq!(b64_decode(enc).unwrap(), plain.as_bytes());
        }
        assert_eq!(b64_decode("Zm9vYg").unwrap(), b"foob");
        assert_eq!(b64_decode("-_8").unwrap(), vec![0xfb, 0xff]);
        assert!(b64_decode("Zm9v!").is_err());
    }

    #[test]
    fn websocket_accept_matches_rfc_example() {
        assert_eq!(
            ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
        assert!(ws_key_valid("dGhlIHNhbXBsZSBub25jZQ=="));
        assert!(!ws_key_valid("short=="));
    }

    fn masked(opcode: u8, payload: &[u8]) -> Vec<u8> {
        let mask = [1u8, 2, 3, 4];
        let mut f = vec![0x80 | opcode];
        if payload.len() < 126 {
            f.push(0x80 | payload.len() as u8);
        } else {
            f.push(0x80 | 126);
            f.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        f.extend_from_slice(&mask);
        f.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i & 3]));
        f
    }

    #[test]
    fn frames_parse_and_encode() {
        let f = masked(1, b"hello");
        assert_eq!(parse_frame(&f[..3], 1000).unwrap(), None);
        let (frame, used) = parse_frame(&f, 1000).unwrap().unwrap();
        assert_eq!(used, f.len());
        assert_eq!(frame.payload, b"hello");
        assert!(frame.fin);
        assert_eq!(frame.opcode, 1);
        let big = vec![7u8; 300];
        let (frame, _) = parse_frame(&masked(1, &big), 1000).unwrap().unwrap();
        assert_eq!(frame.payload, big);
        assert_eq!(
            parse_frame(&masked(1, &big), 100).unwrap_err(),
            Violation(1009, "too large")
        );
        assert_eq!(parse_frame(&[0x81, 0x05, b'h'], 100).unwrap_err().0, 1002);
        assert_eq!(encode_frame(1, b"hi"), vec![0x81, 2, b'h', b'i']);
        assert_eq!(&encode_frame(1, &big)[..4], &[0x81, 126, 1, 44]);
        assert_eq!(close_frame(1000, ""), vec![0x88, 2, 3, 232]);
    }
}
