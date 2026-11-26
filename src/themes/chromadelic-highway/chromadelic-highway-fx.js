/**
 * Chromadelic Highway — tunnel rings, refined ring air, hyperspace speed streaks,
 * glinting stardust motes and multi-tinted meteors/comets.
 *
 * Everything here is GPU-animated in closed form from the shared clock (time, travel):
 *   - zero per-frame vertex uploads for rings, streaks, and motes,
 *   - deterministic & seekable for phase-locked captures,
 *   - ONE draw call and ONE pipeline per system, compiled at build time.
 *
 * Upgrades in this masterpiece pass:
 *   - Rings: precision glowing vertex corner nodes on hex/oct polygon gates, subtle inner
 *     harmonic ring echo on accent arches & high heat, liquid-gold B2B gilding, rotational
 *     torque shimmer on Twists, and a gentler optical fade over the hero planet (eliminating the
 *     artificial circular bruised patch!).
 *   - Ring Air: tightened exponential falloff & lower rest milkiness so the velvet obsidian sky
 *     keeps rich contrast while flaring vibrantly during chases and cascades.
 *   - Speed Streaks: sleeker, longer, tapered hyperspace light-streaks with blazing pinpoint heads,
 *     rich chromatic neon tails, plus a dedicated fast near-peripheral edge layer for exhilarating
 *     velocity perception!
 *   - Motes: crisp bokeh-soft cosmic stardust catching vivid color glints as rings pass over them.
 *   - Meteors & Comets: per-slot RGB color override so celebratory Perfect Clear / B2B twin comets
 *     can blaze in liquid gold & diamond prism alongside classic cyan-magenta-violet meteors!
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
    fwidth,
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
    vec2,
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
    chdNeonColor,
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
const GOLD_COL = vec3(1.0, 0.85, 0.45);

// ─────────────────────────────────────────────────────────────────────────────
// Tunnel rings: pixel-clamped neon arches on the ring lattice
// ─────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const ARC_THETA0 = THREE.MathUtils.degToRad(-20);
const ARC_THETA1 = THREE.MathUtils.degToRad(200);

/** Lattice ring count for a tier: the largest count ≤ `count` that divides 240. */
export function latticeRingCount(count) {
    let n = Math.max(1, Math.floor(count));
    while (RING_COUNT_MODULUS % n !== 0) n -= 1;
    return n;
}

