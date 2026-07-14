# 0013 — Session-global protocol-v2 snapshot codec

- **Status:** accepted
- **Date:** 2026-07-13
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md §§ 6A.4–6A.5

## Context

The dominant 30 Hz multiplayer delta contains 44 bytes of binary-v7 state but occupies about
490 bytes after its base64 wrapper and JSON gameplay envelope. Replacing that wire shape in place
would make released protocol-1 clients mutually unintelligible. Version negotiation now selects and
locks one protocol for a lobby, so compaction can be introduced without changing protocol 1.0.0.

Per-peer codecs inside one lobby would make host fan-out, baselines, recovery, and migration depend on
which peer receives a packet. It would also allow a migrated host to reinterpret queued state under a
different codec. Snapshot packets still need a prior-match fence after handshake: a delayed packet from
the same Steam host can otherwise arrive after a new match session is adopted.

## Decision

- Protocol 1.0.0 remains the default and rollback codec. Its JSON envelope and binary-v7/base64
  snapshot shape do not change.
- Protocol 2.0.0 is an explicit, session-global codec selected during the existing HELLO/WELCOME
  negotiation. It remains opt-in until its two-peer soak and mixed-build validation pass. A lobby never
  mixes protocol-1 and protocol-2 gameplay peers, including across host migration.
- Bootstrap HELLO, WELCOME, JOIN_REJECTED, and NET_ERROR packets retain the stable JSON-v1 shape so an
  incompatible client can receive a useful update-required rejection before gameplay admission.
- Protocol 2 initially changes snapshots only. Non-snapshot messages continue through the versioned,
  default-deny JSON envelope and role policy.
- Protocol 2 preserves the existing packed-v7 snapshot contract rather than expanding it implicitly.
  `hotPotatoState`, `lastAttackerId`, and `lockSeq` remain outside this body and continue to travel via
  their existing authoritative event/resync paths.
- A protocol-2 snapshot uses the bounded `SBSF` raw frame. It carries logical channel and sequence,
  a 64-bit tag derived from the negotiated session nonce, round generation, migration epoch, the DJB2
  state digest, and one positional input acknowledgement per packed player. Its body is an exact
  binary-v7 `SBNE` keyframe or `SBND` delta. Kind, channel, body magic/version, and player/ACK count
  must agree; malformed or trailing data is rejected.
- The session tag is a stale-session fence, not authentication. Steam sender identity plus the
  protocol catalog's host-authority rules remain the trust boundary. Raw ingress is denied until the
  sender is admitted under a locked protocol-2 session.
- Frames cannot exceed the Electron transport's 64 KiB packet cap. Round and migration counters are
  unsigned 16-bit fields and must fail encoding rather than wrap. A future incompatible header or
  packed-body format requires another explicit protocol codec/version; protocol 2 does not silently
  reinterpret it.

## Consequences

- A two-player 44-byte delta is exactly 80 bytes: 28 fixed bytes, two 4-byte acknowledgements, and the
  existing body. Keyframes remain larger and are measured separately.
- Player order is now explicitly part of both the binary-v7 delta baseline and acknowledgement mapping.
- Electron and mock transports must preserve typed-array offsets and lengths and normalize a validated
  raw frame back into the existing canonical dispatch path.
- Snapshot timestamps leave the compact lane; NET_PING/PONG remains the RTT source.
- Protocol 1 stays available for immediate rollback while protocol 2 is enabled only by `wireV2` soak
  sessions.

## Enforcement

`src/core/network/snapshot-frame-v2.js` owns the bounded frame codec. Its focused tests pin exact v7
body headers, kind/channel and player/ACK agreement, sliced typed-array safety, malformed/truncated/
oversized rejection, the session-tag derivation, and the 80-byte two-player budget. Protocol catalog,
session negotiation, raw-ingress role/session checks, transport parity, migration, and v1 byte-shape
tests gate the opt-in wiring. `wireV2` is default-off and expiry-governed. The release soak aborts on
increased delta decode failures or resync requests.
