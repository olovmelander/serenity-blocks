/**
 * Kaleidosonic — shared TSL: the uniforms every part reads and the pure helpers they share.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU. The world writes it; the
 * materials read it. Pure arithmetic helpers carry a layout (one real function each in the
 * generated shader); anything that reads a uniform is an inline builder.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, Break, abs, atan, cos, dot, float, floor, fract, int, max, min, mix, normalize, sign, sin, uniform,
    uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import { MOODS, MOOD_COLOURS, TEMPLE } from './kaleidosonic-core.js';

export * from './kaleidosonic-core.js';

/** Event slots: strikes (three rows each) and harmonics (two rows each). */
export const STRIKES = 12;
export const STRIKE_ROWS = 3;
export const HARMONICS = 4;
export const HARMONIC_ROWS = 2;

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const ksHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ks_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0, 1) */
export const ksHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(pIn.mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.zyx.add(31.32)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ks_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

export const ksLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const ksMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * The temple's field: the Apollonian fold-and-invert, run to a fractional number of folds
 * (`prm.y`, blended between the whole counts either side so the temple grows finer without a
 * pop), with an inversion strength `prm.x`. Returns (distance, trap.x, trap.y, trap.r²): the
 * orbit's nearest approach to the cell's planes and centre, which colours the pearl.
 * `maxFolds` is a build-time cap (the tier's).
 */
export function createTempleField(maxFolds) {
    const cap = Math.max(2, Math.round(maxFolds));
    return Fn(([pIn, prm]) => {
        const p = pIn.toVar();
        const scale = float(1).toVar();
        const trap = vec4(1000).toVar();
        const lo = floor(min(prm.y, float(cap - 1))).toVar();
        const dLo = float(1).toVar();
        const dHi = float(1).toVar();
        Loop(cap, ({ i }) => {
            p.assign(fract(p.mul(0.5).add(0.5)).mul(2).sub(1));
            const r2 = max(dot(p, p), 1e-6).toVar();
            trap.assign(min(trap, vec4(abs(p), r2)));
            const k = prm.x.div(r2);
            p.mulAssign(k);
            scale.mulAssign(k);
            const n = float(i).add(1.0);
            const d = abs(p.y).mul(0.25).div(scale);
            If(n.equal(lo), () => {
                dLo.assign(d);
            });
            If(n.greaterThan(lo), () => {
                dHi.assign(d);
                Break();
            });
        });
        const f = min(prm.y, float(cap)).sub(lo).clamp(0.0, 1.0);
        return vec4(mix(dLo, dHi, f), trap.x, trap.z, trap.w);
    }).setLayout({
        name: `ks_temple${cap}`,
        type: 'vec4',
        inputs: [{ name: 'pIn', type: 'vec3' }, { name: 'prm', type: 'vec4' }],
    });
}

/**
 * A polar kaleidoscope of n sectors about the lens's axis, centred on the angle a0 (mirror-folded).
 * Returns the folded point and the sector's parity (0 or 1: alternate sectors take another colour).
 */
const polarFold = (xy, a0, n) => {
    const r = xy.length();
    const wedge = Math.PI / n;
    // (a hair added to x: atan(0, 0) is undefined in GLSL and WGSL)
    const local = atan(xy.y, xy.x.add(1e-7)).sub(a0);
    const sector = floor(local.add(wedge).div(2 * wedge));
    const m = local.add(wedge).sub(sector.mul(2 * wedge)).sub(wedge);
    // a hair of softness at the mirror line, so a pearl it crosses is not split by a crease
    const a = a0.add(m.mul(m).add(0.00002).sqrt());
    // sectors counted round the circle (the angle's branch cut must not flip a colour)
    const round = sector.sub(floor(sector.div(n)).mul(n));
    const parity = round.sub(floor(round.mul(0.5)).mul(2.0));
    return { xy: vec2(cos(a), sin(a)).mul(r), parity };
};

/**
 * The kaleidoscope, in three stages that open one after another: a mirror whose line runs through
 * the lens's axis square to the core's bearing (the core's half kept, so as the eye rolls the
 * mirror turns with it and never flips), then six sectors, then twelve, all centred on the core's
 * bearing from the lens's axis. Each stage blends in by its own strength, so the picture folds
 * continuously. lens = (core bearing a0, -, -, -); s = (bilateral, six, twelve, -).
 * Returns (direction, how far the ray's sector is an "other" one: 0..1, for the alternate colour).
 */
export const ksLensFold = /* @__PURE__ */ Fn(([dIn, lens, s]) => {
    const d = dIn.toVar();
    const xy = d.xy.toVar();
    const other = float(0).toVar();
    const n = vec2(cos(lens.x), sin(lens.x)).toVar();
    const dn = dot(xy, n).toVar();
    // reflected across the line where it is on the far side (softened by a hair at the line)
    const mirrored = xy.add(n.mul(dn.mul(dn).add(0.000004).sqrt().sub(dn)));
    other.assign(mix(other, float(0.5).sub(sign(dn).mul(0.5)), s.x));
    xy.assign(mix(xy, mirrored, s.x));
    // six sectors (three mirrored pairs) cannot alternate round an odd ring: no colour of their own
    const six = polarFold(xy, lens.x, 3);
    xy.assign(mix(xy, six.xy, s.y));
    other.assign(other.mul(float(1).sub(s.y.mul(0.5))));
    const twelve = polarFold(xy, lens.x, 6);
    xy.assign(mix(xy, twelve.xy, s.z));
    other.assign(mix(other, max(other, twelve.parity), s.z));
    return vec4(normalize(vec3(xy, d.z)), other);
}).setLayout({
    name: 'ks_lensFold',
    type: 'vec4',
    inputs: [{ name: 'dIn', type: 'vec3' }, { name: 'lens', type: 'vec4' }, { name: 's', type: 'vec4' }],
});

// ── Uniforms ──────────────────────────────────────────────────────────────────────

/** Rows of a vec4 table, written in place by the world (uniformArray copies .x .y .z .w). */
export function vec4Rows(n) {
    return Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));
}

