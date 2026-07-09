# 0004 - Host-authoritative P2P is the Multiplayer Model

- **Status:** accepted
- **Date:** 2026-07-09
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md Sections 1.2, 5, and 6

## Context

Serenity Blocks needs drop-in join, spectator/recovery behavior, Steam P2P hosting, and
casual multiplayer that remains playable at real home-network latency. Pure rollback or
strict deterministic lockstep would fight those product requirements and the current code.

## Decision

Use a hybrid model: every player owns a closed deterministic simulation of seed plus its
own input stream plus host-stamped external events. The host arbitrates round control,
garbage routing, kills, and validated authoritative events. Snapshots are for join,
recovery, spectator state, and interpolation; they are not gameplay truth.

## Consequences

- Casual/friends multiplayer can ship without a central relay server.
- The host is trusted for arbitration, so ranked play requires replay verification or a
  stronger trust layer before it is productized.
- Phase 5 and Phase 6 work must preserve host-stamped event truth and avoid coupling the
  local piece loop to network acknowledgements.

## Enforcement

The flag registry owns temporary netcode migration toggles. Phase 5 replay artifacts and
Phase 6 protocol tests enforce that authoritative placement/garbage events, not cosmetic
snapshots, are the source of truth.
