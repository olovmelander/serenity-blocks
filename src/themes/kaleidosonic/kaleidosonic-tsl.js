/**
 * Kaleidosonic — shared TSL: the uniforms every part reads and the pure helpers they share.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU. The world writes it; the
 * materials read it. Pure arithmetic helpers carry a layout (one real function each in the
 * generated shader); anything that reads a uniform is an inline builder.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, atan, cos, dot, float, floor, fract, int, max, min, mix, normalize, sign, sin, step,
    uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import {
    BEAM_AXES, MOODS, MOOD_COLOURS, TEMPLE, foldSplit,
} from './kaleidosonic-core.js';

export * from './kaleidosonic-core.js';

/**
 * Event slots: strikes (three rows each) and harmonics (two rows each). Eight harmonics: a chain's
 * clears and a cascade's waves (0.36 s apart) each sound one that rings for TIMING.harmonic, so the
 * core fills with nested shells instead of a few blinking in turn (the shaders loop only the live
 * ones).
 */
export const STRIKES = 12;
export const STRIKE_ROWS = 3;
export const HARMONICS = 8;
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

/** The lattice fold into [-1, 1): fract(p / 2 + 1 / 2) · 2 − 1, written with three ops fewer. */
const latticeFold = (p) => p.sub(floor(p.mul(0.5).add(0.5)).mul(2.0));

/**
 * The temple's field: the Apollonian fold-and-invert, run to a fractional number of folds (whole
 * folds `prm.z`, then the next one blended in by `prm.w`, so the temple grows finer without a
 * pop), with an inversion strength `prm.x`. prm is the shape uniform: (s, folds, whole, weight),
 * the last two from foldSplit(). Returns the distance only: the march calls it every step, so it
 * carries no orbit trap (createTempleTrap reads that once, at the hit) and runs no fold it would
 * weigh by 0. `maxFolds` is the tier's cap; the world never asks for fewer folds than
 * TEMPLE.detailRest, which run as a fixed loop the compiler can unroll.
 */
export function createTempleField(maxFolds) {
    const cap = Math.max(2, Math.round(maxFolds));
    const base = Math.min(cap, Math.floor(TEMPLE.detailRest));
    return Fn(([pIn, prm]) => {
        const p = pIn.toVar();
        const scale = float(1).toVar();
        const fold = () => {
            p.assign(latticeFold(p));
            const k = prm.x.div(max(dot(p, p), 1e-6)).toVar();
            p.mulAssign(k);
            scale.mulAssign(k);
        };
        Loop(base, fold);
        // the trance's further folds (the same count for every pixel: no divergence)
        Loop({
            start: int(base), end: int(prm.z), type: 'int', condition: '<', name: 'fd',
        }, fold);
        const d = abs(p.y).mul(0.25).div(scale).toVar();
        If(prm.w.greaterThan(0.0), () => {
            fold();
            d.assign(mix(d, abs(p.y).mul(0.25).div(scale), prm.w));
        });
        return d;
    }).setLayout({
        name: `ks_temple${cap}`,
        type: 'float',
        inputs: [{ name: 'pIn', type: 'vec3' }, { name: 'prm', type: 'vec4' }],
    });
}

/**
 * The orbit trap at a point of the field (same prm): the orbit's nearest approach to the cell's
 * planes and centre, (|x|, |z|, r²), which colours the pearl. It runs every fold the distance may
 * have (the blended one too, at any weight), as the field always has.
 */
export function createTempleTrap(maxFolds) {
    const cap = Math.max(2, Math.round(maxFolds));
    return Fn(([pIn, prm]) => {
        const p = pIn.toVar();
        const trap = vec4(1000).toVar();
        Loop({
            start: int(0), end: min(int(prm.z).add(1), int(cap)), type: 'int', condition: '<', name: 'tf',
        }, () => {
            p.assign(latticeFold(p));
            const r2 = max(dot(p, p), 1e-6).toVar();
            trap.assign(min(trap, vec4(abs(p), r2)));
            p.mulAssign(prm.x.div(r2));
        });
        return trap.xzw;
    }).setLayout({
        name: `ks_templeTrap${cap}`,
        type: 'vec3',
        inputs: [{ name: 'pIn', type: 'vec3' }, { name: 'prm', type: 'vec4' }],
    });
}

/**
 * A mirror wall's softness (radians²): a pearl the wall crosses is not split by a crease. It grows
 * with the stage, so a stage that is shut leaves every ray exactly where it was (no hairline along
 * a wall parked at the edge of the view).
 */
