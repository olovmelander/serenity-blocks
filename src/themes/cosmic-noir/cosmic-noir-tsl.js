/**
 * Cosmic Noir — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures), and their
 *    input names avoid WGSL's reserved words;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    smoke in the air is ONE tileable 3D byte texture and the sea of smoke ONE tileable half-float
 *    field (height and slope), both baked on the CPU when the world is built;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and grey; the
 *    post stack owns the tone curve and the film stock's toning;
 *  - the light in the air is painted into a reduced-resolution target once a frame
 *    (cosmic-noir-volume.js); the sea, the lighthouse and the sky are drawn at the screen's own
 *    resolution by one full-screen backdrop.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    acos,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log2,
    max,
    min,
    mix,
    pow,
    sin,
    smoothstep,
    sqrt,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CAGE, DEG, ECHO_SLOTS, PULSAR, PUFF_SLOTS, ROCK, ROLLERS, ROLLER_MEAN, SEA, SMOKE, SPLASH_SLOTS, SURGE_SET,
    TAU,
} from './cosmic-noir-core.js';

export * from './cosmic-noir-core.js';
export {
    SEA_SEED, SMOKE_SEED, bakeSeaField, bakeSmokeNoise,
} from './cosmic-noir-bake.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const cnHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'cn_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const cnHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'cn_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Rec.709 luminance. */
export const cnLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const cnMax3 = (c) => max(c.x, max(c.y, c.z));

// ── The lighthouse's light ──────────────────────────────────────────────────────

/**
 * How much of a beam reaches direction `d` (unit, from the pulsar): a gaussian core and a soft
 * skirt round either of the two opposite beams along `beam`. GPU twin of beamLight().
 */
export const cnBeam = /* @__PURE__ */ Fn(([d, beam]) => {
    const angle = acos(clamp(abs(dot(d, beam)), 0.0, 1.0));
    const a1 = angle.div(PULSAR.beamWidth * DEG);
    const a2 = angle.div(PULSAR.beamSkirt * DEG);
    return exp(a1.mul(a1).negate()).add(exp(a2.mul(a2).negate()).mul(PULSAR.skirtShare));
}).setLayout({
    name: 'cn_beam', type: 'float', inputs: [{ name: 'd', type: 'vec3' }, { name: 'beam', type: 'vec3' }],
});

/** The beams' soft skirt alone (the air's summed share; their cores are integrated in closed form). */
export const cnBeamSkirt = /* @__PURE__ */ Fn(([d, beam]) => {
    const angle = acos(clamp(abs(dot(d, beam)), 0.0, 1.0));
    const a2 = angle.div(PULSAR.beamSkirt * DEG);
    return exp(a2.mul(a2).negate()).mul(PULSAR.skirtShare);
}).setLayout({
    name: 'cn_beamSkirt', type: 'float', inputs: [{ name: 'd', type: 'vec3' }, { name: 'beam', type: 'vec3' }],
});

/**
 * How much light leaving the pulsar along `d` passes the lantern room (little past the roof and
 * the gallery), with soft slat edges. `spin` = the lantern's axis, `e1`/`e2` across it; `turn` =
 * the slats' own turn (radians), `fill` = the share of a pitch a slat covers. GPU twin of
 * cageTransmit().
 */
export const cnCage = /* @__PURE__ */ Fn(([d, spin, e1, e2, turn, fill, soft]) => {
    const h = dot(d, spin);
    const qx = dot(d, e1);
    const qy = dot(d, e2);
    const q = max(sqrt(qx.mul(qx).add(qy.mul(qy))), 1e-5);
    const axial = abs(h.mul(CAGE.radius).div(q));
    const theta = atan(qy, qx).add(turn);
    const f = fract(theta.mul(CAGE.slats / TAU));
    // `soft` = the penumbra in shares of a pitch: a slat's edge, and how far the stripes have
    // blended into their average (far from the lantern the scattered light fills them in).
    const edge = max(soft, 0.03);
    const sharp = smoothstep(edge.negate(), edge, f).mul(float(1.0).sub(smoothstep(fill.sub(edge), fill.add(edge), f)));
    const inSlat = mix(sharp, fill.mul(0.85), smoothstep(0.12, 0.42, soft));
    // Past the wall's height the light meets the roof or the gallery: most of it is stopped (a
    // soft-edged shadow, a little light leaking round the rims).
    const wall = float(1.0).sub(smoothstep(CAGE.halfHeight - 0.5, CAGE.halfHeight + 1.2, axial).mul(1 - CAGE.lidLeak));
    const onWall = float(1.0).sub(smoothstep(CAGE.halfHeight - 0.05, CAGE.halfHeight + 0.05, axial));
    return float(1.0).sub(inSlat.mul(onWall)).mul(wall);
}).setLayout({
    name: 'cn_cage',
    type: 'float',
    inputs: [
        { name: 'd', type: 'vec3' },
        { name: 'spin', type: 'vec3' },
        { name: 'e1', type: 'vec3' },
        { name: 'e2', type: 'vec3' },
        { name: 'turn', type: 'float' },
        { name: 'fill', type: 'float' },
        { name: 'soft', type: 'float' },
    ],
});

