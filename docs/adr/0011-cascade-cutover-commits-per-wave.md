# 0011 — Cascade cutover: resolver replay commits state per wave

- **Status:** accepted
- **Date:** 2026-07-11
- **Plan hook:** ARCHITECTURAL_REMEDIATION_PLAN.md § 5.2 ("Decision to make now, not defer")

## Context

The §5.2 pure `resolveCascade` (src/core/cascade-resolver.js, proven bit-exact
against legacy `processPhysics` by the differential suite) computes an entire
lock resolution — every wave's clears, hole masks, scoring, and settled board —
synchronously and up front. The cutover rewires `processPhysics` to *replay*
that precomputed result as the flash/gravity animation instead of discovering
it wave by wave.

That forces a choice the legacy path never had to make: when do the resolver's
results become visible on `gameState`?

- **Commit-per-wave:** the replay mutates `gameState` incrementally at each
  wave boundary — score, lines, level, board, comboState advance exactly when
  the legacy loop advanced them.
- **Commit-at-end:** the replay stamps the final result onto `gameState`
  immediately (or when the animation ends) and the animation is purely
  cosmetic.

The observable difference is not theoretical: 30 Hz multiplayer snapshots
capture mid-cascade `gameState` today, so opponents' boards, score displays,
and the desync digest (§5.11) all see *per-wave* values during a cascade.
Commit-at-end would change wire-visible timing for every MP peer and would
make the §5.10 shadow/differential machinery — which pins per-wave semantics —
unable to certify the cutover as behavior-preserving.

## Decision

**Commit-per-wave.** The replay engine applies each precomputed wave's state
delta at the same point in the animation timeline where the legacy loop
performed it (the schedule pinned by `physics-callback-schedule.test.js`).
The full-resolution result is used for what the KPI actually needs — the sim
outcome is *known* sub-ms after lock, so input handling, garbage summaries,
and any future rollback/prediction can read the resolved future without
waiting for the animation — but `gameState`'s public fields advance per wave,
exactly as before.

Consequences of the alternative we rejected: commit-at-end buys nothing the
KPI requires (input unblocking needs the *result* early, not the *state
mutation* early), while invalidating snapshot timing, the §5.11 digest
history, per-wave theme/juice callback payload expectations (60+ consumers),
and the golden demo corpus.

## Consequences

- The cutover's replay loop owns a small "apply wave N delta" step; the
  differential gate (unit suite + `cascadeShadow` production shadow) remains
  the certifier that per-wave values match legacy exactly.
- 30 Hz snapshots and the §5.11 per-tick digest keep their current semantics;
  no MP protocol or consumer change rides along with the cutover.
- If a future phase wants instant-commit semantics (e.g. §6B rollback), that
  is a *separate, flagged* behavior change with its own soak — not a silent
  property of the cutover.

## Enforcement

`tests/unit/physics-callback-schedule.test.js` (per-wave schedule goldens) and
`tests/unit/cascade-resolver-differential.test.js` pin the contract; the
`cascadeShadow` flag (§5.10) certifies it in production before legacy deletes.
