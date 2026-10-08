/* eslint-disable import/no-unresolved */
/**
 * Murmuration — quality tiers and the fit of the swarm to the frame.
 *
 * Shared by the theme and its playground effect so both build the same picture.
 */
import * as THREE from 'three';

/** The swarm's centre: a little behind the screen plane, so it wraps the board in depth. */
export const SWARM_FOCAL = Object.freeze({ x: 0, y: 0, z: -1.5 });

/**
 *   enablePost / useMRT  the post stack, and selective bloom from the emissive target
 *   light                the swarm's TOTAL light, relative to the Low tier (see swarmLook)
 *   aperture / maxBlur   the lens: blur per unit of defocus, and its ceiling (world units)
 *   stretch              seconds of screen-space velocity drawn as a streak
 *   skyDetail            nebula octaves ('low' = three octaves, one warp)
 */
export const QUALITY_PRESETS = Object.freeze({
    Minimal: Object.freeze({
        enablePost: false,
        useMRT: false,
        enableFluid: true,
        light: 0.8,
        aperture: 0.005,
        maxBlur: 0.06,
        stretch: 0.035,
        skyDetail: 'low',
    }),
    Low: Object.freeze({
        enablePost: true,
        useMRT: false,
        enableFluid: true,
        light: 1,
        aperture: 0.005,
        maxBlur: 0.08,
        stretch: 0.04,
        skyDetail: 'low',
    }),
    Medium: Object.freeze({
        enablePost: true,
        useMRT: true,
        enableFluid: true,
        light: 1.05,
        aperture: 0.006,
        maxBlur: 0.1,
        stretch: 0.05,
        skyDetail: 'high',
    }),
    High: Object.freeze({
        enablePost: true,
        useMRT: true,
        enableFluid: true,
        light: 1.1,
        aperture: 0.006,
        maxBlur: 0.12,
        stretch: 0.055,
        skyDetail: 'high',
    }),
    Ultra: Object.freeze({
        enablePost: true,
        useMRT: true,
        enableFluid: true,
        light: 1.15,
        aperture: 0.007,
        maxBlur: 0.14,
        stretch: 0.06,
        skyDetail: 'high',
    }),
    Extreme: Object.freeze({
        enablePost: true,
        useMRT: true,
        enableFluid: true,
        light: 1.2,
        aperture: 0.007,
        maxBlur: 0.16,
        stretch: 0.06,
        skyDetail: 'high',
    }),
});

/**
 * The glow the post stack draws round the board: just enough that the card sits in the
 * swarm's light instead of on top of it. (radius and glow are fractions of the frame.)
 */
export const BOARD_HALO = Object.freeze({ strength: 0.1, radius: 0.02, glow: 0.07 });

/**
 * How far play may lift the bloom above the tier's resting strength (which is about 0.3):
 * a long chain, a reward, a lock's punch. Small on purpose — bloom is a veil over the whole
 * frame, and the sky has to stay dark for the swarm to read as light.
 */
export const BLOOM_REACTION = Object.freeze({ combo: 0.06, reward: 0.04, punch: 0.4 });

/**
 * Renderer tone-mapping exposure for the tier without a post stack. three's ACES curve
 * carries a built-in 1/0.6 gain; this takes it back out so the sky stays as dark as the
 * post stack leaves it.
 */
export const NO_POST_EXPOSURE = 0.6;

export function normalizeQuality(name) {
    return typeof name === 'string' && Object.hasOwn(QUALITY_PRESETS, name) ? name : 'High';
}

/** The count at which a mote has its authored size, and the Low tier's total light. */
const SIZE_REFERENCE_COUNT = 24000;
const LIGHT_UNIT = 22000;

/**
 * The mote size and per-mote exposure for a tier at a given count.
 *
 * More motes are smaller motes (finer grain), and the swarm's TOTAL light — count × area ×
 * exposure — is what each tier fixes. Without that a tier with five times the motes is five
 * times the light, and the swarm stops being points of light on a dark sky and becomes a
 * glowing slab: the first native capture at 110 000 motes was exactly that.
 */
export function swarmLook(qualityName, count) {
    const preset = QUALITY_PRESETS[normalizeQuality(qualityName)];
    const n = Math.max(1, count);
    const sizeMul = Math.max(0.5, Math.min(1.5, (SIZE_REFERENCE_COUNT / n) ** 0.36));
    return { sizeMul, exposure: (preset.light * LIGHT_UNIT) / (n * sizeMul * sizeMul) };
}

