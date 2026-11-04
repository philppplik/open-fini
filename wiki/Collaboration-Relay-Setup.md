# Collaboration Relay Setup

A relay is a small dependency-free Node program that forwards encrypted frames between the members of a room. It never sees plaintext. You can run it on your own computer, on your local network or on a server behind a TLS proxy. This page covers each setup, the options, the limits and the protocol in brief.

## The easy way: the desktop app

You do not need anything on this page for a room in your own network: in the desktop app choose *Collaborate ▸ Start a room ▸ Where: Your network: start a relay on this computer ▸ Create room*. The app starts its built-in relay, puts this computer's network address into the invite code and shows *Copy invite code*, a QR code and *Stop relay* under *People*. Allow OpenFini in the firewall for private networks when Windows asks. Others join with the invite code in the desktop app. The built-in relay is plain `ws://` and does not serve the app, so browsers on phones and tablets need the Node relay with `--lan` below. In the browser or installed web app there is no built-in relay: enter the address of a hosted relay.

## Requirements

Node.js 20 or newer. Inside the OpenFini repository use `npm run relay`. Without the repository, download `scripts/relay.mjs` (one file, no dependencies) into any folder and run `node relay.mjs --lan` in that folder; add `scripts/relay-tls.mjs` next to it for https/wss. Running `npm run relay` outside the project folder fails with `ENOENT … package.json`.

## Run it

```sh
npm run relay                                  # ws://127.0.0.1:8787/ (this computer only)
node scripts/relay.mjs --host 0.0.0.0          # your network: ws://<this computer's IP>:8787/ (prints a warning)
node scripts/relay.mjs --host 0.0.0.0 --port 8443 --tls-cert cert.pem --tls-key key.pem   # wss:// directly
node scripts/relay.mjs --help                  # --origin, --any-origin, --max-rooms, --max-peers, --rate, --quiet
```

The relay binds `127.0.0.1` by default. Browsers are accepted from the desktop app and `localhost` pages; a hosted web version needs `--origin https://your.host`.

| Setup | Address members enter | Notes |
| --- | --- | --- |
| Same computer | `ws://127.0.0.1:8787/` | Or use a *This device* room, which needs no relay |
| LAN | `ws://192.168.1.20:8787/` | Use `--host 0.0.0.0`; traffic is encrypted by the room, but the connection itself is plain WebSocket, so keep it on a trusted network |
| Internet (VPS) | `wss://relay.example.org/` | Run the relay on localhost and terminate TLS in a reverse proxy |
| Direct TLS | `wss://host:8443/` | `--tls-cert` and `--tls-key` |

## Reverse proxy examples

```nginx
location /openfini-relay/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

```caddyfile
relay.example.org {
  reverse_proxy 127.0.0.1:8787
}
```

Members then use `wss://relay.example.org/` (Caddy) or `wss://example.org/openfini-relay/` (nginx). The relay sees the proxy's address, not the members', so configure the proxy's own logs accordingly.

## Limits (all configurable)

Per connection: 150 messages per second (burst 300), 4 MiB per second, frames up to 257 KiB. Per IP: 32 connections. Per room: 16 members. Total: 200 rooms. The room protocol itself allows 32 members, 256 KiB per frame, 4000 characters per message or comment and 25 MB per file.

## Protocol in brief

JSON text frames over WebSocket. The first frame must be `{ "t": "join", "room": <22 chars>, "token": <22 chars> }` within 10 seconds. The first peer of a room pins its access token (derived from the room secret, so knowing the room id alone does not let anyone in); later peers must present the same token. Then `msg` frames carry opaque encrypted envelopes to every other peer, `peers` frames report the count and `error` frames refuse with codes such as `forbidden`, `room_full`, `too_many_rooms` or `rate`. Rooms disappear when the last peer leaves.

## What the operator can see

IP addresses (or the proxy's), room ids, number of members, frame sizes and timing. Not nicknames, messages, comments, files, cursors or documents. The relay logs only counts, short room-id prefixes and error codes.

## Client side

- The desktop Content-Security-Policy allows `ws:` and `wss:` so you can reach the relay you enter.
- Offline mode blocks every relay that is not on this computer ([[Security and Privacy]]).
- Not covered by automated tests: a real LAN between machines, TLS, and reverse proxies. Please report problems.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cannot connect | Address and scheme (`ws://` versus `wss://`), firewall, and `--host` (the default listens on this computer only) |
| `forbidden` | The invite was made for another room or the token does not match; ask the host for a new code |
| Browser refuses the origin | Start the relay with `--origin https://your.host` for a hosted web app |
| `room_full`, `too_many_rooms`, `rate` | Raise `--max-peers`, `--max-rooms` or `--rate`, or reduce traffic |

## See also

- [[Collaboration]]
- [[Security and Privacy]]
- [[Troubleshooting and Logs]]
- [[Decision Records]]
