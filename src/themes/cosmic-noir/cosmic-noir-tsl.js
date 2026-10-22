/**
 * Cosmic Noir — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures), and their
 *    input names avoid WGSL's reserved words;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    smoke is ONE tileable 3D byte texture baked on the CPU when the world is built;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and grey; the
 *    post stack owns the tone curve and the film stock's toning;
 *  - the smoke is painted into a reduced-resolution target once a frame (cosmic-noir-volume.js).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    acos,
    atan,
    clamp,
    dot,
    exp,
    float,
    fract,
    max,
    min,
    mix,
    pow,
    select,
    smoothstep,
    sqrt,
    step,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CAGE, DEG, ECHO_SLOTS, PULSAR, PUFF_SLOTS, SMOKE, TAU,
} from './cosmic-noir-core.js';

export * from './cosmic-noir-core.js';
export { SMOKE_SEED, bakeSmokeNoise } from './cosmic-noir-bake.js';

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

// ── The lighthouse ──────────────────────────────────────────────────────────────

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

/** The beams' soft skirt alone (the smoke march's share; their cores are integrated in closed form). */
export const cnBeamSkirt = /* @__PURE__ */ Fn(([d, beam]) => {
    const angle = acos(clamp(abs(dot(d, beam)), 0.0, 1.0));
    const a2 = angle.div(PULSAR.beamSkirt * DEG);
    return exp(a2.mul(a2).negate()).mul(PULSAR.skirtShare);
}).setLayout({
    name: 'cn_beamSkirt', type: 'float', inputs: [{ name: 'd', type: 'vec3' }, { name: 'beam', type: 'vec3' }],
});