/** Arc strip over θ −20°…200°: position = (cosθ, sinθ, side ±1), uv = (θ/2π, (side+1)/2). */
function buildArcStrip(segments, instances) {
    const pos = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
        const a = ARC_THETA0 + (i / segments) * (ARC_THETA1 - ARC_THETA0);
        for (let side = -1; side <= 1; side += 2) {
            pos.push(Math.cos(a), Math.sin(a), side);
            uvs.push(a / TAU, (side + 1) / 2);
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
    geometry.instanceCount = instances;
    return geometry;
}

/** Per-ring terms shared by the ring strip and its air (vertex stage). */
function ringLattice(n, shared, centerY) {
    const {
        uTime, uTravel, uPxScale, uRingPalette, uRingGlow, uRingForm, uDEmerge, uCascade,
    } = shared;
    const zStart = TUNNEL_Z_NEAR - n * RING_SPACING;
    const k = float(instanceIndex);
    const q = uTravel.div(RING_SPACING).add(k);
    const zR = float(zStart).add(fract(q.div(n)).mul(n * RING_SPACING));
    const J = floor(float(TUNNEL_Z_NEAR).add(uTravel).sub(zR).div(RING_SPACING)
        .add(0.5));
    const slot = int(J.sub(floor(J.mul(1.0 / 16.0)).mul(16.0)));
    const beat = J.sub(floor(J.mul(0.25)).mul(4.0));
    const parity = J.sub(floor(J.mul(0.5)).mul(2.0));
    const curve = chdRoadCurve(zR, uTime);
    const C0 = vec3(curve.x, curve.y.add(centerY), zR);
    const depth = max(cameraViewMatrix.mul(vec4(C0, 1.0)).z.negate(), 1.0);
    const front = (u) => {
        const age = max(uTime.sub(u.x), 0.0);
        const dN = depth.sub(u.y.sub(u.z.mul(age))).div(180.0);
        return u.w.mul(exp(dN.mul(dN).negate()));
    };
    const cascadeA = front(uCascade);
    const cascadeB = shared.uCascade2 ? front(shared.uCascade2) : float(0.0);
    return {
        zR,
        J,
        accent: step(2.5, beat),
        parity,
        C0,
        depth,
        pxPerW: uPxScale.div(depth),
        core: uRingPalette.element(slot),
        glow: uRingGlow.element(slot),
        form: uRingForm.element(slot),
        cascade: cascadeA.add(cascadeB),
        cascadeA,
        cascadeB,
        // Emerge slightly deeper (+420) so 4–5 concentric neon arches nest rhythmically in depth!
        shown: step(depth, uDEmerge.add(420.0)),
    };
}

/** Flat-topped regular polygon radius factor (mean radius ~1; 1 for round rings). */
function shapeFactor(theta, shapeN) {
    const N = max(shapeN, 3.0);
    const seg = float(TAU).div(N);
    const half = float(Math.PI).div(N);
    const local = fract(theta.sub(float(Math.PI / 2).sub(half)).div(seg)).sub(0.5).mul(seg);
    const c = cos(half);
    return mix(float(1.0), c.div(cos(local)).mul(float(2.0).div(c.add(1.0))), step(2.5, shapeN));
}

export function createTunnelRings({
    count = 8,
    radius = 260,
    centerY = 25,
    segments = 96,
    shared,
} = {}) {
    const n = latticeRingCount(count);
    const {
        uTime, uDEmerge, uCascadeCol, uCascadePrism, uChase, uChase2, uRingPhase, uViewportPx, uHeroPx, waves,
    } = shared;
    const uRingEnv = shared.uRingEnv ?? uniform(0);
    const uGoldGild = shared.uGoldGild ?? uniform(0);
    const uIntensity = uniform(1.0);
    const geometry = buildArcStrip(segments, n);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-rings';
    material.fog = false;
    material.forceSinglePass = true;

    const L = ringLattice(n, shared, centerY);
    const wv = chdWaves(L.zR, waves, L.core);
    const flash = max(wv.amount.mul(0.62), min(L.cascade, 1.35));
    const isDouble = step(0.5, L.form.y).mul(step(L.form.y, 1.5));
    const corePx = clamp(float(1.65).mul(L.pxPerW), 1.0, 2.5).mul(mix(1.0, 1.32, L.accent))
        .add(uRingEnv.mul(0.62))
        .add(flash.mul(0.95));
    const stripPx = min(corePx.mul(6.8), mix(float(13.0), float(17.5), smoothstep(500.0, 700.0, L.depth)))
        .mul(mix(1.0, 1.5, isDouble));
    const waveHue = wv.color.div(max(wv.amount, 0.001));
    const waveMix = min(wv.amount, 1.0).mul(0.62);
    const uCascadeCol2 = shared.uCascadeCol2 ?? uniform(new THREE.Vector4(1, 1, 1, 0));
    const uCascadePrism2 = shared.uCascadePrism2 ?? uniform(0);
    const tintA = min(L.cascadeA, 1.0).mul(uCascadeCol.w);
    const tintB = min(L.cascadeB, 1.0).mul(uCascadeCol2.w);
    const coreTint = mix(mix(mix(L.core, waveHue, waveMix), uCascadeCol.xyz, tintA), uCascadeCol2.xyz, tintB);
    const glowTint = mix(mix(mix(L.glow.xyz, waveHue, waveMix), uCascadeCol.xyz, tintA), uCascadeCol2.xyz, tintB);
    const prismCascade = L.cascadeA.mul(uCascadePrism).add(L.cascadeB.mul(uCascadePrism2));

    material.vertexNode = Fn(() => {
        const p = positionGeometry;
        const theta = uv().x.mul(TAU);
        const rad = float(radius).mul(shapeFactor(theta, L.form.x)).add(p.z.mul(stripPx.div(L.pxPerW)));
        const world = L.C0.add(vec3(p.x.mul(rad), p.y.mul(rad), 0.0).mul(L.shown));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.outputNode = Fn(() => {
        const vA = vertexStage(vec4(L.depth, positionGeometry.y.mul(radius).add(centerY), flash, prismCascade));
        const vB = vertexStage(vec4(corePx, stripPx, L.pxPerW.mul(radius), L.accent.add(L.parity.mul(2.0))));
        const vCore = vertexStage(coreTint);
        const vGlow = vertexStage(vec4(glowTint, L.glow.w));
        const vForm = vertexStage(L.form);
        const vJ = vertexStage(L.J);
        const vDepth = vA.x;
        const vY = vA.y;
        const vFlash = vA.z;
        const vPrismCascade = vA.w;
        const vParity = step(1.5, vB.w);
        const vAccent = vB.w.sub(vParity.mul(2.0));
        const vK = vB.x.div(vB.y);

        const st = uv();
        const theta = st.x.mul(TAU);
        const v = abs(st.y.mul(2.0).sub(1.0)); // 0 on centre line -> 1 at strip edge
        const pat = vForm.y;
        const pDouble = step(0.5, pat).mul(step(pat, 1.5));
        const pDash = step(1.5, pat).mul(step(pat, 2.5));
        const pBead = step(2.5, pat);
        const cnt = max(vForm.z, 1.0);
        const cell = theta.add(uRingPhase.mul(vForm.w)).mul(cnt).div(TAU);
        const fwC = max(fwidth(cell), 1e-4);
        const d = fract(cell);

        const core = float(1.0).sub(smoothstep(vK.mul(0.55), vK.mul(1.3), v));
        const dv = abs(v.sub(0.45));
        const coreDouble = float(1.0).sub(smoothstep(vK.mul(0.38), vK.mul(0.95), dv));
        const dashAa = fwC.mul(1.5);
        const dash = smoothstep(0.0, dashAa, d).mul(float(1.0).sub(smoothstep(float(0.6).sub(dashAa), 0.6, d)));
        const dashAA = mix(dash, float(0.6), clamp(fwC.mul(3.0).sub(0.6), 0.0, 1.0));
        const alongPx = d.sub(0.5).div(cnt).mul(TAU).mul(vB.z);
        const signedPx = st.y.mul(2).sub(1).mul(vB.y);
        const acrossPx = abs(signedPx);
        const beadR = vB.x.mul(1.7);
        const bead = exp(alongPx.mul(alongPx).add(acrossPx.mul(acrossPx)).div(beadR.mul(beadR)).negate());
        const beadAA = mix(bead, core.mul(0.55), smoothstep(0.12, 0.3, fwC));
        const beadGlow = exp(alongPx.mul(alongPx).div(beadR.mul(beadR).mul(9.0)).negate());

        // Subtle inner secondary harmonic filament on accent arches & hot play!
        const harmonic = float(1.0).sub(smoothstep(vK.mul(0.28), vK.mul(0.72), abs(st.y.sub(0.28))))
            .mul(vAccent.mul(0.35).add(uRingEnv.mul(0.22))).mul(float(1.0).sub(pDouble));

        // Precision laser-joint corner nodes on hexagonal & octagonal gates (shape >= 6).
        const isPoly = step(5.5, vForm.x);
        const polyN = max(vForm.x, 6.0);
        const polyCorner = abs(fract(theta.sub(float(Math.PI / 2)).mul(polyN).div(TAU).add(0.5)).sub(0.5));
        const cornerNode = exp(polyCorner.mul(polyCorner).mul(-120.0)).mul(exp(v.mul(v).mul(-24.0))).mul(isPoly).mul(0.75);

        // Concentrated plasma emitter node right where the neon arch ignites from the sculpted wing-pillar!
        const dFootR = theta.sub(float(-0.095)).div(0.065);
        const dFootL = theta.sub(float(Math.PI + 0.095)).div(0.065);
        const footNode = exp(dFootR.mul(dFootR).negate()).add(exp(dFootL.mul(dFootL).negate()))
            .mul(exp(v.mul(v).mul(-9.0))).mul(0.75);

        const shapeCore = mix(mix(mix(core, coreDouble, pDouble), core.mul(dashAA), pDash), beadAA, pBead)
            .add(harmonic)
            .add(cornerNode)
            .add(footNode);
        const glowMask = mix(float(1.0), mix(float(0.35), float(1.0), dashAA), pDash)
            .mul(mix(float(1.0), beadGlow.mul(0.65).add(0.35), pBead));
        const g = mix(v, dv, pDouble).div(vK.mul(2.8));
        const glow = exp(g.mul(g).negate());
        const halo = exp(v.mul(-3.5)).mul(float(1.0).sub(smoothstep(0.8, 1.0, v)));

        // Prism rings, Quad prism cascades, and liquid-gold B2B resonance.
        const arcN = theta.sub(ARC_THETA0).div(ARC_THETA1 - ARC_THETA0);
        const prismOn = step(0.5, vGlow.w);
        const prismCol = chdNeonColor(fract(vGlow.w).add(arcN.mul(0.88)), float(0.52));
        const burstCol = chdNeonColor(arcN.add(vJ.mul(0.137)), float(0.58));
        const burst = min(vPrismCascade.mul(1.8), 1.0);
        const goldMix = clamp(uGoldGild.mul(0.75), 0.0, 0.85);
        const coreCol = mix(mix(mix(vCore, prismCol, prismOn), GOLD_COL, goldMix), burstCol, burst);
        const glowCol = mix(mix(mix(vGlow.xyz, prismCol.mul(0.86), prismOn), GOLD_COL, goldMix), burstCol, burst);

        // A dark metal channel and its narrow exterior lip give nearby lamps thickness.
        // The double tubes have separate seats. Beads and dashed lamps leave gaps in them.
        const tubePx = mix(signedPx, acrossPx.sub(vB.y.mul(0.45)), pDouble);
        const shellWidth = vB.x.mul(mix(1.62, 1.24, pDouble)).add(1.15);
        const shell = float(1).sub(smoothstep(shellWidth.sub(0.55), shellWidth.add(0.45), abs(tubePx)));
        const glassRim = float(1).sub(smoothstep(0.26, 1.12, abs(tubePx.sub(shellWidth).add(0.42))));
        const resolveShell = smoothstep(120, 360, vB.z);
        // Fixed ferrules along the tube take a cool highlight on their trailing edge.
        const ferruleDist = abs(fract(st.x.mul(28).add(0.5)).sub(0.5)).mul(TAU / 28).mul(vB.z);
        const ferrule = float(1).sub(smoothstep(0.66, 1.6, ferruleDist)).mul(resolveShell)
            .mul(float(1).sub(max(pDash, pBead)));

        // Chase lights climbing every arch from feet to crown (up to 2 concurrent chases).
        const arcPos = abs(theta.sub(Math.PI / 2)).div(ARC_THETA1 - Math.PI / 2);
        const chaseOf = (u) => {
            const chaseAge = uTime.sub(u.x);
            let sum = float(0.0);
            for (let i = 0; i < 3; i += 1) {
                const s = chaseAge.sub(i * 0.12).div(u.y);
                const front = float(1.0).sub(clamp(s, 0.0, 1.0));
                const df = arcPos.sub(front).div(0.085);
                const head = exp(df.mul(df).negate());
                const filled = smoothstep(front.sub(0.03), front.add(0.03), arcPos).mul(0.48);
                const live = step(0.0, s).mul(float(1.0).sub(smoothstep(0.9, 1.6, s))).mul(step(i + 0.5, u.z));
                sum = sum.add(head.add(filled).mul(live));
            }
            return min(sum, 1.7).mul(u.w);
        };
        const chase = min(chaseOf(uChase).add(uChase2 ? chaseOf(uChase2) : float(0.0)), 2.3);

        // Orbiting light packets (alternating spin direction between neighbouring arches).
        const dir = mix(float(-1.0), float(1.0), vParity);
        const packets = pow(cos(theta.mul(3.0).sub(uRingPhase.mul(dir))).mul(0.5).add(0.5), 9.0);

        // Gentle feathered optical easing over the hero planet (keeps the planet legible without
        // stamping an artificial dark bruised circle onto the ring!).
        const pPx = screenUV.mul(uViewportPx);
        const heroM = float(1.0).sub(
            smoothstep(uHeroPx.z.mul(0.85), uHeroPx.z.add(uViewportPx.y.mul(0.065)), length(pPx.sub(uHeroPx.xy))),
        );

        const ig = vDepth.sub(uDEmerge).div(180.0);
        const ignite = exp(ig.mul(ig).negate()).mul(0.45);
        const gain = min(float(1.0).add(uRingEnv.mul(0.52)).mul(float(1.0).add(vFlash.mul(1.25))), 2.6)
            .mul(mix(1.0, 1.25, vAccent))
            .mul(float(1.0).add(ignite));
        const hot = vFlash.mul(0.45).add(0.28).add(chase.mul(0.32)).mul(float(1.0).sub(burst.mul(0.75)));
        const col = mix(coreCol, vec3(1.0), min(hot, 0.86)).mul(shapeCore).mul(2.05).mul(gain)
            .mul(float(1).sub(ferrule.mul(0.35)))
            .mul(float(1.0).add(chase.mul(1.65)))
            .mul(float(1.0).sub(heroM.mul(0.34)))
            .add(glowCol.mul(glow.mul(0.46).add(halo.mul(0.15))).mul(glowMask).mul(float(1.0).add(chase.mul(2.2)))
                .mul(float(1.0).sub(heroM.mul(0.32))))
            .mul(packets.mul(0.34).add(0.8))
            .add(mix(glowCol, vec3(0.62, 0.73, 0.86), 0.45).mul(glassRim)
                .mul(resolveShell).mul(glowMask)
                .mul(0.34));

        const fade = smoothstep(uDEmerge.add(420.0), uDEmerge.sub(40.0), vDepth)
            .mul(smoothstep(145.0, 325.0, vDepth))
            .mul(smoothstep(-16.0, 3.5, vY))
            .mul(uIntensity);
        const metalCoverage = shell.mul(glowMask).mul(resolveShell).mul(0.85);
        // Only the narrow housing occludes the background. The halo remains additive.
        return vec4(min(col.mul(fade), vec3(5.2)), metalCoverage.mul(fade));
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

/**
 * Refined atmospheric glow around each ring (tighter, less milky so the obsidian sky keeps
 * dramatic OLED contrast while flaring luminously on cascades and chases).
 */
export function createRingAir({
    count = 8,
    radius = 260,
    centerY = 25,
    segments = 64,
    inner = 0.42,
    outer = 0.22,
    shared,
} = {}) {
    const n = latticeRingCount(count);
    const {
        uTime, uDEmerge, uChase, uChase2, uViewportPx, uHeroPx, uAirGain, waves,
    } = shared;
    const uIntensity = uniform(1.0);
    const geometry = buildArcStrip(segments, n);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-ring-air';
    material.fog = false;
    material.forceSinglePass = true;

    const L = ringLattice(n, shared, centerY);
    const wv = chdWaves(L.zR, waves, L.glow.xyz);
    const flash = max(wv.amount, L.cascade);
    const airCol = mix(L.glow.xyz, chdNeonColor(fract(L.glow.w).add(0.42), float(0.42)), step(0.5, L.glow.w));

    material.vertexNode = Fn(() => {
        const p = positionGeometry;
        const theta = uv().x.mul(TAU);
        const off = mix(float(-inner), float(outer), p.z.mul(0.5).add(0.5));
        const rad = float(radius).mul(shapeFactor(theta, L.form.x)).mul(off.add(1.0));
        const world = L.C0.add(vec3(p.x.mul(rad), p.y.mul(rad), 0.0).mul(L.shown));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const vA = vertexStage(vec4(L.depth, L.C0.y.add(positionGeometry.y.mul(radius)), flash, 0.0));
        const vCol = vertexStage(airCol);
        const st = uv();
        const s0 = inner / (inner + outer);
        const dIn = float(s0).sub(st.y).div(s0);
        const dOut = st.y.sub(s0).div(1 - s0);
        const dd = max(dIn, dOut);
        const edge = float(1.0).sub(dd.mul(dd)).max(0.0);
        const theta = st.x.mul(TAU);
        const ends = smoothstep(0.0, 0.6, min(theta.sub(ARC_THETA0), float(ARC_THETA1).sub(theta)));
        // Tighter exponential profile keeps the haze sculpted round the tube instead of foggy!
        const band = exp(dd.mul(-4.4)).mul(edge.mul(edge)).mul(mix(float(0.5), float(1.0), step(st.y, s0))).mul(ends);
        const near = exp(dd.mul(dd).mul(-68.0)).mul(0.55).mul(ends);

        const pPx = screenUV.mul(uViewportPx);
        const heroEdge = uHeroPx.z.add(uViewportPx.y.mul(0.07));
        const heroM = float(1.0).sub(smoothstep(uHeroPx.z.mul(0.9), heroEdge, length(pPx.sub(uHeroPx.xy))));
        const glowOf = (u) => {
            const chaseAge = uTime.sub(u.x).div(u.y);
            return step(0.0, chaseAge).mul(float(1.0).sub(smoothstep(0.2, 1.2, chaseAge))).mul(u.w);
        };
        const chaseGlow = min(glowOf(uChase).add(uChase2 ? glowOf(uChase2) : float(0.0)), 1.8);
        const ig = vA.x.sub(uDEmerge).div(220.0);
        const gain = float(1.0).add(vA.z.mul(0.95)).add(chaseGlow.mul(0.95)).add(exp(ig.mul(ig).negate()).mul(0.5));
        const fade = smoothstep(uDEmerge.add(420.0), uDEmerge.sub(40.0), vA.x)
            .mul(smoothstep(240.0, 580.0, vA.x))
            .mul(smoothstep(-90.0, 40.0, vA.y))
            .mul(float(1.0).sub(heroM.mul(0.65)))
            .mul(uIntensity);
        const a = band.add(near).mul(gain).mul(fade).mul(uAirGain);
        return vec4(min(vCol.mul(a), vec3(0.55)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-ring-air';
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;

    return {
        mesh,
        material,
        count: n,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hyperspace speed streaks (sleek, tapered chromatic light-rails)
// ─────────────────────────────────────────────────────────────────────────────

function unitQuad(geometry) {
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
}

export function createSpeedStreaks({
    count = 240, random = Math.random, shared, warmColors, coolColors,
} = {}) {
    const n = Math.max(1, Math.floor(count));
    const {
        uTime, uTravel, uStreakLength, uStreakDensity, uViewportH, uProjScaleY, uPulse, uViewportPx, uHeroPx,
    } = shared;
    const uGoldGild = shared.uGoldGild ?? uniform(0);
    const uFeverGlow = shared.uFeverGlow ?? uniform(0);
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
        const peripheral = i < Math.floor(n * 0.28);
        for (let attempt = 0; attempt < 24; attempt++) {
            side = random() > 0.5 ? 1 : -1;
            if (peripheral) {
                // Dedicated lower-flank high-velocity peripheral speed streams right beside the road!
                const theta = THREE.MathUtils.degToRad(-18 + random() * 38);
                const r = 155 + random() * 210;
                x = side * Math.cos(theta) * r;
                y = 14 + Math.sin(theta) * r;
            } else {
                const theta = THREE.MathUtils.degToRad(-22 + random() * 88);
                const r = random() < 0.58 ? 275 + random() * 240 : 515 + random() * 410;
                x = side * Math.cos(theta) * r;
                y = 25 + Math.sin(theta) * r;
            }
            const screenAngle = side < 0 ? 180 - Math.atan2(y - 25, Math.abs(x)) * (180 / Math.PI)
                : Math.atan2(y - 25, Math.abs(x)) * (180 / Math.PI);
            const inHeroWindow = side < 0 && screenAngle > 142 && screenAngle < 186;
            if (inHeroWindow && random() > 0.3) continue;
            if (!(Math.abs(x) < 128 && y < 18)) break;
        }
        const spd = peripheral ? quantizeSpeed(1.35 + random() * 0.55) : quantizeSpeed(1.0 + random() * 0.45);
        aPos.set([x, y, TUNNEL_Z_NEAR - random() * TUNNEL_SPAN, random()], i * 4);
        aData.set([
            spd,
            (peripheral ? 1.1 : 0.8) + random() * 0.85,
            1.4 + random() * 1.9,
            (peripheral ? 1.02 : 0.47) + random() * 0.48,
        ], i * 4);
        const palette = side < 0 ? warmColors : coolColors;
        tmp.copy(palette[Math.floor(random() * palette.length) % palette.length]).lerp(white, 0.12);
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
        const shown = step(p0.w, uStreakDensity);
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        const q = positionGeometry;
        const along = q.y.add(0.5); // 0 tail -> 1 head
        // Smooth flared lance profile: narrow trailing tail widening to a crisp glowing comet head
        // (never zero width at the nose vertex of a 4-vertex quad!).
        const taper = mix(float(0.28), float(1.05), along);
        const width = max(d.z.mul(1.05), worldPerPx.mul(2.25)).mul(taper).mul(shown);
        const len = min(uStreakLength.mul(d.y), 380.0).mul(shown);
        return center.add(side.mul(q.x.mul(width))).add(vec3(0.0, 0.0, q.y.mul(len)));
    })();

    material.colorNode = Fn(() => {
        const p0 = attribute('aPos', 'vec4');
        const d = attribute('aData', 'vec4');
        const c = attribute('aCol', 'vec3');
        const q = positionGeometry;
        const z = streakZ();
        const across = q.x.mul(2.0).div(0.42);
        const beam = exp(across.mul(across).negate());
        const along = clamp(q.y.add(0.5), 0.0, 1.0); // 0 tail -> 1 head
        // Silky luminous tail + blazing white-hot rounded comet head (soft tip cutoff prevents boxiness).
        const noseCap = smoothstep(1.0, 0.90, along);
        const tail = pow(along, 1.75).mul(0.88).add(0.04);
        const headD = along.sub(0.88).div(0.09);
        const head = exp(headD.mul(headD).negate()).mul(1.12);
        const D = float(CAMERA_Z).sub(z);
        const pPx = screenUV.mul(uViewportPx);
        const heroM = float(1.0).sub(smoothstep(uHeroPx.z, uHeroPx.z.add(uViewportPx.y.mul(0.04)), length(pPx.sub(uHeroPx.xy))));
        const fade = smoothstep(float(TUNNEL_Z_FAR + 140), float(TUNNEL_Z_FAR + 860), z)
            .mul(smoothstep(105.0, 260.0, D))
            .mul(float(1.0).sub(heroM.mul(0.97)))
            .mul(uIntensity);
        const feverHue = chdNeonColor(fract(p0.w.add(along.mul(0.25)).sub(uTime.mul(0.3))), float(0.6));
        const baseCol = mix(mix(c, feverHue, uFeverGlow.mul(0.55)), GOLD_COL, clamp(uGoldGild.mul(0.7), 0.0, 0.75));
        const litCol = mix(baseCol, vec3(1.0), clamp(head.mul(0.44), 0.0, 0.70));
        // Lower flanks pass the eye fastest. Distant lanes recede to fine coloured traces,
        // leaving the bright heads and a longer exposure for the rush after a clear.
        const depthLight = mix(float(0.45), float(1.0), smoothstep(1600.0, 400.0, D));
        const value = d.w.mul(depthLight).mul(float(1.0).add(uPulse.mul(0.38)).add(uFeverGlow.mul(0.70)));
        const a = beam.mul(tail.add(head)).mul(noseCap).mul(fade);
        return vec4(min(litCol.mul(value).mul(a), vec3(4.2)), 1.0);
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
// Motes (floating luminous bokeh stardust catching passing ring light)
// ─────────────────────────────────────────────────────────────────────────────

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
        uTime, uMoteTravel, uViewportH, uProjScaleY, uMoteGain, uTravel, uRingGlow, uDEmerge,
    } = shared;
    const uIntensity = uniform(1.0);

    const geometry = new THREE.InstancedBufferGeometry();
    unitQuad(geometry);
    const aPos = new Float32Array(n * 3);
    const aData = new Float32Array(n * 4); // phase, size px, hue, drift
    for (let i = 0; i < n; i++) {
        const side = random() > 0.5 ? 1 : -1;
        aPos[i * 3] = side * (145 + random() * 640);
        aPos[i * 3 + 1] = -25 + random() * 390;
        aPos[i * 3 + 2] = TUNNEL_Z_NEAR - random() * TUNNEL_SPAN;
        aData[i * 4] = random() * Math.PI * 2;
        aData[i * 4 + 1] = 2.0 + random() * 3.8;
        aData[i * 4 + 2] = random();
        aData[i * 4 + 3] = quantizeSpeed(0.25 + random() * 0.5);
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
        const z = wrapZ(p0.z.add(uMoteTravel.mul(d.w)));
        const curve = chdRoadCurve(z, uTime);
        const bob = sin(uTime.mul(0.45).add(d.x)).mul(16.0);
        const sway = cos(uTime.mul(0.29).add(d.x.mul(1.7))).mul(12.0);
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
        const core = exp(r.mul(r).mul(-5.8));
        const bokeh = exp(r.mul(r).mul(-1.8)).mul(0.24).mul(smoothstep(1.0, 0.55, r));
        const tw = sin(uTime.mul(1.5).add(d.x.mul(3.0))).mul(0.32).add(0.68);
        const w = moteWorld();
        const { z } = w;
        const fade = smoothstep(float(TUNNEL_Z_FAR), float(TUNNEL_Z_FAR + 720), z)
            .mul(smoothstep(float(TUNNEL_Z_NEAR), float(TUNNEL_Z_NEAR - 260), z));
        const side = step(0.0, attribute('aPos', 'vec3').x);
        const tintCol = mix(vec3(1.0, 0.22, 0.72), vec3(0.18, 0.9, 1.0), side);
        const moteCol = mix(vec3(0.74, 0.68, 0.96), tintCol, 0.3);
        const a = core.add(bokeh).mul(tw).mul(fade).mul(uIntensity)
            .mul(uMoteGain);

        const J = floor(float(TUNNEL_Z_NEAR).add(uTravel).sub(z).div(RING_SPACING)
            .add(0.5));
        const zRing = float(TUNNEL_Z_NEAR).add(uTravel).sub(J.mul(RING_SPACING));
        const slot = int(J.sub(floor(J.mul(1.0 / 16.0)).mul(16.0)));
        const ringGlow = uRingGlow.element(slot);
        const ringC = chdRoadCurve(zRing, uTime);
        const rr = length(w.xy.sub(vec2(ringC.x, ringC.y.add(25.0))));
        const dr = rr.sub(260.0).div(125.0);
        const dz = z.sub(zRing).div(85.0);
        const ringDepth = float(CAMERA_Z).sub(zRing);
        const ringShown = smoothstep(uDEmerge.add(360.0), uDEmerge, ringDepth).mul(smoothstep(145.0, 325.0, ringDepth));
        const lit = exp(dz.mul(dz).negate()).mul(exp(dr.mul(dr).negate()).mul(0.75).add(0.25)).mul(ringShown);
        const litCol = mix(ringGlow.xyz, chdNeonColor(fract(ringGlow.w).add(0.42), float(0.45)), step(0.5, ringGlow.w));
        const glint = mix(litCol, vec3(1.0), 0.22).mul(lit).mul(core.add(bokeh.mul(1.4))).mul(fade)
            .mul(uIntensity)
            .mul(1.55);
        return vec4(moteCol.mul(a).mul(0.48).add(glint), 1.0);
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
// Meteors & celebratory comets (fixed pool, per-slot custom tint, one draw)
// ─────────────────────────────────────────────────────────────────────────────

const METEOR_RAMP = ['#f2fbff', '#78f5ff', '#ff56db', '#642cff'].map((h) => new THREE.Color(h));

export function createMeteors({ pool = 8, shared } = {}) {
    const n = Math.max(1, Math.floor(pool));
    const { uTime, uViewportH, uProjScaleY } = shared;
    const uIntensity = uniform(1.0);

    const geometry = new THREE.InstancedBufferGeometry();
    unitQuad(geometry);
    const aStart = new Float32Array(n * 3);
    const aVel = new Float32Array(n * 3);
    const aTiming = new Float32Array(n * 4); // birth, life, width px, peak value
    const aTint = new Float32Array(n * 4); // r, g, b, tintAmount (0 = classic ramp, 1 = custom color)
    for (let i = 0; i < n; i++) {
        aTiming[i * 4] = -1e4;
        aTiming[i * 4 + 1] = 1;
        aTint.set([1, 1, 1, 0], i * 4);
    }
    const startAttr = new THREE.InstancedBufferAttribute(aStart, 3);
    const velAttr = new THREE.InstancedBufferAttribute(aVel, 3);
    const timingAttr = new THREE.InstancedBufferAttribute(aTiming, 4);
    const tintAttr = new THREE.InstancedBufferAttribute(aTint, 4);
    [startAttr, velAttr, timingAttr, tintAttr].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aStart', startAttr);
    geometry.setAttribute('aVel', velAttr);
    geometry.setAttribute('aTiming', timingAttr);
    geometry.setAttribute('aTint', tintAttr);
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
        const trail = speed.mul(clamp(t, 0.0, 0.34)).max(1.0);
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        const q = positionGeometry;
        const along = q.y.add(0.5);
        const a0 = age();
        const live = step(0.0, a0).mul(step(a0, tm.y.add(0.05)));
        // Smooth flared comet-lance profile (never pinch head vertex of 4-vertex quad to 0!).
        const width = max(tm.z.mul(worldPerPx), worldPerPx.mul(2.4)).mul(along.mul(0.85).add(0.28)).mul(live);
        return head.sub(axis.mul(float(1.0).sub(along).mul(trail).mul(live))).add(side.mul(q.x.mul(width)));
    })();

    material.colorNode = Fn(() => {
        const tm = attribute('aTiming', 'vec4');
        const tint = attribute('aTint', 'vec4');
        const q = positionGeometry;
        const along = clamp(q.y.add(0.5), 0.0, 1.0);
        const a0 = age();
        const life = clamp(a0.div(max(tm.y, 0.01)), 0.0, 1.0);
        const alive = smoothstep(0.0, 0.14, life).mul(float(1.0).sub(smoothstep(0.55, 1.0, life)))
            .mul(step(0.0, a0)).mul(step(a0, tm.y));
        const across = pow(clamp(float(1.0).sub(abs(q.x).mul(2.0)), 0.0, 1.0), 1.35);
        const back = float(1.0).sub(along);
        const noseCap = smoothstep(1.0, 0.90, along);
        const [c0, c1, c2, c3] = METEOR_RAMP;
        const classicRamp = mix(
            mix(vec3(c0.r, c0.g, c0.b), vec3(c1.r, c1.g, c1.b), smoothstep(0.0, 0.15, back)),
            mix(vec3(c2.r, c2.g, c2.b), vec3(c3.r, c3.g, c3.b), smoothstep(0.5, 0.85, back)),
            smoothstep(0.15, 0.5, back),
        );
        const customRamp = mix(vec3(1.0, 0.98, 0.92), tint.xyz, smoothstep(0.04, 0.4, back));
        const ramp = mix(classicRamp, customRamp, tint.w);
        const falloff = pow(along, 1.65).mul(float(1.0).sub(smoothstep(0.84, 1.0, back)));
        const headGlow = exp(along.sub(0.89).div(0.085).pow2().negate()).mul(1.85);
        const value = tm.w.mul(falloff.mul(0.65).add(headGlow)).mul(noseCap);
        return vec4(min(ramp.mul(value).mul(across).mul(alive).mul(uIntensity), vec3(5.5)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-meteors';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;

    const deathTimes = new Float64Array(n).fill(-1e4);
    return {
        mesh,
        material,
        uniforms: { uIntensity },
        capacity: n,
        spawn(s) {
            let i = -1;
            let nearest = 0;
            for (let k = 0; k < n; k++) {
                if (deathTimes[k] <= s.time) {
                    i = k;
                    break;
                }
                if (deathTimes[k] < deathTimes[nearest]) nearest = k;
            }
            if (i < 0) {
                if (!s.evict && deathTimes[nearest] - s.time > 0.15) return false;
                i = nearest;
            }
            aStart.set([s.start.x, s.start.y, s.start.z], i * 3);
            aVel.set([s.velocity.x, s.velocity.y, s.velocity.z], i * 3);
            aTiming.set([s.time, s.life, s.widthPx, s.value], i * 4);
            if (s.color) aTint.set([s.color.r, s.color.g, s.color.b, 1], i * 4);
            else aTint.set([1, 1, 1, 0], i * 4);
            deathTimes[i] = s.time + s.life;
            startAttr.addUpdateRange(i * 3, 3);
            velAttr.addUpdateRange(i * 3, 3);
            timingAttr.addUpdateRange(i * 4, 4);
            tintAttr.addUpdateRange(i * 4, 4);
            startAttr.needsUpdate = true;
            velAttr.needsUpdate = true;
            timingAttr.needsUpdate = true;
            tintAttr.needsUpdate = true;
            return true;
        },
        update(time) {
            let alive = 0;
            for (let i = 0; i < n; i++) if (deathTimes[i] > time) alive += 1;
            geometry.instanceCount = alive > 0 ? n : 0;
            return alive;
        },
        clear() {
            for (let i = 0; i < n; i++) aTiming[i * 4] = -1e4;
            deathTimes.fill(-1e4);
            timingAttr.clearUpdateRanges();
            timingAttr.addUpdateRange(0, aTiming.length);
            timingAttr.needsUpdate = true;
            geometry.instanceCount = 0;
        },
        armForWarmup() {
            geometry.instanceCount = n;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
