# 0014 — Versioned reliable resync sidecar

- **Status:** accepted
- **Date:** 2026-07-13
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § 6A.6

## Context

The packed binary-v7 snapshot is deliberately optimized for the 30 Hz cosmetic gameplay lane. It can
render a plausible board, but it cannot continue the simulation exactly: locked-piece clusters and IDs,
active-piece shape/rotation, clock and lock state, RNG cursor, exact garbage provenance, and several
authoritative sequence guards are absent or lossy. Expanding v7 would violate ADR-0013's protocol-1
rollback contract and the protocol-2 bandwidth target.

Join and recovery already use a reliable, checksummed, chunked transfer. That rare path can afford a
larger canonical payload, but accepting one half of a torn binary/canonical capture would be worse than
rejecting the transfer.

## Decision

- The binary-v7 gameplay body remains byte-for-byte unchanged. The chunked `binary-v1` resync envelope
  may additionally carry a JSON-shaped sidecar identified by schema `serenity.ffa-resync` and an explicit
  version.
- Sidecar capture is allowed only at a freshly computed safe join syncpoint with no active cascade,
  fixed-tick application, or packet-application stack. Capture is double-fenced across simulation tick,
  round generation, snapshot sequence, host tick, and migration epoch; both the packed body and sidecar
  must match that fence. Every reliable capture advances `snapshotSeq`, so two captures at the same
  simulation tick still have an unambiguous order.
- A receiver validates schema/version, the safe marker, every duplicated fence, and an exact unique
  roster match against the decoded packed snapshot before committing the incoming baseline or mutating
  live state. A present but unknown, malformed, unsafe, or torn sidecar rejects the transfer and withholds
  the final ACK.
- The sidecar owns exact deterministic continuation state: full GameState snapshots and piece identity,
  RNG algorithm/state, pending garbage with provenance, attack-credit identity, wrapper/input/event
  sequence fences, hot-potato state, and attack/frag histories.
- Receiver-owned physical input is not imported during online apply. The local player's current held-input
  engine is preserved while remote simulation input restores canonically; host input state must not
  synthesize or clear keys physically held by the joining peer.
- A live, alive peer recovery uses a two-phase input barrier. An authenticated host `PREPARE` makes the peer
  freeze new command production before it restages and flushes retained input history. `READY` declares the
  peer's final sequence; the host may capture only after its authoritative consumer has advanced a
  contiguous acknowledgement through that sequence and the simulation is idle. The reliable payload
  echoes the exact request/fence/ack tuple, which the peer preflights against the sidecar before applying,
  pruning acknowledged history, and unfreezing.
- The barrier has separate bounded phases: five seconds to reach `READY`, then twenty seconds to transfer
  and apply. Until `READY`, the host owns a request-fenced timer that retransmits the identical `PREPARE`
  every 500 ms and retires it exactly at the deadline. Duplicate `PREPARE` retransmits the identical `READY`
  without reflushing or changing the fence; cleared callbacks cannot own a replacement request, and timeout,
  restart, disconnect, and request-specific cancellation retire queued captures and transfers.
- Terminal assembly, payload, sidecar, application-fence, application, and idle-apply failures return a
  closed-reason negative acknowledgement. ACK envelopes are default-denied unless they are exactly one of
  request, chunk ACK, final ACK, or rejection; a rejection is accepted only from the active transfer's bound
  peer and transfer ID. The host retires that exact transfer and barrier, then permits at most two fresh
  captures with new live-player barrier tokens in the same round. A third rejection fails the peer closed;
  success, restart, and disconnect reset the retry budget. Duplicate rejected chunks replay the first
  terminal verdict without rerunning validation or apply.
- Inbound assembly is byte/chunk/count bounded and exact apply is deferred until the receiver is idle.
  Older or equal capture fences are rejected, and a successful final ACK invalidates the delta baseline so
  the next gameplay snapshot is a keyframe.
- Missing sidecars remain an instrumented, recovery-only compatibility fallback while protocol/simulation
  version gates are still being introduced. Unknown present versions never fall back silently.
- This source-host capture does not make migration exact by itself. §6A.7 must distribute/cache a canonical
  idle sidecar (or collect one after election) before a newly promoted peer may promise exact resyncs.

## Consequences

- Reliable join/recovery transfers grow, while the high-frequency v1 and v2 gameplay snapshot budgets do
  not change.
- Live recovery briefly freezes locally produced commands, but retained history is replayed in bounded
  canonical groups and input is always released on success or cancellation. Host acknowledgements never
  jump across a missing sequence.
- New peers can still recover a renderable state from an old host, but that path emits
  `resync_sidecar_missing` and is not evidence of deterministic continuation.
- The JSON sidecar is not the compact 60 Hz rollback savestate required by §5.9/§6B; it is intentionally a
  separate, infrequent recovery artifact.
- A failed transfer never earns the final applied ACK or decoder baseline. Recovery costs a fresh capture
  instead of retransmitting bytes already proven unusable, and its bounded retry budget prevents a frozen
  peer from cycling indefinitely.

## Enforcement

`src/core/multiplayer/ffa/resync-payload.js` owns safe-window capture and the unique double fence.
`resync-sidecar.js` owns schema capture, validation, and exact application. `resync-input-barrier.js` owns
the two-phase live-input transaction; `ffa-input-batching.js` owns retained-history replay and contiguous
consumption acknowledgements. `resync-coordinator.js` owns bounded transfer/assembly, idle apply,
monotonic receiver fences, and final-ACK retirement; `resync-retry-policy.js` owns cached terminal verdicts
and the per-peer fresh-capture budget. Focused tests pin clustered-piece continuation, seed
zero and RNG cursor, garbage provenance, detached validation, fence/roster rejection, capture tearing,
validation ordering, mixed-build fallback, duplicate/lost control packets, prefix replay, timeout and
disconnect retirement, authoritative ACK catch-up, receiver-idle apply, mutually exclusive ACK variants,
sender/transfer-bound rejection, stale-timer safety, retry exhaustion, and final-ACK keyframe behavior.