/**
 * How much light leaving the pulsar along `d` passes the shutter cage (none through its lids),
 * with soft slat edges. `spin` = the cage's axis, `e1`/`e2` across it; `turn` = the cage's own
 * turn (radians), `fill` = the share of a pitch a slat covers. GPU twin of cageTransmit().
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
    // blended into their average (far from the cage the scattered light fills them in).
    const edge = max(soft, 0.03);
    const sharp = smoothstep(edge.negate(), edge, f).mul(float(1.0).sub(smoothstep(fill.sub(edge), fill.add(edge), f)));
    const inSlat = mix(sharp, fill.mul(0.85), smoothstep(0.12, 0.42, soft));
    // Past the wall's height the light meets a lid: most of it is stopped (a soft-edged shadow, a
    // little light leaking round the rims).
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

/** Henyey–Greenstein phase (normalised to 1 at g = 0) for the cosine between light and eye. */
export const cnPhase = /* @__PURE__ */ Fn(([cosA, g]) => {
    const g2 = g.mul(g);
    const denom = max(float(1.0).add(g2).sub(g.mul(2.0).mul(cosA)), 1e-4);
    return float(1.0).sub(g2).div(pow(denom, 1.5));
}).setLayout({
    name: 'cn_phase', type: 'float', inputs: [{ name: 'cosA', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── The noise texture ──────────────────────────────────────────────────────────

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

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/** The peak the smoke's light is coded against where its target is 8-bit (see `smokeAt`). */
export const SMOKE_CODE_PEAK = 6;

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ smoke: THREE.Data3DTexture, smokeFar: THREE.Data3DTexture, target: THREE.Texture,
 *   floatTarget?: boolean }} textures
 */
export function createNoirUniforms(textures) {
    const tables = {
        echoes: rows(ECHO_SLOTS, [0, 1, 0, 0]),
        puffs: rows(PUFF_SLOTS * 2, [0, 0, -100, 0.01]),
    };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, for the smoke's target (which is drawn without one).
        camPos: uniform(new THREE.Vector3(0, 0, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.9, 0.5)),
        // The lighthouse.
        pulsar: uniform(new THREE.Vector3(0, 0, -PULSAR.depth)),
        spin: uniform(new THREE.Vector3(0, 1, 0)),
        spinE1: uniform(new THREE.Vector3(1, 0, 0)),
        spinE2: uniform(new THREE.Vector3(0, 0, 1)),
        /** One beam's direction now (the other is its opposite). */
        beam: uniform(new THREE.Vector3(1, 0, 0)),
        beamGain: uniform(PULSAR.beamGain),
        /** The smoke's forward scatter (Henyey–Greenstein g): PULSAR.forward at rest. */
        forward: uniform(PULSAR.forward),
        coreGain: uniform(PULSAR.coreGain),
        /** The cage's turn (radians, integrated) and the share of a pitch a slat covers. */
        cageTurn: uniform(0),
        cageFill: uniform(CAGE.fillClosed),
        /** How far the smoke has drifted (integrated: reduced motion slows the wind). */
        drift: uniform(new THREE.Vector3(0, 0, 0)),
        /** The slow field's own drift (the smoke curls as it moves). */
        curl: uniform(new THREE.Vector3(0, 0, 0)),
        /** The faint light the smoke shows by everywhere (starlight). */
        ambient: uniform(0.005),
        /**
         * The thin haze everywhere in the envelope (SMOKE.haze at rest): locks fill the room with
         * smoke and hot play thickens it, so the beams become solid blades.
         */
        haze: uniform(SMOKE.haze),
        /** The pulsar's own point as seen: how much of it the cage lets through, and the glare when a beam looks at us. */
        coreSeen: uniform(1),
        glare: uniform(0),
        /** The pulsar on screen (UV, y down): the lens's halo and spikes are drawn round it. */
        pulsarUv: uniform(new THREE.Vector2(0.2, 0.34)),
        /** How bright the star-filter spikes are (a flare and a combo raise them). */
        spikes: uniform(1),
        /** Gain on every light: the flashbulb and the cue marks are the post's, this is the world's breath. */
        breath: uniform(1),
        tables,
        /** Light echoes: (radius, width, strength, _). */
        echoes: uniformArray(tables.echoes, 'vec4'),
        echoCount: uniform(0, 'int'),
        /** Puffs, two rows each: (centre xyz, radius) and (smoke, ember, _, _). */
        puffs: uniformArray(tables.puffs, 'vec4'),
        puffCount: uniform(0, 'int'),
        smokeTex: textures.smoke,
        smokeFarTex: textures.smokeFar,
        targetTex: texture(textures.target),
    };
    /** The smoke's four fields at a point of the volume (one unit = one tile). */
    u.smoke = (p3) => texture3D(u.smokeTex, p3).level(0);
    /** The same fields without their finest octaves: what a long step of the march reads. */
    u.smokeFar = (p3) => texture3D(u.smokeFarTex, p3).level(0);
    /**
     * The smoke's target at a screen UV: (light, how much of what is behind it shows through).
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
 * Where a ray (origin `o`, unit direction `rd`) meets the cage's cylinder, in ray distances
 * (near, far), and whether it does: vec3(tNear, tFar, hit). The caps are open.
 */
export const cnCylinder = (o, rd, u) => {
    const rel = o.sub(u.pulsar);
    const ra = dot(rd, u.spin);
    const oa = dot(rel, u.spin);
    const dPerp = rd.sub(u.spin.mul(ra));
    const oPerp = rel.sub(u.spin.mul(oa));
    const A = max(dot(dPerp, dPerp), 1e-6);
    const B = dot(oPerp, dPerp).mul(2.0);
    const C = dot(oPerp, oPerp).sub(CAGE.radius * CAGE.radius);
    const disc = B.mul(B).sub(A.mul(C).mul(4.0));
    const root = sqrt(max(disc, 0.0));
    const t0 = B.negate().sub(root).div(A.mul(2.0));
    const t1 = B.negate().add(root).div(A.mul(2.0));
    return vec3(t0, t1, smoothstep(0.0, 1e-4, disc));
};

/**
 * Where a ray meets the cage's lids (the discs that close it at ±halfHeight): vec3(t of the
 * nearest hit ahead, its distance from the axis as a share of the radius, hit 0/1).
 */
export const cnLid = (o, rd, u) => {
    const rel = o.sub(u.pulsar);
    const ra = dot(rd, u.spin);
    const oa = dot(rel, u.spin);
    // Never divide by zero: a ray parallel to the lids is nudged off it.
    const safe = ra.add(step(0.0, ra).mul(2.0).sub(1.0).mul(1e-5));
    const tTop = float(CAGE.halfHeight).sub(oa).div(safe);
    const tBottom = float(-CAGE.halfHeight).sub(oa).div(safe);
    const radiusAt = (t) => {
        const p = rel.add(rd.mul(t));
        const perp = p.sub(u.spin.mul(dot(p, u.spin)));
        return sqrt(dot(perp, perp)).div(CAGE.radius);
    };
    const rTop = radiusAt(tTop);
    const rBottom = radiusAt(tBottom);
    const okTop = step(0.0, tTop).mul(step(rTop, 1.0));
    const okBottom = step(0.0, tBottom).mul(step(rBottom, 1.0));
    const big = float(1e6);
    const tA = select(okTop.greaterThan(0.5), tTop, big);
    const tB = select(okBottom.greaterThan(0.5), tBottom, big);
    const t = min(tA, tB);
    const rr = select(tA.lessThan(tB), rTop, rBottom);
    return vec3(t, rr, max(okTop, okBottom));
};

/** The cage's surface at a ray distance: (slat coverage 0..1, axial share, theta share). */
export const cnCageSurface = (o, rd, t, u) => {
    const p = o.add(rd.mul(t)).sub(u.pulsar);
    const h = dot(p, u.spin);
    const theta = atan(dot(p, u.spinE2), dot(p, u.spinE1)).add(u.cageTurn);
    const f = fract(theta.mul(CAGE.slats / TAU));
    return vec3(f, h.div(CAGE.halfHeight), theta);
};

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
