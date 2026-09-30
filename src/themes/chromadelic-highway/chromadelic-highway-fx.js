/**
 * Chromadelic Highway — tunnel rings, speed streaks, motes and meteors.
 *
 * Everything here is GPU-animated in closed form from the shared clock (time, travel), so:
 *   - there are no per-frame vertex/instance uploads,
 *   - motion is frame-rate independent and deterministic for a given (time, travel),
 *   - each system is ONE draw call and ONE pipeline, compiled at build time (the meteor pool
 *     is gated by instanceCount, never by `visible`, so the warm-up compiles it too).
 *
 * "The board is the sun": rings and streaks emerge from behind the board's edges, sweep
 * outward and dissolve before they reach the planets' zones, so the motion radiates from the
 * card and never slices the celestial bodies.
 *
 * Additive materials write premultiplied colour with alpha 1: r185's AdditiveBlending is
 * (SrcAlpha, One), so (col·a, a) would apply every falloff twice.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    floor,
    fract,
    instanceIndex,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    screenUV,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    RING_COUNT_MODULUS,
    RING_SPACING,
    TUNNEL_SPAN,
    TUNNEL_Z_FAR,
    TUNNEL_Z_NEAR,
    chdRoadCurve,
    chdWaves,
} from './chromadelic-highway-tsl.js';

/** Wrap a travelling z into [far, near). */
const wrapZ = (zRaw) => fract(zRaw.sub(TUNNEL_Z_FAR).div(TUNNEL_SPAN)).mul(TUNNEL_SPAN).add(TUNNEL_Z_FAR);

/**
 * Speed multipliers are quantised to k/30 so travel·mul wraps by a whole number of tunnel spans
 * when uTravel wraps at TRAVEL_WRAP (84000 = 30·2800): no teleporting at the wrap.
 */
export const quantizeSpeed = (m) => Math.max(1, Math.round(m * 30)) / 30;

/** Distance (world units) at which the camera sits in front of the ring axis. */
const CAMERA_Z = 280;

// ─────────────────────────────────────────────────────────────────────────────
// Tunnel rings: pixel-clamped neon arches on the ring lattice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rings sit on a lattice locked to the travel clock: ring id J = (TUNNEL_Z_NEAR + travel − z)/350
 * is an integer for every physical ring and constant while it moves. It picks the ring's entry in
 * the 16-step palette (4 walked phrases of the cyan/violet/azure/magenta beat), shared with the
 * road's gate lines. J is ROUNDED in the vertex stage: derived from fract() it carries float
 * error, and a slot/parity picked exactly on that edge flickers between frames.
 *
 * Each ring is a screen-space-sized strip (white-hot core 2–5 px inside a saturated halo), built
 * only over the arc that can be seen above the road (θ −20°…200°). Rings are born at the card
 * edge (D_emerge from the composition solver) and collapse to zero area while hidden behind it,
 * sweep out through the side zones, dim to a glass line over the hero planet, and dissolve before
 * the lens (D 330 → 150).
 *
 * @param {object} opts
 * @param {number} opts.count     rings on the lattice (must divide 240)
 * @param {object} opts.shared    { uTime, uTravel, uRingEnv, uPxScale, uRingPalette, uDEmerge,
 *                                  uCascade, uCascadeCol, uViewportPx, uHeroPx, waves }
 */
