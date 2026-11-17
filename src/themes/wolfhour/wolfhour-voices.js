/**
 * Wolfhour — the howl made visible.
 *
 * While a wolf holds its note, arcs of pale light leave its muzzle one after another and widen
 * into the cold air toward the moon, thinning as they go: the voice of the pack, the wolf across
 * the valley's answer, the white wolf's on the summit, a lone wolf's on the ridge. A chorus fills
 * the valley with them. Each arc is one small additive quad whose shader draws a ring that widens
 * with its age and keeps only the part that opens toward the moon; the CPU writes an arc once, when
 * it is born (a ring buffer), and nothing after.
 *
 * Under Reduce motion the arcs still show (they are how the howl is seen) but slower and fewer.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, attribute, clamp, cos, exp, float, length, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';
import { flatVarying } from '../shared/flat-varying.js';
import { createWolfhourNightLight } from './wolfhour-sky.js';

/** An arc: how long it lives (seconds), how far it widens (world units at strength 1), its light. */
export const VOICE = Object.freeze({
    life: 2.8,
    reach: 190,
    every: 0.62,
    /** Half the angle an arc opens over (radians), about the direction it travels. */
    open: 1.15,
});
const ARC_LIGHT = vec3(0.34, 0.44, 0.7);

/** Arcs alive at once, by tier. */
/** How far through its life an arc must be before its slot is given to a new one (it is faint by then). */
const VOICE_REUSE = 0.85;
const CAPACITY = Object.freeze({
    Minimal: 10, Low: 18, Medium: 36, High: 48, Ultra: 56, Extreme: 64,
});

/**
 * Creates the voices (no renderer). `update(time, voices, motion)` takes the howling muzzles in
 * world space ([x, y, z, level] each: wolfhour-wolves.js `voices()`), and `moon` the moon's place
 * (world x, y) the arcs open toward.
 */
export function createWolfhourVoices({ quality = 'High', nightLight = createWolfhourNightLight() } = {}) {
    const capacity = CAPACITY[quality] ?? CAPACITY.High;
    const geometry = new THREE.PlaneGeometry(2, 2);
    // Per arc: when it was born, how strong, the way it travels (radians), a seed.
    const born = new Float32Array(capacity * 4).fill(-1e3);
    const bornAttribute = new THREE.InstancedBufferAttribute(born, 4);
    bornAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aVoice', bornAttribute);
    const uTime = uniform(0);
    const uSlow = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour howl arcs',
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    });
    const voice = flatVarying(attribute('aVoice', 'vec4'), 'wolfhourVoice');
    const arc = Fn(() => {
        const p = uv().sub(0.5).mul(2).toVar();
        const age = clamp(uTime.sub(voice.x).mul(uSlow).div(VOICE.life), 0, 1).toVar();
        const r = length(p).toVar();
        // The ring widens fast and slows (the square root of its age), and thins as it goes.
        const radius = age.sqrt().mul(0.92).toVar();
        const width = age.mul(0.02).add(0.007);
        const ring = exp(r.sub(radius).div(width).pow2().negate());
        // Only the part that opens the way it travels, feathered at its ends and a little uneven.
        const angle = atan(p.y, p.x.add(1e-5)).sub(voice.z);
        const across = cos(angle);
        const opening = smoothstep(Math.cos(VOICE.open), Math.cos(VOICE.open * 0.45), across);
        const waver = sin(angle.mul(9).add(voice.w.mul(40)).add(age.mul(5))).mul(0.18).add(0.82);
        const fade = smoothstep(0, 0.08, age).mul(float(1).sub(age).pow(1.6));
        return ring.mul(opening).mul(waver).mul(fade).mul(voice.y);
    })();
    material.colorNode = ARC_LIGHT.mul(nightLight.uGlow);
    material.opacityNode = arc;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'Wolfhour howl arcs';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, matrix.makeScale(0.001, 0.001, 1));
    let cursor = 0;
    let lastBirth = -Infinity;
    /** When each voice last sent an arc, by its place in the list (voices keep their order). */
    const lastOf = [];
    const moon = new THREE.Vector2(-300, 340);
    let reach = 1;
    return {
        mesh,
        capacity,
        /** Where the moon stands (world x, y): the arcs open toward it. */
        setMoon(x, y) {
            if (Number.isFinite(x) && Number.isFinite(y)) moon.set(x, y);
        },
        /** How far the arcs widen, as a share of their full reach (a narrow screen's are smaller). */
        setReach(scale) {
            reach = Number.isFinite(scale) ? Math.min(1, Math.max(0.35, scale)) : 1;
        },
        /** Arcs still in the air at `time`. */
        alive(time) {
            let n = 0;
            for (let i = 0; i < capacity; i++) if (time - born[i * 4] < VOICE.life / uSlow.value) n += 1;
            return n;
        },
        /**
         * `voices`: [x, y, z, level] of every howling muzzle (world space); `motion` 0..1 (below
         * 0.5 the arcs come half as often and widen at 0.6 of the speed).
         */
        update(time, voices = [], motion = 1) {
            const t = Number.isFinite(time) ? time : 0;
            const calm = motion < 0.5;
            uTime.value = t;
            uSlow.value = calm ? 0.6 : 1;
            const every = VOICE.every * (calm ? 2 : 1);
            let wrote = false;
            for (let v = 0; v < voices.length; v++) {
                const [x, y, z, level] = voices[v];
                if (!(level > 0.45)) continue;
                const last = lastOf[v] ?? -Infinity;
                // A seek backward starts the count again.
                if (t < last) lastOf[v] = -Infinity;
                if (t - (lastOf[v] ?? -Infinity) < every * (0.9 + (v % 3) * 0.12)) continue;
                // Never cut an arc still in the air: the oldest slot is taken only once its arc
                // has all but faded (a full chorus on a small tier waits a frame or two instead).
                if (t >= born[cursor * 4] && t - born[cursor * 4] < (VOICE.life / uSlow.value) * VOICE_REUSE) continue;
                lastOf[v] = t;
                const size = VOICE.reach * reach * (0.55 + 0.45 * Math.min(1, level));
                // Up and toward the moon: more up than across.
                const toward = Math.atan2((moon.y - y) * 0.5 + 220, moon.x - x);
                matrix.makeScale(size, size, 1);
                matrix.setPosition(x, y, z + 2);
                mesh.setMatrixAt(cursor, matrix);
                const o = cursor * 4;
                born[o] = t;
                born[o + 1] = Math.min(1, level) * 0.42;
                born[o + 2] = toward;
                born[o + 3] = ((cursor * 0.618) % 1);
                cursor = (cursor + 1) % capacity;
                lastBirth = t;
                wrote = true;
            }
            if (wrote) {
                mesh.instanceMatrix.needsUpdate = true;
                bornAttribute.needsUpdate = true;
            }
            mesh.visible = t - lastBirth < VOICE.life / uSlow.value && t >= lastBirth;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}