/**
 * The slats' share of a span of the lantern's wall, exactly: the mean of the slat pattern (1 on a
 * slat, 0 in a gap; a slat covers `fill` of each pitch) between two places `xa` and `xb`, counted
 * in pitches, widened by `blur` pitches. Where a view ray sweeps past many slats in one step of
 * the light's sum, this is their true average, so the shafts are drawn without noise.
 */
export const cnSlatShare = /* @__PURE__ */ Fn(([xa, xb, fill, blur]) => {
    const lo = min(xa, xb).sub(blur.mul(0.5));
    const hi = max(xa, xb).add(blur.mul(0.5));
    const upTo = (x) => floor(x).mul(fill).add(min(fract(x), fill));
    return upTo(hi).sub(upTo(lo)).div(max(hi.sub(lo), 1e-4));
}).setLayout({
    name: 'cn_slatShare',
    type: 'float',
    inputs: [
        { name: 'xa', type: 'float' },
        { name: 'xb', type: 'float' },
        { name: 'fill', type: 'float' },
        { name: 'blur', type: 'float' },
    ],
});

/** Henyey–Greenstein phase (normalised to 1 at g = 0) for the cosine between light and eye. */
export const cnPhase = /* @__PURE__ */ Fn(([cosA, g]) => {
    const g2 = g.mul(g);
    const denom = max(float(1.0).add(g2).sub(g.mul(2.0).mul(cosA)), 1e-4);
    return float(1.0).sub(g2).div(pow(denom, 1.5));
}).setLayout({
    name: 'cn_phase', type: 'float', inputs: [{ name: 'cosA', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── The baked textures ──────────────────────────────────────────────────────────

/** The smoke as a tileable, linearly filtered 3D texture (RGBA8: filterable everywhere). */
export function createSmokeTexture(data, size, name = 'cosmic-noir-smoke') {
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.unpackAlignment = 1;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/**
 * The sea's field as a tileable half-float texture with the mip chain the bake averaged (half-float
 * mips made on the GPU are not portable to every WebGL2 device).
 */
export function createSeaTexture(levels, size, name = 'cosmic-noir-sea') {
    const tex = new THREE.DataTexture(levels[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = levels;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/** The peak the air's light is coded against where its target is 8-bit (see `smokeAt`). */
export const SMOKE_CODE_PEAK = 6;

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ smoke: THREE.Data3DTexture, smokeFar: THREE.Data3DTexture, sea: THREE.DataTexture,
 *   seaSize: number, target: THREE.Texture, floatTarget?: boolean }} textures
 */
export function createNoirUniforms(textures) {
    const tables = {
        echoes: rows(ECHO_SLOTS, [0, 1, 0, 0]),
        puffs: rows(PUFF_SLOTS * 2, [0, 0, -100, 0.01]),
        splashes: rows(SPLASH_SLOTS, [100, 0, 0, 0]),
    };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, for the full-screen passes (which are drawn without one).
        camPos: uniform(new THREE.Vector3(0, 0, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.9, 0.5)),
        // The lighthouse.
        pulsar: uniform(new THREE.Vector3(0, PULSAR.height, -PULSAR.depth)),
        spin: uniform(new THREE.Vector3(0, 1, 0)),
        spinE1: uniform(new THREE.Vector3(1, 0, 0)),
        spinE2: uniform(new THREE.Vector3(0, 0, 1)),
        /** One beam's direction now (the other is its opposite). */
        beam: uniform(new THREE.Vector3(1, 0, 0)),
        beamGain: uniform(PULSAR.beamGain),
        /** The smoke's forward scatter (Henyey–Greenstein g): PULSAR.forward at rest. */
        forward: uniform(PULSAR.forward),
        coreGain: uniform(PULSAR.coreGain),
        /** The slats' turn (radians, integrated) and the share of a pitch a slat covers. */
        cageTurn: uniform(0),
        cageFill: uniform(CAGE.fillClosed),
        /** How far the smoke in the air has drifted (integrated: reduced motion slows the wind). */
        drift: uniform(new THREE.Vector3(0, 0, 0)),
        /** The slow field's own drift (the smoke curls as it moves). */
        curl: uniform(new THREE.Vector3(0, 0, 0)),
        /** How far the sea's layers have run, in tiles: (swell u, v, billow u, v) and (wisp u, v). */
        seaDrift: uniform(new THREE.Vector4(0, 0, 0, 0)),
        seaFine: uniform(new THREE.Vector2(0, 0)),
        /** The sea's heave: its layers' heights are these shares of SEA's (the heat of play raises it). */
        seaHeave: uniform(1),
        /**
         * The rollers: (how far the crests have run, in turns of a wavelength; the same for the
         * sets; a crest's height now; how churned the sea round the rock is, 0..1).
         */
        seaRoll: uniform(new THREE.Vector4(0, 0, ROLLERS.height, 0)),
        /** How high the tallest plume standing now may reach (scene units over the sea): its walk's ceiling. */
        splashTop: uniform(1),
        /** The sea's surge (0..1): the great moments lift every roller toward a set's tallest. */
        seaSurge: uniform(0),
        /** The faint light everything shows by everywhere (starlight). */
        ambient: uniform(0.0075),
        /** The far lighthouse on the horizon: how bright it shows now. */
        farLamp: uniform(0),
        /** The galaxy's own light, on the sky and as the sea's and the tower's rim. */
        galaxy: uniform(1),
        /**
         * The thin haze in the air (SMOKE.haze at rest): locks fill the air with smoke and hot play
         * thickens it, so the beams become solid blades.
         */
        haze: uniform(SMOKE.haze),
        /** The lamp as seen: how much of it the slats let through, and the glare when a beam looks at us. */
        coreSeen: uniform(1),
        glare: uniform(0),
        /** The lamp on screen (UV, y down): the lens's halo and spikes are drawn round it. */
        pulsarUv: uniform(new THREE.Vector2(0.2, 0.27)),
        /** How bright the star-filter spikes are (a flare and a combo raise them). */
        spikes: uniform(1),
        /** Gain on every light: the flashbulb and the cue marks are the post's, this is the world's breath. */
        breath: uniform(1),
        tables,
        /** Light echoes: (radius in the air, width, strength, radius on the sea). */
        echoes: uniformArray(tables.echoes, 'vec4'),
        echoCount: uniform(0, 'int'),
        /** Puffs, two rows each: (centre xyz, radius) and (smoke, ember, seed, age). */
        puffs: uniformArray(tables.puffs, 'vec4'),
        puffCount: uniform(0, 'int'),
        /** Waves breaking on the rock: (seconds since it met the shore, how hard, a seed, _). */
        splashes: uniformArray(tables.splashes, 'vec4'),
        smokeTex: textures.smoke,
        smokeFarTex: textures.smokeFar,
        seaTex: textures.sea,
        seaSize: textures.seaSize || 256,
        targetTex: texture(textures.target),
    };
    /** The smoke's four fields at a point of the volume (one unit = one tile). */
    u.smoke = (p3) => texture3D(u.smokeTex, p3).level(0);
    /** The same fields without their finest octaves: what a long step reads. */
    u.smokeFar = (p3) => texture3D(u.smokeFarTex, p3).level(0);
    /** The sea's field at a place of its tile and a mip: (height, ∂u, ∂v, calm). */
    u.sea = (uv2, lod) => texture(u.seaTex, uv2).level(lod);
    /**
     * The air's target at a screen UV: (light, how much of what is behind it shows through).
     * Where the target is 8-bit it holds the square root of the light over SMOKE_CODE_PEAK.
     */
    u.floatTarget = textures.floatTarget !== false;
    u.smokeAt = (st) => {
        const stored = u.targetTex.sample(st);
        if (u.floatTarget) return stored;
        return vec4(stored.rgb.mul(stored.rgb).mul(SMOKE_CODE_PEAK), stored.a);
    };
    return u;
}

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const cnViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/**
 * Where a ray (origin `rel` from a point on the axis, unit direction `rd`) meets an upright
 * cylinder of `radius` between heights `y0` and `y1`, caps and all: vec3(tNear, tFar, hit 0/1).
 */
export const cnUpright = /* @__PURE__ */ Fn(([rel, rd, radius, y0, y1]) => {
    // The side: |rel.xz + t rd.xz| = radius.
    const A = max(rd.x.mul(rd.x).add(rd.z.mul(rd.z)), 1e-6);
    const B = rel.x.mul(rd.x).add(rel.z.mul(rd.z));
    const C = rel.x.mul(rel.x).add(rel.z.mul(rel.z)).sub(radius.mul(radius));
    const disc = B.mul(B).sub(A.mul(C));
    const root = sqrt(max(disc, 0.0));
    const sideIn = B.negate().sub(root).div(A);
    const sideOut = B.negate().add(root).div(A);
    // The slab between the caps (a level ray is nudged off level).
    const safe = rd.y.add(float(1e-5).mul(rd.y.greaterThanEqual(0.0).select(1.0, -1.0)));
    const ta = y0.sub(rel.y).div(safe);
    const tb = y1.sub(rel.y).div(safe);
    const near = max(sideIn, min(ta, tb));
    const far = min(sideOut, max(ta, tb));
    const hit = disc.greaterThan(0.0).and(far.greaterThan(max(near, 0.0))).select(1.0, 0.0);
    return vec3(near, far, hit);
}).setLayout({
    name: 'cn_upright',
    type: 'vec3',
    inputs: [
        { name: 'rel', type: 'vec3' },
        { name: 'rd', type: 'vec3' },
        { name: 'radius', type: 'float' },
        { name: 'y0', type: 'float' },
        { name: 'y1', type: 'float' },
    ],
});

/** Where a ray meets a sphere: vec3(tNear, tFar, hit 0/1). `rel` = origin − centre. */
export const cnBall = /* @__PURE__ */ Fn(([rel, rd, radius]) => {
    const b = dot(rel, rd);
    const c = dot(rel, rel).sub(radius.mul(radius));
    const disc = b.mul(b).sub(c);
    const root = sqrt(max(disc, 0.0));
    const far = b.negate().add(root);
    return vec3(b.negate().sub(root), far, disc.greaterThan(0.0).and(far.greaterThan(0.0)).select(1.0, 0.0));
}).setLayout({
    name: 'cn_ball',
    type: 'vec3',
    inputs: [{ name: 'rel', type: 'vec3' }, { name: 'rd', type: 'vec3' }, { name: 'radius', type: 'float' }],
});

// ── The sea of smoke ────────────────────────────────────────────────────────────

const windLen = Math.hypot(SEA.wind[0], SEA.wind[1]) || 1;
/** The wind's heading over the sea (unit, x and z). */
export const SEA_WIND = Object.freeze([SEA.wind[0] / windLen, SEA.wind[1] / windLen]);

/**
 * One layer of the sea: the field read along an axis turned `turn` radians from the wind and
 * drawn out `stretch` times along it (smoke combed by the wind), one tile `tile` units across.
 */
function seaLayer(tile, turn, stretch) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const ax = SEA_WIND[0] * c - SEA_WIND[1] * s;
    const az = SEA_WIND[0] * s + SEA_WIND[1] * c;
    return Object.freeze({
        ax, az, bx: -az, bz: ax, iu: 1 / (tile * stretch), iv: 1 / tile, tile, stretch,
    });
}
export const SEA_LAYERS = Object.freeze({
    swell: seaLayer(SEA.swellTile, 0, 1.5),
    billow: seaLayer(SEA.billowTile, 0.42, 1.9),
    wisp: seaLayer(SEA.wispTile, -0.55, 2.4),
});

/** A layer's place in the field's tile for a point of the sea. */
const layerUv = (xz, L, drift) => vec2(
    dot(xz, vec2(L.ax, L.az)).mul(L.iu),
    dot(xz, vec2(L.bx, L.bz)).mul(L.iv),
).add(drift);

/** The mip a layer is read at for a footprint (scene units across a pixel). */
const layerLod = (u, L, footprint) => max(log2(footprint.mul(u.seaSize * L.iv)), 0.0);

/** The rock's middle on the sea (world x and z) and the way the rollers come from (unit). */
export const ROCK_XZ = Object.freeze([ROCK.centre[0], ROCK.centre[1] - PULSAR.depth]);
export const UPSTREAM = Object.freeze([-ROLLERS.heading[0], -ROLLERS.heading[1]]);

/**
 * The rollers at a point of the sea: vec4(height, ∂height/∂x, ∂height/∂z, crest 0..). Long crests that run
 * in toward the rock (peaked, with long troughs), in sets, rearing up as they near it and lying
 * calmer in its lee. `bend` (−1..1, the swell there) bends each crest's line a little, so none is
 * ruled straight across the sea. Arithmetic only: the same crest the world times its breaking by.
 */
export function cnRoller(u, xz, bend) {
    const rel = xz.sub(vec2(ROCK_XZ[0], ROCK_XZ[1])).toVar();
    const up = dot(rel, vec2(UPSTREAM[0], UPSTREAM[1])).toVar();
    const aside = dot(rel, vec2(-UPSTREAM[1], UPSTREAM[0]));
    const turn = up.div(ROLLERS.length).add(u.seaRoll.x).add(bend.mul(0.13)).mul(TAU)
        .toVar();
    const swing = max(cos(turn).mul(0.5).add(0.5), 0.0).toVar();
    // (A surging sea lifts every wave toward a set's tallest.)
    const set = max(
        cos(up.div(ROLLERS.length * ROLLERS.set).add(u.seaRoll.y).mul(TAU)).mul(0.5).add(0.5),
        u.seaSurge.mul(SURGE_SET),
    ).mul(1 - ROLLERS.least).add(ROLLERS.least);
    const near = exp(dot(rel, rel).div(-ROLLERS.shoal * ROLLERS.shoal)).mul(1 - ROLLERS.open).add(ROLLERS.open);
    const lee = float(1.0).sub(exp(aside.mul(aside).div(-14.0)).mul(float(1.0).sub(smoothstep(-8.0, 0.5, up))).mul(0.6));
    const tall = u.seaRoll.z.mul(set).mul(near).mul(lee).toVar();
    const slope = pow(swing, ROLLERS.peak - 1).mul(sin(turn)).mul((-0.5 * ROLLERS.peak * TAU) / ROLLERS.length).mul(tall);
    const crest = pow(swing, ROLLERS.peak).toVar();
    // (height, its slope along x and z, how much of a crest stands here: 0 in a trough)
    return vec4(crest.sub(ROLLER_MEAN).mul(tall), slope.mul(UPSTREAM[0]), slope.mul(UPSTREAM[1]), crest.mul(tall).div(ROLLERS.height));
}

/**
 * The sea at a point, for a footprint: vec3(its height above its mean, how heaped it is there
 * 0..1, how much of a roller's crest stands there). `sink` (0..1) lets the swells sink into a
 * level sea far out; `fine` adds the wisps (near the eye only: the caller says when).
 */
export function cnSeaHeight(u, xz, footprint, sink, { fine = false } = {}) {
    const { swell, billow, wisp } = SEA_LAYERS;
    const a = u.sea(layerUv(xz, swell, u.seaDrift.xy), layerLod(u, swell, footprint)).toVar();
    const b = u.sea(layerUv(xz, billow, u.seaDrift.zw), layerLod(u, billow, footprint));
    // The billows heap up where the slow field says, and lie calm elsewhere.
    const heap = a.a.mul(0.75).add(0.25);
    const h = a.r.mul(SEA.swell).add(b.r.mul(heap).mul(SEA.billow)).toVar();
    if (fine) {
        const c = u.sea(layerUv(xz, wisp, u.seaFine), layerLod(u, wisp, footprint));
        h.addAssign(c.r.mul(SEA.wisp));
    }
    const roll = cnRoller(u, xz, a.r).toVar();
    return vec3(h.mul(u.seaHeave).add(roll.x).mul(sink), a.a, roll.w.mul(sink));
}

/**
 * The sea at a point, for shading: vec4(height above the mean, ∂height/∂x, ∂height/∂z, how much
 * of a roller's crest stands there).
 * The slopes come from the field's own (filtered) slope, never from differences of the height.
 */
export function cnSeaSurface(u, xz, footprint, sink, { fine = false } = {}) {
    const { swell, billow, wisp } = SEA_LAYERS;
    const a = u.sea(layerUv(xz, swell, u.seaDrift.xy), layerLod(u, swell, footprint)).toVar();
    const b = u.sea(layerUv(xz, billow, u.seaDrift.zw), layerLod(u, billow, footprint)).toVar();
    const heap = a.a.mul(0.75).add(0.25).toVar();
    const slope = (t, L, amp) => vec2(
        t.g.mul(L.ax * L.iu).add(t.b.mul(L.bx * L.iv)).mul(amp),
        t.g.mul(L.az * L.iu).add(t.b.mul(L.bz * L.iv)).mul(amp),
    );
    const h = a.r.mul(SEA.swell).add(b.r.mul(heap).mul(SEA.billow)).toVar();
    const g = slope(a, swell, float(SEA.swell)).add(slope(b, billow, heap.mul(SEA.billow))).toVar();
    if (fine) {
        const c = u.sea(layerUv(xz, wisp, u.seaFine), layerLod(u, wisp, footprint)).toVar();
        h.addAssign(c.r.mul(SEA.wisp));
        g.addAssign(slope(c, wisp, float(SEA.wisp)));
    }
    const roll = cnRoller(u, xz, a.r).toVar();
    const k = u.seaHeave;
    return vec4(
        h.mul(k).add(roll.x).mul(sink),
        g.x.mul(k).add(roll.y).mul(sink),
        g.y.mul(k).add(roll.z).mul(sink),
        roll.w.mul(sink),
    );
}

/**
 * The smoke's own streaks, combed long by the wind (0..1): thin sheets and thick, read from the
 * same field drawn far out along the wind and running with the wisps.
 */
export function cnSeaStreaks(u, xz, footprint) {
    const along = dot(xz, vec2(SEA_WIND[0], SEA_WIND[1]));
    const across = dot(xz, vec2(-SEA_WIND[1], SEA_WIND[0]));
    const wide = u.sea(vec2(along.div(74.0), across.div(11.0)).add(u.seaDrift.zw.mul(0.37)), max(log2(footprint.mul(u.seaSize / 11)), 0.0));
    const thin = u.sea(vec2(along.div(31.0), across.div(3.7)).add(u.seaFine.mul(0.61)), max(log2(footprint.mul(u.seaSize / 3.7)), 0.0));
    return clamp(wide.r.mul(0.62).add(thin.r.mul(0.38)).mul(0.9).add(0.5), 0.0, 1.0);
}

/**
 * The lamp's light at a point outside the lantern: what the slats, the roof and the gallery let
 * past (`soft` = the slats' penumbra there, in pitches) of its own light and the beams'.
 */
export function cnLampAt(u, p, soft) {
    const dv = p.sub(u.pulsar);
    const r = max(length(dv), 0.05);
    const d = dv.div(r);
    const rb = r.div(PULSAR.beamReach);
    const rc = r.div(PULSAR.coreReach);
    return cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, soft)
        .mul(u.coreGain.div(rc.mul(rc).add(1.0)).add(cnBeam(d, u.beam).mul(u.beamGain).div(rb.mul(rb).add(1.0))));
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** The mesh wrapper every part returns. */
export function cnPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function cnPassMaterial(name, node) {
    const material = new THREE.NodeMaterial();
    material.name = name;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = node;
    return material;
}

/**
 * Can this renderer draw into half-float targets? WebGPU always can. A WebGL2 context needs
 * EXT_color_buffer_float or EXT_color_buffer_half_float; without one a half-float target is an
 * incomplete framebuffer.
 */
export function supportsFloatTargets(renderer) {
    const backend = renderer?.backend;
    if (!backend || backend.isWebGPUBackend === true) return true;
    const { gl } = backend;
    if (!gl || typeof gl.getExtension !== 'function') return true;
    try {
        return Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } catch {
        return false;
    }
}

/** Clamp-to-edge, linear colour target without depth: half-float, or 8-bit where that cannot be drawn to. */
export function cnTarget(width, height, name, halfFloat = true) {
    const rt = new THREE.RenderTarget(Math.max(2, width), Math.max(2, height), {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    rt.texture.name = name;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
}
