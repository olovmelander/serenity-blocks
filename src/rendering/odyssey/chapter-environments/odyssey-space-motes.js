/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview SPACE THAT MOVES PAST YOU (2026-11-02, chapter 6).
 *
 * Olov: "Can we improve the particles in space?" Chapter 6 kept two star shells and a far fine
 * dust after the clutter pass (CH6_AMBIENT), and all three sit hundreds of units out: from the
 * rail they are fixed points, so a glide between orbs moved nothing but the planet, and space
 * read as a painted backdrop. The near dust that used to move ("like falling snow") was dropped.
 *
 * This is a sparse field of soft motes NEAR the eye, at many depths:
 * - **World-fixed, in a box that travels with the eye.** Each mote has a place in the world; when
 *   it leaves the box round the eye it wraps to the far side (faded at the box's faces and close
 *   to the eye, so nothing pops). Gliding between orbs carries the eye through them: parallax.
 * - **Streaked by the eye's own speed.** On a glide each mote stretches along the eye's motion
 *   as seen on screen (its light kept the same), and at rest it is a soft point.
 * - **Pulled toward the hole** as the omen grows: the field drifts toward it and warms from the
 *   cool white of starlight to the disk's amber.
 * - **Not snow.** No fall, no even white: most motes are dim, cool blue-white, violet or pale
 *   gold, a few are brighter glints that breathe slowly.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, clamp, cross, dot, exp, float, length, max, mix, mod, normalize, oneMinus,
    positionLocal, sin, smoothstep, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { mulberry32 } from './shared/odyssey-neon-city-plan.js';

/** The field's shape and look. */
export const SPACE_MOTES = Object.freeze({
    count: 240,
    /** The box round the eye the field wraps in (world units). */
    box: 130,
    /** No mote nearer the eye than this (it would fill the lens), faded in over `nearFade`. */
    near: 7,
    nearFade: 10,
    /** Soft size range (world units); most small (a power law), a few large and dim. */
    sizeMin: 0.2,
    sizeMax: 1.2,
    /** Share of motes that are glints (brighter, breathing). */
    glintShare: 0.07,
    /** How long the "shutter" stays open for the streak (s), and its longest stretch (world units). */
    shutter: 0.11,
    streakMax: 6,
    /** The pull toward the hole (world units per second at full pull). */
    pullSpeed: 9,
    /** Light: a dim mote, a glint. */
    gain: 2.4,
    glintGain: 4.5,
});

/** Starlight colours (sRGB): cool blue-white, faint violet, pale gold. */
const PALETTE = [
    [200, 220, 255],
    [186, 168, 255],
    [255, 226, 176],
];
/** The disk's amber the field warms toward in the pull (linear). */
const PULL_WARM = new THREE.Color(1.0, 0.56, 0.24);

/**
 * Build the motes.
 * @param {{ uTime: * }} uniforms the chapter's uniforms (uTime)
 * @param {{ count?: number, seed?: number }} [options]
 * @returns {{ mesh: THREE.Mesh, uniforms: object }}
 */