export function createUniforms() {
    const strikes = vec4Rows(STRIKES * STRIKE_ROWS);
    const harmonics = vec4Rows(HARMONICS * HARMONIC_ROWS);
    const moodRows = vec4Rows(MOOD_COLOURS.length * 2);
    const m0 = MOODS[0];
    MOOD_COLOURS.forEach((key, i) => {
        moodRows[i].set(m0[key][0], m0[key][1], m0[key][2], 1);
        moodRows[i + MOOD_COLOURS.length].set(m0[key][0], m0[key][1], m0[key][2], 1);
    });
    return {
        tables: { strikes, harmonics, moods: moodRows },
        /** The shaders' clock, wrapped (seconds mod 3600). */
        time: uniform(0),
        /** The veins' flow (integrated: its rate follows the trance), wrapped. */
        breath: uniform(0),
        /** The core's pulse (integrated phase, radians, wrapped). */
        pulse: uniform(0),
        /** The scene camera, copied each frame (the march builds its rays from them). */
        camWorld: uniform(new THREE.Matrix4()),
        projInv: uniform(new THREE.Matrix4()),
        /** Radians one buffer pixel subtends at the lens's centre (sets the march's hit tolerance). */
        pixelAngle: uniform(0.0012),
        /** (inversion strength s, folds (fractional), -, -). */
        shape: uniform(new THREE.Vector4(TEMPLE.s, TEMPLE.detailRest, 0, 0)),
        /** The dive's offset of the temple's coordinates (the stone flows past the eye). */
        dive: uniform(new THREE.Vector3(0, 0, 0)),
        /** The kaleidoscope: (core bearing, -, -, -) and the stages' strengths. */
        lens: uniform(new THREE.Vector4(Math.PI, 0, 0, 0)),
        lensS: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /**
         * The resonant core: (x, y, z, radius) in world space, and (pulse light, drone, sink, flare).
         * The pulse light lights the stone; the flare (events) brightens only the core itself.
         */
        heart: uniform(new THREE.Vector4(0, 1, 0, 0.05)),
        heartState: uniform(new THREE.Vector4(1, 0, 0, 0)),
        /** (trance 0..1, resonance 0..2 (the whole temple's veins), mandala 0..1, flash 0..1). */
        state: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Fog density per unit and the air's glow gain. */
        air: uniform(new THREE.Vector4(0.42, 1, 0, 0)),
        /** The two moods' colours (stoneA, stoneB, vein, heart, haze, glow) ×2, and the mix. */
        moods: uniformArray(moodRows, 'vec4'),
        moodMix: uniform(0),
        /** Live rows: strikes, harmonics. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        strikes: uniformArray(strikes, 'vec4'),
        harmonics: uniformArray(harmonics, 'vec4'),
        exposure: uniform(1),
        /** The latest strike's wavefront for the jewels it rings: (origin, radius), (rgb, strength). */
        pingStrike: uniform(new THREE.Vector4(0, 0, 0, -1)),
        pingStrikeCol: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The latest harmonic's shell about the core: (radius, strength, -, -) and its colour. */
        pingHarm: uniform(new THREE.Vector4(-1, 0, 0, 0)),
        pingHarmCol: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
}

/** A mood colour by name, blended between the two moods by `k` (0 = mood A). */
export function moodColour(u, key, k) {
    const i = MOOD_COLOURS.indexOf(key);
    const a = u.moods.element(int(i)).xyz;
    const b = u.moods.element(int(i + MOOD_COLOURS.length)).xyz;
    return mix(a, b, k);
}