const WALL_SOFT = 0.00002;
/** The angle `th` reflected to the far side of a wall at `wall` when it lies below it (softened by `k`). */
const above = (th, wall, k) => wall.add(th.sub(wall).mul(th.sub(wall)).add(k.mul(WALL_SOFT)).sqrt());
/** The angle `th` reflected back under a wall at `wall` when it lies beyond it (softened by `k`). */
const below = (th, wall, k) => wall.sub(wall.sub(th).mul(wall.sub(th)).add(k.mul(WALL_SOFT)).sqrt());

/**
 * The kaleidoscope, in three stages that open one after another: a mirror whose line runs through
 * the lens's axis square to the core's bearing (the core's half kept, so as the eye rolls the
 * mirror turns with it and never flips), then six sectors, then twelve, all centred on the core's
 * bearing from the lens's axis. Each stage OPENS AS A REAL KALEIDOSCOPE'S MIRRORS WOULD, never by
 * blending two views (a half-blend smears the halls): the mirror slides in from beyond the frame's
 * far side to the axis; the six's two walls turn in from the kept half's edges, one onto the core's
 * own line, one to 60° past it; the twelve's wall turns in from 60° to 30°. Every step is a
 * reflection, so neighbouring rays stay neighbours (the scout's cone holds). Fully open, the folds
 * are the CPU's foldLens (kaleidosonic-core.js). lens = (core bearing a0, -, -, -); s = (bilateral,
 * six, twelve, -). Returns (direction, how far the ray's sector is an "other" one: 0..1, for the
 * alternate colour).
 */
export const ksLensFold = /* @__PURE__ */ Fn(([dIn, lens, s]) => {
    const d = dIn.toVar();
    const xy = d.xy.toVar();
    const n = vec2(cos(lens.x), sin(lens.x)).toVar();
    // the mirror: its line square to the core's bearing, sliding in from beyond the frame (a unit
    // direction's xy never reaches 1) to the axis; the far side shows the near side's reflection
    const dn = dot(xy, n).add(float(1).sub(s.x)).toVar();
    xy.assign(xy.add(n.mul(dn.mul(dn).add(s.x.mul(0.000004)).sqrt().sub(dn))));
    const other = float(0.5).sub(sign(dn).mul(0.5)).mul(s.x).toVar();
    // the angle from the core's bearing, in [-π, π)
    const r = xy.length();
    // (a hair added to x: atan(0, 0) is undefined in GLSL and WGSL)
    const raw = atan(xy.y, xy.x.add(1e-7)).sub(lens.x);
    const th = raw.sub(floor(raw.add(Math.PI).div(2 * Math.PI)).mul(2 * Math.PI)).toVar();
    // six sectors (three mirrored pairs): two walls turn in from the edges of what the mirror keeps
    // (the whole circle while it is shut), one onto the core's own line, one to 60° past it
    const edge = float(1).sub(s.x).add(1).mul(Math.PI / 2);
    const wallIn = mix(edge.negate(), float(0), s.y);
    const wallOut = mix(edge, float(Math.PI / 3), s.y).toVar();
    th.assign(above(th, wallIn, s.y));
    th.assign(below(th, wallOut, s.y));
    // six sectors cannot alternate round an odd ring: no colour of their own
    other.assign(other.mul(float(1).sub(s.y.mul(0.5))));
    // twelve: one more wall turns in from the six's outer wall to 30°; what it folds back is the
    // alternate sector
    const wall12 = mix(wallOut, float(Math.PI / 6), s.z);
    const parity = step(wall12, th).toVar();
    th.assign(below(th, wall12, s.z));
    other.assign(mix(other, max(other, parity), s.z));
    const a = lens.x.add(th);
    return vec4(normalize(vec3(vec2(cos(a), sin(a)).mul(r), d.z)), other);
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
        /** The drawing buffer (pixels) and the scout's target over it (texels): (w, h, sw, sh). */
        scout: uniform(new THREE.Vector4(1, 1, 1, 1)),
        /** (inversion strength s, folds (fractional), whole folds, the next fold's weight): foldSplit. */
        shape: uniform(new THREE.Vector4(TEMPLE.s, TEMPLE.detailRest, ...foldSplit(TEMPLE.detailRest))),
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
        /**
         * The light map (kaleidosonic-light.js): (drawn yet 0|1, how far the core's own shadows
         * hold (1 at rest; the dive carries the core off its jewel), the light in the air's gain, -).
         */
        light: uniform(new THREE.Vector4(0, 1, 1, 0)),
        /** The gem's turn (its facets throw the beams): (cos, sin) of the angle about the vertical. */
        gem: uniform(new THREE.Vector4(1, 0, 0, 0)),
        /** The gem's facet axes (BEAM_AXES), a fixed table the beams loop over. */
        beamAxes: uniformArray(BEAM_AXES.map(([x, y, z]) => new THREE.Vector4(x, y, z, 0)), 'vec4'),
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