export function createTunnelRings({
    count = 8,
    radius = 260,
    centerY = 25,
    segments = 96,
    shared,
} = {}) {
    let n = Math.max(1, Math.floor(count));
    while (RING_COUNT_MODULUS % n !== 0) n -= 1; // keep the travel wrap seamless
    const {
        uTime, uTravel, uPxScale, uRingPalette, uDEmerge, uCascade, uCascadeCol, uViewportPx, uHeroPx, waves,
    } = shared;
    const uRingEnv = shared.uRingEnv ?? uniform(0);
    const uIntensity = uniform(1.0);
    const zStart = TUNNEL_Z_NEAR - n * RING_SPACING;

    // Arc strip: position = (cosθ, sinθ, side ±1), uv = (θ/2π, (side+1)/2).
    const theta0 = THREE.MathUtils.degToRad(-20);
    const theta1 = THREE.MathUtils.degToRad(200);
    const pos = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
        const a = theta0 + (i / segments) * (theta1 - theta0);
        for (let side = -1; side <= 1; side += 2) {
            pos.push(Math.cos(a), Math.sin(a), side);
            uvs.push(a / (Math.PI * 2), (side + 1) / 2);
        }
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(idx);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide, // the strip winds away from the camera
    });
    material.name = 'chromadelic-rings';
    material.fog = false;
    material.forceSinglePass = true;

    // Per-ring terms (vertex stage, passed down as varyings).
    const k = float(instanceIndex);
    const q = uTravel.div(RING_SPACING).add(k);
    const u = fract(q.div(n));
    const zR = float(zStart).add(u.mul(n * RING_SPACING));
    const Jr = floor(float(TUNNEL_Z_NEAR).add(uTravel).sub(zR).div(RING_SPACING)
        .add(0.5));
    const slot16 = Jr.sub(floor(Jr.mul(1.0 / 16.0)).mul(16.0));
    const beat = Jr.sub(floor(Jr.mul(0.25)).mul(4.0));
    const parity = Jr.sub(floor(Jr.mul(0.5)).mul(2.0));
    const accent = step(2.5, beat);
    const curve = chdRoadCurve(zR, uTime);
    const C0 = vec3(curve.x, curve.y.add(centerY), zR);
    const depth = max(cameraViewMatrix.mul(vec4(C0, 1.0)).z.negate(), 1.0);
    const pxPerW = uPxScale.div(depth);
    const Cr = uRingPalette.element(int(slot16));
    const wv = chdWaves(zR, waves, Cr);
    // The cascade: a front sweeping from where rings emerge down to the lens.
    const cAge = max(uTime.sub(uCascade.x), 0.0);
    const Dc = uCascade.y.sub(uCascade.z.mul(cAge));
    const dcN = depth.sub(Dc).div(180.0);
    const cascade = uCascade.w.mul(exp(dcN.mul(dcN).negate()));
    const flash = max(wv.amount, cascade);
    const corePx = clamp(float(1.6).mul(pxPerW), 1.0, 2.4).mul(mix(1.0, 1.3, accent))
        .add(uRingEnv.mul(0.6))
        .add(flash.mul(0.9));
    const stripPx = min(corePx.mul(6.5), mix(float(12.0), float(16.0), smoothstep(500.0, 700.0, depth)));
    const worldY = C0.y.add(positionGeometry.y.mul(radius));
    // Hidden behind the card: collapse to zero area (no fill), then emerge at the card edge.
    const shown = step(depth, uDEmerge.add(250.0));

    material.vertexNode = Fn(() => {
        const p = positionGeometry;
        const rad = float(radius).add(p.z.mul(stripPx.div(pxPerW)));
        const world = C0.add(vec3(p.x.mul(rad), p.y.mul(rad), 0.0).mul(shown));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const vDepth = vertexStage(depth);
        const vAccent = vertexStage(accent);
        const vParity = vertexStage(parity);
        const vFlash = vertexStage(flash);
        const vK = vertexStage(corePx.div(stripPx));
        const vY = vertexStage(worldY);
        const waveTint = mix(Cr, wv.color.div(max(wv.amount, 0.001)), min(wv.amount, 1.0).mul(0.6));
        const vCol = vertexStage(mix(waveTint, uCascadeCol.xyz, min(cascade, 1.0).mul(uCascadeCol.w)));

        const st = uv();
        const v = abs(st.y.mul(2.0).sub(1.0)); // 0 on the centre line → 1 at the strip edge
        const core = float(1.0).sub(smoothstep(vK.mul(0.55), vK.mul(1.3), v));
        const g = v.div(vK.mul(2.8));
        const glow = exp(g.mul(g).negate());
        const halo = exp(v.mul(-3.4)).mul(float(1.0).sub(smoothstep(0.8, 1.0, v)));

        // Three packets orbit each ring; neighbouring rings spin opposite ways.
        const theta = st.x.mul(6.28318);
        const dir = mix(float(-1.0), float(1.0), step(0.5, vParity));
        const packets = pow(cos(theta.mul(3.0).sub(uTime.mul(0.7).mul(dir))).mul(0.5).add(0.5), 10.0);

        // Over the hero planet the ring drops to a dimmed glass line (it still reads in front).
        const pPx = screenUV.mul(uViewportPx);
        const heroM = float(1.0).sub(smoothstep(uHeroPx.z, uHeroPx.z.add(uViewportPx.y.mul(0.03)), length(pPx.sub(uHeroPx.xy))));

        const gain = min(float(1.0).add(uRingEnv.mul(0.5)).mul(float(1.0).add(vFlash.mul(1.2))), 2.5)
            .mul(mix(1.0, 1.25, vAccent));
        const col = mix(vCol, vec3(1.0), vFlash.mul(0.45).add(0.25)).mul(core).mul(2.0).mul(gain)
            .mul(float(1.0).sub(heroM.mul(0.65)))
            .add(vCol.mul(glow.mul(0.45).add(halo.mul(0.16))).mul(float(1.0).sub(heroM.mul(0.5))))
            .mul(packets.mul(0.3).add(0.82));

        const fade = smoothstep(uDEmerge.add(250.0), uDEmerge, vDepth)
            .mul(smoothstep(150.0, 330.0, vDepth))
            .mul(smoothstep(-55.0, 12.0, vY))
            .mul(uIntensity);
        return vec4(min(col.mul(fade), vec3(5.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-rings';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;

    return {
        mesh,
        material,
        count: n,
        radius,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed streaks
// ─────────────────────────────────────────────────────────────────────────────

function unitQuad(geometry) {
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
}

/**
 * Pastel prismatic light streaks radiating from behind the board's side edges: warm hues on the
 * left (I O T), cool on the right (Z J L). They follow the rings' angular fade, never cross the
 * road wedges, lengthen with pace and thicken with the particle envelope.
 * @param {object} opts
 * @param {number} opts.count
 * @param {object} opts.shared  { uTime, uTravel, uPace, uStreakLength, uStreakDensity, uRingFade,
 *                                uViewportH, uProjScaleY, uPulse }
 * @param {THREE.Color[]} opts.warmColors / coolColors  lane colours for each side
 */
export function createSpeedStreaks({
    count = 240, random = Math.random, shared, warmColors, coolColors,
} = {}) {
    const n = Math.max(1, Math.floor(count));
    const {
        uTime, uTravel, uStreakLength, uStreakDensity, uViewportH, uProjScaleY, uPulse, uViewportPx, uHeroPx,
    } = shared;
    const uIntensity = uniform(1.0);

    const geometry = new THREE.InstancedBufferGeometry();
    unitQuad(geometry);
    const aPos = new Float32Array(n * 4); // x, y, z0, seed
    const aData = new Float32Array(n * 4); // speedMul, length, width, head value
    const aCol = new Float32Array(n * 3);
    const white = new THREE.Color(1, 1, 1);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        let side = 1;
        for (let attempt = 0; attempt < 24; attempt++) {
            side = random() > 0.5 ? 1 : -1;
            const theta = THREE.MathUtils.degToRad(-25 + random() * 90);
            const r = random() < 0.6 ? 290 + random() * 230 : 520 + random() * 380;
            x = side * Math.cos(theta) * r;
            y = 25 + Math.sin(theta) * r;
            // Thin the hero's window (screen angle ≈ 142°–186° from the vanishing point).
            const screenAngle = side < 0 ? 180 - THREE.MathUtils.radToDeg(theta) : THREE.MathUtils.radToDeg(theta);
            const inHeroWindow = side < 0 && screenAngle > 142 && screenAngle < 186;
            if (inHeroWindow && random() > 0.35) continue;
            if (!(Math.abs(x) < 130 && y < 15)) break;
        }
        aPos.set([x, y, TUNNEL_Z_NEAR - random() * TUNNEL_SPAN, random()], i * 4);
        aData.set([quantizeSpeed(1.0 + random() * 0.3), 0.7 + random() * 0.6, 1.2 + random() * 1.6,
            1.2 + random() * 0.3], i * 4);
        const palette = side < 0 ? warmColors : coolColors;
        tmp.copy(palette[Math.floor(random() * palette.length) % palette.length]).lerp(white, 0.45);
        aCol.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4));
    geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-streaks';
    material.fog = false;
    material.forceSinglePass = true;

    const streakZ = Fn(() => {
        const p0 = attribute('aPos', 'vec4');
        const d = attribute('aData', 'vec4');
        return wrapZ(p0.z.add(uTravel.mul(d.x)));
    });

    material.positionNode = Fn(() => {
        const p0 = attribute('aPos', 'vec4');
        const d = attribute('aData', 'vec4');
        const z = streakZ();
        const curve = chdRoadCurve(z, uTime);
        const center = vec3(p0.x.add(curve.x), p0.y.add(curve.y), z);
        const toCam = cameraPosition.sub(center);
        const dist = max(length(toCam), 1.0);
        const side = normalize(cross(vec3(0.0, 0.0, 1.0), toCam));
        // Density gate: hidden instances collapse to zero area.
        const shown = step(p0.w, uStreakDensity);
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        const width = max(d.z, worldPerPx.mul(1.4)).mul(shown);
        const len = min(uStreakLength.mul(d.y), 220.0).mul(shown);
        const q = positionGeometry;
        return center.add(side.mul(q.x.mul(width))).add(vec3(0.0, 0.0, q.y.mul(len)));
    })();

    material.colorNode = Fn(() => {
        const d = attribute('aData', 'vec4');
        const c = attribute('aCol', 'vec3');
        const q = positionGeometry;
        const z = streakZ();
        const across = q.x.mul(2.0).div(0.33);
        const beam = exp(across.mul(across).negate());
        const along = q.y.add(0.5); // 0 tail → 1 head (toward the camera)
        // Bases clamped: with MSAA a pixel whose centre lies outside the quad extrapolates past
        // it, and pow(negative) is NaN, which min(…, 4) turns into a hot pixel on D3D.
        const tail = pow(max(along, 0.0), 1.6).mul(0.9).add(0.1);
        const D = float(CAMERA_Z).sub(z);
        // Thinned where it crosses the hero planet.
        const pPx = screenUV.mul(uViewportPx);
        const heroM = float(1.0).sub(smoothstep(uHeroPx.z, uHeroPx.z.add(uViewportPx.y.mul(0.03)), length(pPx.sub(uHeroPx.xy))));
        const fade = smoothstep(float(TUNNEL_Z_FAR), float(TUNNEL_Z_FAR + 340), z)
            .mul(smoothstep(110.0, 260.0, D))
            .mul(float(1.0).sub(heroM.mul(0.75)))
            .mul(uIntensity);
        const value = d.w.mul(float(1.0).add(uPulse.mul(0.2)));
        const a = beam.mul(tail).mul(fade);
        return vec4(min(c.mul(value).mul(a), vec3(4.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-streaks';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return {
        mesh,
        material,
        count: n,
        uniforms: { uIntensity },
        setDensityScale(scale) {
            geometry.instanceCount = Math.max(0, Math.floor(n * Math.max(0, Math.min(1, scale))));
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motes (floating chromatic dust, High and up)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Camera-facing quad in clip space with a size in PIXELS (floor 1 px), after
 * starlight/deep-starfield.js. positionGeometry.xy is the unit quad corner.
 * Call inside a Fn() body (it declares a var).
 */
export function billboardClip(worldPos, sizePx, uViewportH, uProjScaleY) {
    const vp = cameraViewMatrix.mul(vec4(worldPos, 1.0)).toVar();
    const dist = vp.z.negate().max(float(0.01));
    const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
    const off = positionGeometry.xy.mul(worldPerPx.mul(max(sizePx, float(1.0))));
    vp.x.addAssign(off.x);
    vp.y.addAssign(off.y);
    return cameraProjectionMatrix.mul(vp);
}

export function createMotes({ count = 120, random = Math.random, shared } = {}) {
    const n = Math.max(1, Math.floor(count));
    const {
        uTime, uMoteTravel, uViewportH, uProjScaleY, uMoteGain,
    } = shared;
    const uIntensity = uniform(1.0);

    const geometry = new THREE.InstancedBufferGeometry();
    unitQuad(geometry);
    const aPos = new Float32Array(n * 3);
    const aData = new Float32Array(n * 4); // phase, size px, hue, drift
    for (let i = 0; i < n; i++) {
        const side = random() > 0.5 ? 1 : -1;
        aPos[i * 3] = side * (160 + random() * 620);
        aPos[i * 3 + 1] = -30 + random() * 380;
        aPos[i * 3 + 2] = TUNNEL_Z_NEAR - random() * TUNNEL_SPAN;
        aData[i * 4] = random() * Math.PI * 2;
        aData[i * 4 + 1] = 1.4 + random() * 2.4;
        aData[i * 4 + 2] = random();
        aData[i * 4 + 3] = quantizeSpeed(0.25 + random() * 0.45);
    }
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4));
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-motes';
    material.fog = false;
    material.forceSinglePass = true;

    const moteWorld = Fn(() => {
        const p0 = attribute('aPos', 'vec3');
        const d = attribute('aData', 'vec4');
        // Their own clock: the ambient envelope scales mote SPEED (CPU-integrated), never phase.
        const z = wrapZ(p0.z.add(uMoteTravel.mul(d.w)));
        const curve = chdRoadCurve(z, uTime);
        const bob = sin(uTime.mul(0.4).add(d.x)).mul(14.0);
        const sway = cos(uTime.mul(0.27).add(d.x.mul(1.7))).mul(10.0);
        return vec3(p0.x.add(curve.x).add(sway), p0.y.add(curve.y).add(bob), z);
    });

    material.vertexNode = Fn(() => {
        const d = attribute('aData', 'vec4');
        return billboardClip(moteWorld(), d.y, uViewportH, uProjScaleY);
    })();

    material.colorNode = Fn(() => {
        const d = attribute('aData', 'vec4');
        const q = positionGeometry;
        const r = length(q.xy).mul(2.0);
        const core = exp(r.mul(r).mul(-5.0));
        const tw = sin(uTime.mul(1.3).add(d.x.mul(3.0))).mul(0.3).add(0.7);
        const { z } = moteWorld();
        const fade = smoothstep(float(TUNNEL_Z_FAR), float(TUNNEL_Z_FAR + 800), z)
            .mul(smoothstep(float(TUNNEL_Z_NEAR), float(TUNNEL_Z_NEAR - 300), z));
        // Lavender with a 20 % side tint (pink left, cyan right).
        const side = step(0.0, attribute('aPos', 'vec3').x);
        const tintCol = mix(vec3(1.0, 0.195, 0.693), vec3(0.195, 0.887, 1.0), side);
        const moteCol = mix(vec3(0.694, 0.631, 0.887), tintCol, 0.2);
        const a = core.mul(tw).mul(fade).mul(uIntensity).mul(uMoteGain);
        // Sub-threshold by construction (≤ 0.35): motes never bloom.
        return vec4(moteCol.mul(a).mul(0.3), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-motes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    return {
        mesh,
        material,
        count: n,
        uniforms: { uIntensity },
        setDensityScale(scale) {
            geometry.instanceCount = Math.max(0, Math.floor(n * Math.max(0, Math.min(1, scale))));
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Meteors (fixed pool, one draw)
// ─────────────────────────────────────────────────────────────────────────────

const METEOR_RAMP = ['#eaf6ff', '#7df3ff', '#ff5ad9', '#5a2cff'].map((h) => new THREE.Color(h));

/**
 * A fixed pool of meteor billboards. spawn() writes ONE slot's attributes; the vertex shader
 * flies it in closed form. The draw is gated by instanceCount (0 while every slot is dead), not
 * by `visible`, so the pipeline is compiled with the rest of the scene and nothing is created
 * during play.
 */
export function createMeteors({ pool = 8, shared } = {}) {
    const n = Math.max(1, Math.floor(pool));
    const { uTime, uViewportH, uProjScaleY } = shared;
    const uIntensity = uniform(1.0);

    const geometry = new THREE.InstancedBufferGeometry();
    unitQuad(geometry);
    const aStart = new Float32Array(n * 3);
    const aVel = new Float32Array(n * 3);
    const aTiming = new Float32Array(n * 4); // birth, life, width px, peak value
    for (let i = 0; i < n; i++) {
        aTiming[i * 4] = -1e4; // long dead
        aTiming[i * 4 + 1] = 1;
    }
    const startAttr = new THREE.InstancedBufferAttribute(aStart, 3);
    const velAttr = new THREE.InstancedBufferAttribute(aVel, 3);
    const timingAttr = new THREE.InstancedBufferAttribute(aTiming, 4);
    [startAttr, velAttr, timingAttr].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aStart', startAttr);
    geometry.setAttribute('aVel', velAttr);
    geometry.setAttribute('aTiming', timingAttr);
    // Drawn with every slot at build time (compiled with the scene); update() gates it.
    geometry.instanceCount = n;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-meteors';
    material.fog = false;
    material.forceSinglePass = true;

    const age = Fn(() => uTime.sub(attribute('aTiming', 'vec4').x));

    material.positionNode = Fn(() => {
        const start = attribute('aStart', 'vec3');
        const vel = attribute('aVel', 'vec3');
        const tm = attribute('aTiming', 'vec4');
        const t = clamp(age(), 0.0, tm.y);
        const head = start.add(vel.mul(t));
        const speed = max(length(vel), 1.0);
        const axis = vel.div(speed);
        const toCam = cameraPosition.sub(head);
        const dist = max(length(toCam), 1.0);
        const side = normalize(cross(axis, toCam.div(dist)));
        // Trail grows over the first ~0.3 s of flight, then holds.
        const trail = speed.mul(clamp(t, 0.0, 0.3)).max(1.0);
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        const q = positionGeometry;
        const along = q.y.add(0.5); // 0 tail → 1 head
        const a0 = age();
        const live = step(0.0, a0).mul(step(a0, tm.y.add(0.05))); // dead slots: zero area
        const width = max(tm.z.mul(worldPerPx), worldPerPx.mul(1.5)).mul(along.mul(0.7).add(0.3)).mul(live);
        return head.sub(axis.mul(float(1.0).sub(along).mul(trail).mul(live))).add(side.mul(q.x.mul(width)));
    })();

    material.colorNode = Fn(() => {
        const tm = attribute('aTiming', 'vec4');
        const q = positionGeometry;
        const along = q.y.add(0.5); // 1 = head
        const a0 = age();
        const life = clamp(a0.div(max(tm.y, 0.01)), 0.0, 1.0);
        const alive = smoothstep(0.0, 0.18, life).mul(float(1.0).sub(smoothstep(0.55, 1.0, life)))
            .mul(step(0.0, a0)).mul(step(a0, tm.y));
        const across = pow(clamp(float(1.0).sub(abs(q.x).mul(2.0)), 0.0, 1.0), 1.5); // clamped: see streaks
        const back = float(1.0).sub(along); // 0 at the head
        const [c0, c1, c2, c3] = METEOR_RAMP;
        const ramp = mix(
            mix(vec3(c0.r, c0.g, c0.b), vec3(c1.r, c1.g, c1.b), smoothstep(0.0, 0.15, back)),
            mix(vec3(c2.r, c2.g, c2.b), vec3(c3.r, c3.g, c3.b), smoothstep(0.5, 0.85, back)),
            smoothstep(0.15, 0.5, back),
        );
        const falloff = pow(max(along, 0.0), 1.8).mul(float(1.0).sub(smoothstep(0.85, 1.0, back)));
        const headGlow = exp(back.mul(back).mul(-120.0));
        const value = tm.w.mul(falloff.mul(0.45).add(headGlow));
        return vec4(min(ramp.mul(value).mul(across).mul(alive).mul(uIntensity), vec3(4.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-meteors';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;

    let cursor = 0;
    const deathTimes = new Float64Array(n).fill(-1e4);
    return {
        mesh,
        material,
        uniforms: { uIntensity },
        /**
         * @param {{start: THREE.Vector3, velocity: THREE.Vector3, life: number, widthPx: number,
         *   value: number, time: number}} s
         */
        spawn(s) {
            const i = cursor;
            cursor = (cursor + 1) % n;
            aStart.set([s.start.x, s.start.y, s.start.z], i * 3);
            aVel.set([s.velocity.x, s.velocity.y, s.velocity.z], i * 3);
            aTiming.set([s.time, s.life, s.widthPx, s.value], i * 4);
            deathTimes[i] = s.time + s.life;
            startAttr.addUpdateRange(i * 3, 3);
            velAttr.addUpdateRange(i * 3, 3);
            timingAttr.addUpdateRange(i * 4, 4);
            startAttr.needsUpdate = true;
            velAttr.needsUpdate = true;
            timingAttr.needsUpdate = true;
        },
        /** Number of live slots at `time` (0 → the draw is skipped). */
        update(time) {
            let alive = 0;
            for (let i = 0; i < n; i++) if (deathTimes[i] > time) alive += 1;
            geometry.instanceCount = alive > 0 ? n : 0;
            return alive;
        },
        /** Kill every meteor (used when seeking the simulation). */
        clear() {
            for (let i = 0; i < n; i++) aTiming[i * 4] = -1e4;
            deathTimes.fill(-1e4);
            // Whole buffer: a spawn() before the next upload adds its own range, and r185 then
            // uploads only the listed ranges.
            timingAttr.clearUpdateRanges();
            timingAttr.addUpdateRange(0, aTiming.length);
            timingAttr.needsUpdate = true;
            geometry.instanceCount = 0;
            cursor = 0; // same slot assignment after every seek
        },
        /** Make every slot drawable once so a warm-up compiles the pipeline. */
        armForWarmup() {
            geometry.instanceCount = n;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
