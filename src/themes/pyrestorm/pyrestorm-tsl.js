/**
 * Pyrestorm — shared TSL: the one uniform bag every part reads, the baked textures, and the
 * readers every surface shares (the lava fields, the blackbody ramp, the eruption's lights, the
 * lightning's lights, the haze).
 *
 * The world writes `.value`s; materials only read. Readers that sample a texture or read a
 * uniform are inline builders (a laid-out Fn may not capture either); pure arithmetic helpers
 * carry a layout so they are emitted once.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    smoothstep,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    BILLOW, CRUST, LATTICE_SIZE, LATTICE_SLICE, LAVA_FIELDS, NOISE_SIZE, bakeBillows, bakeCrust, bakeLattice, bakeNoise,
} from './pyrestorm-bake.js';
import { CRATER } from './pyrestorm-core.js';

export * from './pyrestorm-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const pyHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'py_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const pyHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'py_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const pyLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const pyMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * Incandescence: temperature 0..1 → linear HDR radiance. Dull red at 0.2, orange at 0.5,
 * yellow at 0.8, a yellow-white at 1 (products, not pow: no NaN below zero).
 */
export const pyBlackbody = /* @__PURE__ */ Fn(([tIn]) => {
    const t = clamp(tIn, 0.0, 1.2);
    const t2 = t.mul(t);
    const t3 = t2.mul(t);
    const t6 = t3.mul(t3);
    return vec3(t2.mul(9.0), t3.mul(t.mul(0.6).add(0.4)).mul(5.4), t6.mul(1.7));
}).setLayout({ name: 'py_blackbody', type: 'vec3', inputs: [{ name: 'tIn', type: 'float' }] });

// ── Baked textures ────────────────────────────────────────────────────────────────