export function createSpaceMotes(uniforms, { count = SPACE_MOTES.count, seed = 6206 } = {}) {
    const S = SPACE_MOTES;
    const rand = mulberry32(seed);
    const base = new Float32Array(count * 3);
    const look = new Float32Array(count * 4);
    const tint = new Float32Array(count * 3);
    const linear = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
        base.set([rand(), rand(), rand()], i * 3);
        const glint = rand() < S.glintShare ? 1 : 0;
        // Power-law size: most motes small, a few large (and the large ones dimmer, like out-of-focus dust).
        const r = rand();
        const size = S.sizeMin + ((S.sizeMax - S.sizeMin) * r * r * r);
        look.set([size, glint, rand() * Math.PI * 2, 0.35 + (0.65 * rand())], i * 4);
        const [cr, cg, cb] = PALETTE[Math.floor(rand() * PALETTE.length)];
        linear.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
        tint.set([linear.r, linear.g, linear.b], i * 3);
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: base, itemSize: 3 },
        aLook: { array: look, itemSize: 4 },
        aTint: { array: tint, itemSize: 3 },
    });

    const u = {
        /** The eye in the field's parent frame (the chapter group is translated, never turned). */
        eye: uniform(new THREE.Vector3()),
        /** The eye's velocity (units/s), same frame. */
        velocity: uniform(new THREE.Vector3()),
        /** How far the field has drifted toward the hole (same frame). */
        flow: uniform(new THREE.Vector3()),
        /** 0..1 the pull's warmth. */
        warm: uniform(0),
        /** 0..1 the field's presence. */
        reveal: uniform(0),
    };
    const time = uniforms.uTime;

    const aBase = attribute('aBase', 'vec3');
    const aLook = attribute('aLook', 'vec4'); // size, glint, phase, brightness
    const aTint = attribute('aTint', 'vec3');
    const box = float(S.box);
    // World-fixed, wrapped into the box round the eye.
    const offset = mod(aBase.mul(box).add(u.flow).sub(u.eye).add(box.mul(0.5)), box).sub(box.mul(0.5));
    const centre = u.eye.add(offset);
    const dist = length(offset);
    // Faded at the box's faces (a wrap is never seen) and near the eye.
    const edge = max(max(abs(offset.x), abs(offset.y)), abs(offset.z)).div(box.mul(0.5));
    const presence = oneMinus(smoothstep(0.72, 0.98, edge))
        .mul(smoothstep(S.near, S.near + S.nearFade, dist));

    // The billboard, stretched along the eye's motion as seen from the eye (the motes stream
    // past the other way: the quad is symmetric, so the sign does not matter).
    const toEye = normalize(u.eye.sub(centre));
    const motion = u.velocity.sub(toEye.mul(dot(u.velocity, toEye)));
    const travel = length(motion).mul(S.shutter).min(S.streakMax);
    const fallbackRight = normalize(cross(vec3(0, 1, 0), toEye));
    const along = normalize(mix(fallbackRight, motion.div(max(length(motion), 1e-4)), smoothstep(0.0, 0.02, travel)));
    const across = normalize(cross(toEye, along));
    const size = aLook.x;
    const corner = positionLocal.xy;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Odyssey space motes';
    material.positionNode = centre
        .add(along.mul(corner.x.mul(size.add(travel))))
        .add(across.mul(corner.y.mul(size)));

    material.outputNode = Fn(() => {
        // A soft gaussian along the (stretched) quad; its light spread over the streak's length.
        const p = uv().sub(0.5).mul(2.0);
        const soft = exp(p.x.mul(p.x).add(p.y.mul(p.y)).mul(-4.2));
        const spread = size.div(size.add(travel));
        const breathe = sin(time.mul(0.9).add(aLook.z)).mul(0.5).add(0.5);
        const glint = aLook.y;
        // Large motes are near-defocus dust: dimmer the larger they are.
        const defocus = clamp(float(0.45).div(size), 0.35, 1.0);
        const dim = float(S.gain).mul(aLook.w).mul(defocus);
        const bright = float(S.glintGain).mul(breathe.mul(0.6).add(0.4));
        const light = mix(dim, bright, glint);
        const colour = mix(aTint, vec3(PULL_WARM.r, PULL_WARM.g, PULL_WARM.b), u.warm.mul(0.75));
        const shape = soft.mul(spread).mul(presence);
        const rgb = colour.mul(light).mul(shape).mul(u.reveal);
        // Premultiplied add: light only, the target's alpha left alone.
        return vec4(rgb, 0.0);
    })();
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.fog = false;
    material.userData.emitsBloom = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'space-motes';
    // The field always surrounds the eye.
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, uniforms: u };
}

const _eye = new THREE.Vector3();
const _toHole = new THREE.Vector3();

/**
 * Per frame: the eye, its velocity and the pull.
 * @param {{ mesh: THREE.Mesh, uniforms: object, state?: object }} motes
 * @param {THREE.Camera|null} camera
 * @param {THREE.Vector3} parentOrigin the parent group's world position (it is never turned)
 * @param {number} dt seconds
 * @param {{ reveal: number, pull: number, hole?: THREE.Vector3|null }} drive
 */
export function updateSpaceMotes(motes, camera, parentOrigin, dt, drive) {
    const u = motes.uniforms;
    const reveal = Math.max(0, Math.min(1, drive.reveal || 0));
    u.reveal.value = reveal;
    motes.mesh.visible = reveal > 0.002 && !!camera;
    if (!camera) return;
    const state = motes.state ?? (motes.state = { last: null, velocity: new THREE.Vector3() });
    _eye.copy(camera.position).sub(parentOrigin);
    const step = Math.max(1e-3, Math.min(0.1, dt || 0));
    if (state.last) {
        // Smoothed over ~0.08 s so a single uneven frame does not jerk the streaks.
        const raw = _eye.clone().sub(state.last).divideScalar(step);
        // A jump (a cut, a seek) is not a speed.
        if (raw.length() < 4000) state.velocity.lerp(raw, 1 - Math.exp(-step / 0.08));
        else state.velocity.set(0, 0, 0);
    }
    state.last = (state.last ?? new THREE.Vector3()).copy(_eye);
    u.eye.value.copy(_eye);
    u.velocity.value.copy(state.velocity);
    // The pull: drift toward the hole, warming as it grows.
    const pull = Math.max(0, Math.min(1, drive.pull || 0));
    u.warm.value = pull;
    if (pull > 0 && drive.hole) {
        _toHole.copy(drive.hole).sub(camera.position);
        if (_toHole.lengthSq() > 1e-6) {
            u.flow.value.addScaledVector(_toHole.normalize(), SPACE_MOTES.pullSpeed * pull * step);
            // Kept small: the wrap only needs the offset modulo the box.
            const b = SPACE_MOTES.box;
            u.flow.value.set(u.flow.value.x % b, u.flow.value.y % b, u.flow.value.z % b);
        }
    }
}