const _toFocal = new THREE.Vector3();

/** Half-extents of the view at the focal plane (world units). */
export function frameHalfExtents(camera, focal = SWARM_FOCAL, restFov = null) {
    const fov = (((restFov ?? camera.fov) || 38) * Math.PI) / 180;
    const distance = _toFocal.set(focal.x, focal.y, focal.z).distanceTo(camera.position);
    const halfHeight = Math.tan(fov * 0.5) * distance;
    return { halfWidth: halfHeight * (camera.aspect || 1), halfHeight, distance };
}

/**
 * The swarm's size for a frame. A wide screen gets wings either side of the board; a
 * phone gets a tall loop that shows above and below it.
 * @returns {{ extent: THREE.Vector3, shapeHalfWidth: number, shapeHalfHeight: number,
 *   crowding: number }} crowding ≥ 1 is how much denser than the authored landscape swarm
 *   this frame packs the motes.
 */
export function swarmFrame(camera, radius, focal = SWARM_FOCAL, restFov = null) {
    const frame = frameHalfExtents(camera, focal, restFov);
    const wideX = radius;
    const wideY = radius * 0.48;
    const x = Math.min(wideX, frame.halfWidth * 0.94);
    const y = Math.min(wideY, frame.halfHeight * 0.8);
    return {
        extent: new THREE.Vector3(x, y, radius * 0.46),
        halfWidth: frame.halfWidth,
        halfHeight: frame.halfHeight,
        shapeHalfWidth: frame.halfWidth * 0.9,
        shapeHalfHeight: frame.halfHeight * 0.86,
        crowding: (wideX * wideY) / Math.max(0.01, x * y),
    };
}

/**
 * Where formations go for a frame whose middle is taken by the board(s). With room either
 * side, a figure is drawn as a mirrored pair flanking the board — a single figure centred
 * behind the card would be half hidden by it. Without room (a phone), one centred figure.
 *
 * @param {{ halfWidth: number, halfHeight: number }} frame  the view at the focal plane
 * @param {number} blockedHalfWidth  half-width of the span the boards cover (world units)
 */
export function shapeLayout(frame, blockedHalfWidth) {
    const blocked = Math.max(0, blockedHalfWidth || 0);
    const margin = frame.halfWidth - blocked;
    const halfHeight = frame.halfHeight * 0.86;
    if (blocked > 0 && margin >= Math.max(3, blocked * 1.2)) {
        return {
            twin: true,
            offsetX: blocked + margin * 0.5,
            halfWidth: margin * 0.46,
            halfHeight,
        };
    }
    return {
        twin: false, offsetX: 0, halfWidth: frame.halfWidth * 0.9, halfHeight,
    };
}

/**
 * A narrow frame packs the same motes into a fraction of the area. Light per mote falls
 * nearly as fast as the swarm is crowded, and the motes shrink a little, so a phone's
 * loop glows like the wide swarm instead of burning out.
 */
export function applyCrowding(visual, look, crowding) {
    if (!visual) return;
    const c = Math.max(1, crowding || 1);
    visual.baseExposure = look.exposure / c ** 0.85;
    if (visual.uniforms?.uSizeMul) visual.uniforms.uSizeMul.value = look.sizeMul / c ** 0.2;
}

/** Apply a `swarmFrame` to a running simulation (resize). */
export function applySwarmFrame(sim, frame) {
    sim.setExtent(frame.extent.x, frame.extent.y, frame.extent.z);
    sim.setShapeFit(frame.shapeHalfWidth, frame.shapeHalfHeight);
}

const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * A window fraction (x right, y DOWN) → the world point where its view ray meets the
 * plane z = planeZ. Writes into `out`; returns false when the ray never reaches it.
 */
export function projectToPlane(camera, sx, sy, planeZ, out) {
    _ndc.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera);
    _dir.copy(_ndc).sub(camera.position);
    if (Math.abs(_dir.z) < 1e-6) return false;
    const t = (planeZ - camera.position.z) / _dir.z;
    if (!(t > 0)) return false;
    out.x = camera.position.x + _dir.x * t;
    out.y = camera.position.y + _dir.y * t;
    out.z = planeZ;
    return true;
}