function dataTexture(data, w, h, {
    name, wrap = THREE.RepeatWrapping, filter = THREE.LinearFilter, mips = false, format = THREE.RGBAFormat,
}) {
    const tex = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : filter;
    tex.generateMipmaps = mips;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

export function createNoiseTexture(data = bakeNoise()) {
    return dataTexture(data, NOISE_SIZE, NOISE_SIZE, { name: 'pyrestorm-noise', mips: true });
}

export function createLatticeTexture(data = bakeLattice()) {
    return dataTexture(data, LATTICE_SIZE, LATTICE_SIZE, { name: 'pyrestorm-lattice' });
}

export function createBillowTexture(data = bakeBillows()) {
    const size = BILLOW.tile * BILLOW.grid;
    // No mips: a puff is large on screen, and mips would bleed one heap's tile into the next.
    return dataTexture(data, size, size, { name: 'pyrestorm-billows', wrap: THREE.ClampToEdgeWrapping });
}

/** The lava's crust: plates and cracks, tiled and mipmapped (pyrestorm-bake's bakeCrust). */
export function createCrustTexture(data = bakeCrust()) {
    return dataTexture(data, CRUST.size, CRUST.size, { name: 'pyrestorm-crust', mips: true });
}

/** A lava field's two textures (channel geometry + heat + glow; flow heading + kind + arc). */
export function createLavaTextures(field) {
    const opts = { wrap: THREE.ClampToEdgeWrapping };
    return {
        a: dataTexture(field.a, field.size, field.size, { ...opts, name: `pyrestorm-lava-${field.name}-a` }),
        b: dataTexture(field.b, field.size, field.size, { ...opts, name: `pyrestorm-lava-${field.name}-b` }),
    };
}

/** 3D value noise, two independent fields in [0, 1], in one fetch (one unit = one lattice cell). */
export const noise3 = (tex, at) => {
    const cell = floor(at);
    const f0 = fract(at);
    const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
    const st = cell.xy.add(vec2(LATTICE_SLICE[0], LATTICE_SLICE[1]).mul(cell.z)).add(f.xy).add(0.5).div(LATTICE_SIZE);
    const t = texture(tex, st).level(0);
    return mix(t.xz, t.yw, f.z);
};

// ── Reading the lava ──────────────────────────────────────────────────────────────

const fieldUV = (f, xz) => xz.sub(vec2(f.x0, f.z0)).div(f.span);

/**
 * The lava at a world xz: { dc (m to the nearest channel's centreline), hw (its half-width, m),
 * heat (0..1), glow (the light its lava throws nearby, 0..1+), wide (the country's glow), dir
 * (flow heading xz), arc (km from the source, 0..16), kind (0 river, 1 braid, 2 flank, 3 fissure, 4 breakout),
 * cell (the field's texel size here, m) }. The fine field where it holds the point, the coarse
 * one elsewhere; the wide glow always from the coarse field.
 */
export function lavaAt(t, xz) {
    const N = LAVA_FIELDS.near;
    const F = LAVA_FIELDS.far;
    const uvN = fieldUV(N, xz);
    const uvF = fieldUV(F, xz);
    const an = texture(t.lava.near.a, uvN).level(0);
    const bn = texture(t.lava.near.b, uvN).level(0);
    const af = texture(t.lava.far.a, uvF).level(0);
    const bf = texture(t.lava.far.b, uvF).level(0);
    const edge = min(min(uvN.x, float(1.0).sub(uvN.x)), min(uvN.y, float(1.0).sub(uvN.y)));
    const wN = smoothstep(0.0, 0.03, edge);
    const dcN = an.x.mul(N.range);
    const dcF = af.x.mul(F.range);
    return {
        dc: mix(dcF, dcN, wN),
        hw: mix(af.y, an.y, wN).mul(N.widthRange),
        heat: mix(af.z, an.z, wN),
        glow: mix(af.w.mul(0.55), an.w, wN),
        wide: af.w,
        dir: mix(bf.xy, bn.xy, wN).mul(2.0).sub(1.0),
        kind: mix(bf.z, bn.z, wN).mul(255.0 / 60.0),
        arc: mix(bf.w, bn.w, wN).mul(16.0),
        cell: mix(float(F.span / F.size), float(N.span / N.size), wN),
    };
}

/** Only the country's wide glow at a world xz (what lights the air and the clouds). */
export function wideGlowAt(t, xz) {
    const F = LAVA_FIELDS.far;
    return texture(t.lava.far.a, fieldUV(F, xz)).level(0).w;
}

// ── Lights ────────────────────────────────────────────────────────────────────────

/** Lightning lights at once (bolts, the blast's flash): rows (pos, radius) + (rgb·power, age). */
export const LIGHTS = 6;

/**
 * Everything the lightning's lights add at a world point with a normal (lambert-wrapped; `vol`
 * for a volume such as cloud: a soft glow round each light, little of the normal).
 */
export function lightningAt(u, P, N, vol = 0) {
    const sum = vec3(0.0).toVar();
    Loop({
        start: int(0), end: u.lightCount, type: 'int', condition: '<', name: 'li',
    }, ({ li }) => {
        const a = u.lights.element(li.mul(2));
        const b = u.lights.element(li.mul(2).add(1));
        const toL = a.xyz.sub(P);
        const d = length(toL);
        const L = toL.div(max(d, 1.0));
        const ndl = clamp(dot(N, L).mul(1.0 - vol * 0.5).add(vol * 0.5), 0.0, 1.0);
        const near = float(1.0).div(float(1.0).add(d.div(a.w).mul(d.div(a.w)).mul(vol > 0 ? 2.5 : 1.0)));
        const core = vol > 0 ? exp(d.div(a.w).mul(-3.2)).mul(vol * 1.4) : float(0.0);
        sum.addAssign(b.xyz.mul(ndl.mul(near).add(core)));
    });
    return sum;
}

/**
 * The eruption's own fire on a point: the crater's fountain (a point light at the mouth, as
 * strong as the fountain is high) and the lava's glow around it (from the fields).
 */
export function fireLightAt(u, P, N) {
    const toC = vec3(CRATER.x, CRATER.y + 260.0, CRATER.z).sub(P);
    const d = length(toC);
    const L = toC.div(max(d, 1.0));
    const ndl = clamp(dot(N, L).mul(0.75).add(0.25), 0.0, 1.0);
    const fall = float(1.0).div(float(1.0).add(d.div(1900.0).mul(d.div(1900.0))));
    // A lock's burst glows in the crater on top of the fountain (u.burst, eased).
    return u.fireColour.mul(u.fountain.add(u.burst.mul(0.9)).mul(ndl).mul(fall).mul(2.4));
}

// ── The air ───────────────────────────────────────────────────────────────────────

/**
 * Haze between the eye and a point: dark night air thickened near the ground, warmed where the
 * country glows (the lava lights the smoke it lies under). Returns the colour seen through it.
 */
export function aerial(u, t, P, colour) {
    const toP = P.sub(u.eye);
    const dist = length(toP);
    // Density falls with height (a mean of the eye's and the point's).
    const hMean = max(P.y.add(u.eye.y).mul(0.5), 0.0);
    const dens = u.hazeDensity.mul(exp(hMean.div(-2200.0)));
    const tau = dist.mul(dens).mul(0.000045);
    const keep = exp(tau.negate());
    // The air glows over the lava: the wide glow under the line of sight, read at three places
    // along it (one read lit only the haze over whatever lay two thirds of the way out), the low
    // air glowing most.
    const g = wideGlowAt(t, u.eye.xz.add(toP.xz.mul(0.35)))
        .add(wideGlowAt(t, u.eye.xz.add(toP.xz.mul(0.65))))
        .add(wideGlowAt(t, u.eye.xz.add(toP.xz.mul(0.9))))
        .mul(1.0 / 3.0)
        .mul(exp(hMean.div(-900.0)));
    const air = u.haze.add(u.fireColour.mul(g.mul(0.16).mul(u.activity)));
    return mix(air, colour, keep);
}

// ── The scene's state ─────────────────────────────────────────────────────────────

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

/** Ground hits (bomb impacts, bolt strikes) the land lights: rows (pos, born) + (rgb, kind). */
export const HITS = 12;

export function createUniforms() {
    const tables = {
        lights: rows(LIGHTS * 2),
        hits: rows(HITS * 2),
    };
    return {
        tables,
        lights: uniformArray(tables.lights, 'vec4'),
        lightCount: uniform(0, 'int'),
        hits: uniformArray(tables.hits, 'vec4'),
        hitCount: uniform(0, 'int'),

        time: uniform(0),
        /** The lava's flow clock (s; constant rate, wrapped). */
        flow: uniform(0),
        eye: uniform(new THREE.Vector3(0, 440, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalfFov: uniform(0.4),
        aspect: uniform(16 / 9),
        /** Radians per pixel of the buffer drawn. */
        pixelAngle: uniform(0.0007),

        // The watch of the night (pyrestorm-hours): sky, air, ash, storm.
        zenith: colour(0.004, 0.004, 0.012),
        horizon: colour(0.03, 0.02, 0.035),
        dusk: colour(0.08, 0.02, 0.03),
        haze: colour(0.02, 0.012, 0.016),
        ambient: colour(0.01, 0.01, 0.018),
        ash: colour(0.17, 0.15, 0.14),
        bolt: colour(1.6, 1.4, 2.4),
        stars: uniform(0.8),
        hazeDensity: uniform(1),
        /** The dusk's (or dawn's) bearing, radians right of the view axis. */
        duskBearing: uniform(-0.6),

        /** The fire's colour (the lava's light on rock, cloud and air). */
        fireColour: colour(1.0, 0.36, 0.08),
        /** How hot the lava runs (0.85 cooler … 1.15 hotter). */
        lavaHeat: uniform(1),
        /** The eruption's activity (1 erupting; sinks toward 0.3 at game over). */
        activity: uniform(1),
        /** The crater fountain's height (1 ordinary; a chain and the blast raise it). */
        fountain: uniform(1),
        /** The storm's charge (a chain), 0..1. */
        charge: uniform(0),
        /** A surge of fresh lava down every channel: (front km from the source, strength). */
        pulse: uniform(new THREE.Vector2(-10, 0)),
        /** Four lines: the shock front (crater-centred radius m, strength) and its age. */
        shock: uniform(new THREE.Vector3(0, 0, 1e6)),
        /** Perfect clear: the anvil's sheet lightning (front 0..1 across it, strength). */
        sheet: uniform(new THREE.Vector2(0, 0)),
        /** Back-to-back: St Elmo's corona on the summit (0..1). */
        corona: uniform(0),
        /** A hard drop's tremor: the crust cracks open for a moment (0..1). */
        tremor: uniform(0),
        /** A lock's burst glowing in the crater (0 … ~1.6, eased). */
        burst: uniform(0),
    };
}

export { BILLOW, CRUST, LAVA_FIELDS };
