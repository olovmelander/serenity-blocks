// ─────────────────────────────────────────────────────────────────────────────
// Accretion-disk local basis — single source of truth (plan §0.1)
//
// Every disk-aligned system derives its plane from these constants so the visible
// disk surface, the ambient particles, and the combo bursts share exactly ONE tilt
// rather than each re-hardcoding the same magic numbers:
//   - black-hole-compute.js  : particle + burst physics (CPU/GPU integration)
//   - black-hole-materials.js: the matching TSL materials (rendering placement)
//
// The disk is authored in local XY (see RingGeometry) and tilted about local +X by
// DISK_TILT. Expressing the tilt as a positive magnitude makes the world-space basis
// explicit:
//   U (local +X) = (1, 0, 0)
//   V (local +Y) = (0, cos(tilt), -sin(tilt))
//   N            = (0, sin(tilt),  cos(tilt))
//
// NOTE: Hawking radiation is intentionally isotropic (emitted from the horizon in all
// directions), so it does NOT lie on this plane — that is physically correct, not a
// coordinate-system inconsistency.
// ─────────────────────────────────────────────────────────────────────────────

export const DISK_TILT = Math.PI * 0.42;
export const DISK_COS_TILT = Math.cos(DISK_TILT);
export const DISK_SIN_TILT = Math.sin(DISK_TILT);
