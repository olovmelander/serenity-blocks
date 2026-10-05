/**
 * The accretion disk's plane — the one definition every disk-aligned layer derives from
 * (the lens, the dust, fed pieces, ejecta and the jets), so they can never disagree.
 *
 * The disk is tilted about world +X by DISK_TILT from the XY plane. In world space:
 *   U (along the disk)  = (1, 0, 0)
 *   V (across the disk) = (0, cos(tilt), -sin(tilt))
 *   N (the disk normal) = (0, sin(tilt),  cos(tilt))
 * The lens works in a frame whose axes are U, N and -V, so +Y there is the normal.
 */
export const DISK_TILT = Math.PI * 0.42;
export const DISK_COS_TILT = Math.cos(DISK_TILT);
export const DISK_SIN_TILT = Math.sin(DISK_TILT);
