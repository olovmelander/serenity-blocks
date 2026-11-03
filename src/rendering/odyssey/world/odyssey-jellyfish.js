/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE JELLYFISH (2026-11-01) — a living drift in chapter 2's open water, one draw.
 *
 * Every jelly in the sea (odyssey-jellyfish-drift.js: where each hangs, how it beats and drifts)
 * is one instance of one small mesh: a bell (a dome of 24 x 9 quads), sixteen tentacles and four
 * oral arms as ribbons. The vertex stage places all of it from the clock and the jelly's row, as
 * the CPU twin does (no per-jelly CPU work):
 *   - the BELL contracts fast and relaxes slowly (`jellySqueeze`): its margin pulls in and down,
 *     the eight lobes of its rim ripple, and it glides up its axis on the stroke and coasts;
 *   - the TENTACLES and ARMS hang from the margin and the mouth and LAG: a point a share s down a
 *     strand sits where its root was `lag x s` seconds ago (a delay line through the jelly's own
 *     motion), so each beat's surge runs down them and they trail through the drift's turns.
 *     They sway slowly on top. The contraction travels down them the same way;
 *   - the tentacles are hairlines held at least ~one pixel wide on screen, their light scaled by
 *     how much of that pixel they really cover, so far ones neither vanish nor sparkle.
 *
 * LOOK. Translucent, drawn premultiplied over the water: a little of what is behind is taken
 * (alpha) and the tissue's own scattered light added. The bell is glassy (thin where it faces
 * the eye, dense at its rim) and glows where the surface's light comes through it. Three kinds:
 * moon jellies (pale glass with four lilac rings), sea nettles (amber with rust stripes and long
 * cream arms) and small deep lanterns (dark violet with a ring of blue light that runs round
 * now and then). Lit and hazed by the world's own water (its `applyAerial`, exactly as the fish
 * are); the glow is carried through the water on its own (per channel, red first).
 *
 * THE SEA'S RULES, as the fish and the visitors keep them:
 *   - behind chapter 1's steam: it writes its depth just past the shell (`behindSteamDepth`) and
 *     is drawn before it, so the steam covers it and lets it through as it clears;
 *   - after the breach: seen through the surface with the sea's own Fresnel and absorption
 *     (`throughSurfaceNode`), and kept drawn while any jelly in view still shows
 *     (`seenFromAbove`, the CPU twin). Under the water nothing of that changes a pixel.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    mod,
    positionGeometry,
    positionWorld,
    pow,
    screenSize,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    JELLY_KINDS, JELLY_PULSE, JELLY_SURGE_END, OCEAN_JELLIES, jellyAt, jellyBeatS, jellyHang, jellyHome,
} from '../composition/odyssey-jellyfish-drift.js';
import { behindSteamDepth } from '../composition/odyssey-steam-quench.js';
import {
    ODYSSEY_THROUGH_SURFACE, throughSurfaceNode, throughSurfaceShare,
} from '../composition/odyssey-through-surface.js';

const TAU = Math.PI * 2;

/** The mesh every jelly shares. */
export const JELLY_MESH = Object.freeze({
    around: 24,
    rings: 9,
    tentacles: 16,
    tentacleSegments: 14,
    arms: 4,
    armSegments: 12,
    /** The bell's profile runs this far round from the apex (rad): its margin curls under. */
    phiMax: 1.72,
});

/**
 * Per kind (moon, nettle, lantern), linear colours authored past the water's grade like the
 * fish's. `alpha` [facing, rim]; `strand` the tentacles' colour and opacity; `width` their
 * half-width in bell radii; `flare` how they spread from the margin (share of their length);
 * `lag` seconds of delay down a strand per bell radius of its length (plus a floor).
 */
export const JELLY_LOOK = Object.freeze({
    tissue: [[0.62, 0.80, 0.90], [1.9, 0.62, 0.16], [0.10, 0.035, 0.11]],
    accent: [[0.86, 0.56, 0.90], [1.25, 0.20, 0.06], [0.34, 0.03, 0.10]],
    alpha: [[0.07, 0.55], [0.14, 0.55], [0.30, 0.45]],
    strand: [[0.78, 0.90, 0.97], [1.5, 0.36, 0.20], [0.36, 0.42, 0.78]],
    strandAlpha: [0.36, 0.42, 0.34],
    arm: [[0.80, 0.88, 0.96], [1.45, 0.92, 0.66], [0.55, 0.30, 0.62]],
    armAlpha: [0.34, 0.50, 0.40],
    glow: [[0.40, 0.90, 1.00], [1.00, 0.62, 0.30], [0.28, 0.68, 1.00]],
    width: [0.011, 0.010, 0.014],
    armWidth: [0.15, 0.17, 0.12],
    flare: [0.12, -0.04, 0.05],
    lag: [0.25, 0.16, 0.2],
});

/**
 * The shared mesh: `position` carries (cos a, s, sin a) — the angle round the bell and the share
 * down the bell (v) or down a strand (s) — and `aPart` (part, side): 0 bell, 1 tentacle, 2 arm,
 * and which edge of a ribbon. Bell first, then arms, then tentacles (the order they blend in).
 */
export function buildJellyGeometry(jellies = OCEAN_JELLIES) {
    const M = JELLY_MESH;
    const pos = [];
    const part = [];
    const index = [];
    const vert = (x, y, z, p, side) => {
        pos.push(x, y, z);
        part.push(p, side);
        return (pos.length / 3) - 1;
    };
    // The bell: an apex and rings out to the margin.
    const apex = vert(1, 0, 0, 0, 0);
    const ring = [];
    for (let r = 1; r <= M.rings; r += 1) {
        const row = [];
        for (let a = 0; a < M.around; a += 1) {
            const th = (TAU * a) / M.around;
            row.push(vert(Math.cos(th), r / M.rings, Math.sin(th), 0, 0));
        }
        ring.push(row);
    }
    for (let a = 0; a < M.around; a += 1) index.push(apex, ring[0][(a + 1) % M.around], ring[0][a]);
    for (let r = 1; r < M.rings; r += 1) {
        for (let a = 0; a < M.around; a += 1) {
            const b = (a + 1) % M.around;
            index.push(ring[r - 1][a], ring[r - 1][b], ring[r][a], ring[r - 1][b], ring[r][b], ring[r][a]);
        }
    }
    const ribbon = (count, segments, partId, angle) => {
        for (let i = 0; i < count; i += 1) {
            const th = angle(i);
            const rows = [];
            for (let s = 0; s <= segments; s += 1) {
                const sig = s / segments;
                rows.push([
                    vert(Math.cos(th), sig, Math.sin(th), partId, -1),
                    vert(Math.cos(th), sig, Math.sin(th), partId, 1),
                ]);
            }
            for (let s = 0; s < segments; s += 1) {
                index.push(rows[s][0], rows[s][1], rows[s + 1][0], rows[s][1], rows[s + 1][1], rows[s + 1][0]);
            }
        }
    };
    ribbon(M.arms, M.armSegments, 2, (i) => (Math.PI / 4) + ((i * Math.PI) / 2));
    ribbon(M.tentacles, M.tentacleSegments, 1, (i) => (TAU * (i + 0.5)) / M.tentacles);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
    geometry.setIndex(index);
    geometry.instanceCount = jellies.length;
    // Per jelly: A home + bell radius, B beat (s) / phase / glide (u) / loop (u),
    // C sin tilt / cos tilt / turn / spin, D bob (u) / bob period (s) / reach (radii) / kind.
    const A = new Float32Array(jellies.length * 4);
    const B = new Float32Array(jellies.length * 4);
    const C = new Float32Array(jellies.length * 4);
    const D = new Float32Array(jellies.length * 4);
    const home = { x: 0, y: 0, z: 0 };
    jellies.forEach((j, i) => {
        jellyHome(j, home);
        A.set([home.x, home.y, home.z, j.r], i * 4);
        B.set([jellyBeatS(j), j.phase, JELLY_KINDS[j.kind].glide * j.r, j.loop], i * 4);
        C.set([Math.sin(j.tilt), Math.cos(j.tilt), j.turn, j.spin], i * 4);
        D.set([j.bob, j.bobS, j.reach, j.kind], i * 4);
    });
    geometry.setAttribute('aJellyA', new THREE.InstancedBufferAttribute(A, 4));
    geometry.setAttribute('aJellyB', new THREE.InstancedBufferAttribute(B, 4));
    geometry.setAttribute('aJellyC', new THREE.InstancedBufferAttribute(C, 4));
    geometry.setAttribute('aJellyD', new THREE.InstancedBufferAttribute(D, 4));
    geometry.name = 'OdysseyJellyfish';
    return geometry;
}

const safeNormalize = (v) => v.div(max(length(v), float(1e-5)));
const smoothUnit = (u) => u.mul(u).mul(float(3).sub(u.mul(2)));

/**
 * @param {object} opts
 * @param {object} opts.uTime the world's clock (uniform node, seconds)
 * @param {object} opts.uLife the 1->2 carry's ocean-life presence (uniform node, 0..1)
 * @param {number} opts.seaLevel
 * @param {(colour: object, wp: object) => object} opts.haze the world's water haze for a lit
 *   colour at a world point (its `applyAerial`, with the life carry's haze floor)
 * @param {(colour: object) => object} opts.grade the world's output grade (`toOutput`)
 * @param {(colour: object) => object} [opts.gradeLight] the grade for added light (no fade mix)
 * @param {readonly import('../composition/odyssey-jellyfish-drift.js').OceanJelly[]} [opts.jellies]
 */
export function createOdysseyJellyfish({
    uTime, uLife, seaLevel, haze, grade, gradeLight = grade, jellies = OCEAN_JELLIES,
}) {
    const geometry = buildJellyGeometry(jellies);
    const L = JELLY_LOOK;
    const K = JELLY_KINDS;
    const jA = attribute('aJellyA', 'vec4');
    const jB = attribute('aJellyB', 'vec4');
    const jC = attribute('aJellyC', 'vec4');
    const jD = attribute('aJellyD', 'vec4');
    const aPart = attribute('aPart', 'vec2');
    const kind = jD.w;
    const kMoon = float(1).sub(step(0.5, kind));
    const kLantern = step(1.5, kind);
    const kNettle = float(1).sub(kMoon).sub(kLantern);
    const pick = (t) => (Array.isArray(t[0])
        ? vec3(...t[0]).mul(kMoon).add(vec3(...t[1]).mul(kNettle)).add(vec3(...t[2]).mul(kLantern))
        : kMoon.mul(t[0]).add(kNettle.mul(t[1])).add(kLantern.mul(t[2])));

    // ── THE MOTION (the drift module's arithmetic) ──
    const surgeNorm = 1 - ((1 + JELLY_PULSE.surge) * Math.exp(-JELLY_PULSE.surge));
    const place = (tt) => {
        const n = tt.div(jB.x).add(jB.y);
        const f = fract(n);
        const k = n.sub(f);
        const x = f.mul(JELLY_PULSE.surge);
        // (the drift module's jellySurge: the coast comes to rest as the next beat starts)
        const surge = float(1).sub(x.add(1).mul(exp(x.negate()))).div(surgeNorm)
            .add(f.mul(f).mul(float(1).sub(f)).mul(JELLY_SURGE_END));
        const s = jB.z.mul(k.add(surge));
        const psi = jC.w.add(jC.z.mul(s).mul(jC.x).div(jB.w));
        const centre = vec3(
            jA.x.add(jC.z.mul(jB.w).mul(sin(psi))),
            jA.y.add(jC.y.mul(jB.z).mul(surge.sub(f)))
                .add(jD.x.mul(sin(tt.mul(TAU).div(jD.y).add(jC.w.mul(1.3))))),
            jA.z.sub(jC.z.mul(jB.w).mul(cos(psi))),
        );
        return { centre, f, psi };
    };
    const squeezeOf = (f) => {
        const c = JELLY_PULSE.contract;
        const inner = smoothUnit(clamp(f.div(c), 0, 1));
        const outer = float(1).sub(smoothUnit(pow(clamp(f.sub(c).div(1 - c), 1e-5, 1), 0.7)));
        return mix(outer, inner, float(1).sub(step(c, f)));
    };

    const r = jA.w;
    const H = pick([K[0].height, K[1].height, K[2].height]);
    const now = place(uTime);
    const q = squeezeOf(now.f);
    const axis = vec3(jC.x.mul(cos(now.psi)), jC.y, jC.x.mul(sin(now.psi)));
    const e1 = safeNormalize(vec3(axis.y, axis.x.negate(), 0));
    const e2 = safeNormalize(cross(axis, e1));
    const ca = positionGeometry.x;
    const sa = positionGeometry.z;
    const along = positionGeometry.y; // v down the bell, s down a strand
    const radial = e1.mul(ca).add(e2.mul(sa));
    const partId = aPart.x;
    const mBell = float(1).sub(step(0.5, partId));
    const mArm = step(1.5, partId);

    // ── the bell ──
    const { phiMax } = JELLY_MESH;
    const phi = along.mul(phiMax);
    const vv = along.mul(along);
    // The margin's eight lobes ripple, more as it relaxes and opens.
    const lobes = sin(atan(sa, ca).mul(8).add(uTime.mul(0.7))).mul(0.025).mul(vv.mul(vv))
        .mul(float(1).sub(q.mul(0.6)));
    const bellR = sin(phi).mul(float(1).sub(q.mul(0.24).mul(vv)).add(lobes)).mul(r);
    const bellY = cos(phi).mul(H).sub(q.mul(0.10).mul(vv)).mul(r);
    const bellPos = now.centre.add(radial.mul(bellR)).add(axis.mul(bellY));
    const bellN = safeNormalize(radial.mul(sin(phi).mul(H)).add(axis.mul(cos(phi))));

    // ── the strands: tentacles from the margin, arms from the mouth, lagging down their length ──
    const reach = jD.z.mul(r);
    const armLen = pick([K[0].arms, K[1].arms, K[2].arms]).mul(r);
    const isArm = mArm;
    const len = mix(reach, armLen, isArm);
    const lag = float(0.35).add(pick(L.lag).mul(len.div(max(r, 0.2))));
    const flare = pick(L.flare);
    const twist = pick([1.2, 2.6, 0.8]);
    // Each strand its own: a length (tentacles 62-100 % of the jelly's), a slant off the radial
    // and a phase for its sway, from a hash of its angle and the jelly's spin.
    const strandSeed = fract(sin(ca.mul(12.9898).add(sa.mul(78.233)).add(jC.w.mul(3.1))).mul(437.585));
    const ownLen = len.mul(mix(mix(float(0.62), float(1), strandSeed), float(1), isArm));
    const slant = strandSeed.sub(0.5).mul(0.45);
    const swaySeed = strandSeed.mul(TAU);
    const strandAt = (sig) => {
        const back = place(uTime.sub(lag.mul(sig)));
        const qd = squeezeOf(back.f);
        const drift = back.centre.sub(now.centre).mul(mix(float(0.85), float(0.6), isArm));
        // A tentacle's root is the margin (as it was); an arm's is the mouth, and arms turn round
        // the axis as they hang (the nettle's spiral).
        const rootR = mix(
            float(Math.sin(phiMax)).mul(float(1).sub(qd.mul(0.24))).mul(r),
            r.mul(0.13),
            isArm,
        );
        const rootY = mix(float(Math.cos(phiMax)).mul(H).sub(qd.mul(0.10)).mul(r), r.mul(-0.05), isArm);
        const turnA = mix(slant.mul(sig.mul(0.6).add(1)), sig.mul(twist).add(uTime.mul(0.11)), isArm);
        const dirA = e1.mul(cos(turnA)).sub(e2.mul(sin(turnA)));
        const dirB = e2.mul(cos(turnA)).add(e1.mul(sin(turnA)));
        const out = dirA.mul(ca).add(dirB.mul(sa));
        // Two slow waves run down it (a long one and a short ripple), growing toward the tip.
        const swayPh = uTime.mul(0.8).sub(sig.mul(3.0)).add(swaySeed).add(jC.w.mul(5.0));
        const ripplePh = uTime.mul(1.3).sub(sig.mul(7.5)).add(swaySeed.mul(1.7));
        const sway = e1.mul(sin(swayPh)).add(e2.mul(cos(swayPh.mul(0.83).add(1.1))))
            .mul(ownLen.mul(0.15).add(r.mul(0.10)))
            .mul(pow(max(sig, 0), 1.2))
            .add(e1.mul(cos(ripplePh)).add(e2.mul(sin(ripplePh))).mul(ownLen.mul(0.045)).mul(sig));
        return now.centre
            .add(out.mul(rootR.add(mix(flare, float(0.22), isArm).mul(ownLen).mul(sig))))
            .add(axis.mul(rootY.sub(ownLen.mul(sig))))
            .add(drift)
            .add(sway);
    };
    const sigma = clamp(along, 0, 1);
    const strandPos = strandAt(sigma);
    const strandNext = strandAt(sigma.add(0.04));
    const tangent = safeNormalize(strandNext.sub(strandPos));
    const toEye = cameraPosition.sub(strandPos);
    const eyeDist = max(length(toEye), 0.1);
    const side = aPart.y;
    // Tentacles: a camera-facing hairline, at least ~0.8 px wide, its light scaled by how much of
    // that it really covers. Arms: a ribbon that turns with the arm (not toward the eye).
    const facingSide = safeNormalize(cross(tangent, toEye));
    const pixel = eyeDist.mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));
    const trueHalf = r.mul(pick(L.width)).mul(float(1).sub(sigma.mul(0.6)));
    const drawnHalf = max(trueHalf, pixel.mul(0.4));
    // An arm's ribbon lies across it, round the axis (the tangent of its turn).
    const armTurn = sigma.mul(twist).add(uTime.mul(0.11));
    const armA = e1.mul(cos(armTurn)).sub(e2.mul(sin(armTurn)));
    const armB = e2.mul(cos(armTurn)).add(e1.mul(sin(armTurn)));
    const armSide = safeNormalize(armB.mul(ca).sub(armA.mul(sa)));
    const armHalf = r.mul(pick(L.armWidth)).mul(float(1).sub(sigma.mul(0.55)));
    const strandWide = mix(facingSide.mul(drawnHalf), armSide.mul(armHalf), isArm).mul(side);
    const strandFinal = strandPos.add(strandWide);

    const vData = varying(vec4(0), 'vJelly');
    const vNormal = varying(vec3(0, 1, 0), 'vJellyN');
    const vMore = varying(vec4(0), 'vJellyMore');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyJellyfish';
    material.positionNode = Fn(() => {
        vData.assign(vec4(partId, ca.mul(along), sa.mul(along), along));
        vNormal.assign(bellN);
        vMore.assign(vec4(
            side,
            clamp(trueHalf.div(drawnHalf), 0, 1),
            q,
            ca.mul(3.1).add(sa.mul(1.7)),
        ));
        return bellPos.mul(mBell).add(strandFinal.mul(float(1).sub(mBell)));
    })();

    // ── the look ──
    const part = vData.x;
    const fBell = float(1).sub(step(0.5, part));
    const fArm = step(1.5, part);
    const fTent = float(1).sub(fBell).sub(fArm);
    const V = safeNormalize(cameraPosition.sub(positionWorld));
    const N = safeNormalize(vNormal);
    const facing = clamp(abs(dot(N, V)), 0, 1);
    const rim = float(1).sub(facing).mul(float(1).sub(facing));
    // Looking up at it, the surface's light comes through it.
    const through = smoothstep(0.1, 0.9, V.y.negate());
    const depth01 = clamp(float(seaLevel).sub(positionWorld.y).div(180), 0, 1);
    const light = mix(float(0.5), float(1.0), clamp(N.y.mul(0.5).add(0.5), 0, 1))
        .mul(float(1).sub(depth01.mul(0.45)));
    const vRad = clamp(vData.w, 0, 1);
    const theta = atan(vData.z, vData.y);
    const spin = jC.w;
    // Moon: four lilac rings round the centre (the gonads).
    const quarter = mod(theta.add(TAU + (Math.PI / 4)), Math.PI / 2).sub(Math.PI / 4);
    const ringD = length(vec2(cos(quarter), sin(quarter)).mul(vRad).sub(vec2(0.34, 0)));
    const gonad = float(1).sub(smoothstep(0.03, 0.07, abs(ringD.sub(0.12)))).mul(smoothstep(0.05, 0.2, vRad));
    // Nettle: sixteen rust stripes out from the crown.
    const stripe = smoothstep(0.55, 0.95, cos(theta.mul(16))).mul(smoothstep(0.25, 0.6, vRad));
    // Lantern: a dark-red heart and a ring of lights half-way down.
    const heart = float(1).sub(smoothstep(0.22, 0.42, vRad));
    const lampBand = smoothstep(0.53, 0.57, vRad).mul(float(1).sub(smoothstep(0.61, 0.65, vRad)));
    const lamps = smoothstep(0.82, 0.97, cos(theta.mul(24).add(spin)));
    // A wave of light runs round the ring, strongest now and then (each its own clock).
    const run = pow(sin(theta.sub(uTime.mul(2.2)).add(spin.mul(3.0))).mul(0.5).add(0.5), 6);
    const flare2 = smoothstep(0.6, 1.0, sin(uTime.mul(0.37).add(spin.mul(7.0))));
    const margin = smoothstep(0.84, 1.0, vRad);
    const rhopalia = smoothstep(0.86, 0.98, cos(theta.mul(8).add(0.39))).mul(margin);

    const accentW = gonad.mul(0.9).mul(kMoon).add(stripe.mul(0.8).mul(kNettle)).add(heart.mul(kLantern));
    const bellCol = mix(pick(L.tissue), pick(L.accent), accentW);
    const alphaPair = pick([L.alpha[0][0], L.alpha[1][0], L.alpha[2][0]]);
    const alphaRim = pick([L.alpha[0][1], L.alpha[1][1], L.alpha[2][1]]);
    const bellA = alphaPair.add(alphaRim.mul(rim)).add(margin.mul(0.14))
        .add(gonad.mul(0.32).mul(kMoon))
        .add(stripe.mul(0.14).mul(kNettle))
        .add(heart.mul(0.35).mul(kLantern));
    const glowCol = pick(L.glow);
    const bellGlow = glowCol.mul(
        rhopalia.mul(0.30).mul(kMoon)
            .add(lampBand.mul(lamps).mul(run.mul(1.1).add(0.15).add(flare2.mul(0.6))).mul(kLantern))
            .add(heart.mul(0.04).mul(kLantern)),
    ).add(bellCol.mul(rim).mul(through).mul(0.35));

    const sig = clamp(vData.w, 0, 1);
    const edge = smoothstep(0.35, 1.0, abs(clamp(vMore.x, -1, 1)));
    const tipFade = float(1).sub(smoothstep(0.86, 1.0, sig));
    const tentA = pick(L.strandAlpha).mul(clamp(vMore.y, 0, 1)).mul(float(1).sub(sig.mul(0.55))).mul(tipFade);
    const ruffle = sin(sig.mul(17).add(vMore.x.mul(1.5)).add(spin.mul(4))).mul(0.15).add(0.85);
    const armAlpha = pick(L.armAlpha).mul(edge.mul(0.55).add(0.45)).mul(ruffle).mul(tipFade);
    const twinkle = smoothstep(0.965, 1.0, sin(sig.mul(38).sub(uTime.mul(2.6)).add(vMore.w.mul(5))))
        .mul(0.55).mul(kLantern);

    const colour = bellCol.mul(fBell).add(pick(L.strand).mul(fTent)).add(pick(L.arm).mul(fArm));
    const alpha = clamp(bellA.mul(fBell).add(tentA.mul(fTent)).add(armAlpha.mul(fArm)), 0, 0.9);
    const glow = bellGlow.mul(fBell).add(glowCol.mul(twinkle).mul(fTent))
        .add(pick(L.strand).mul(through).mul(0.12).mul(fTent)
            .mul(clamp(vMore.y, 0, 1)));
    // A beat brightens the bell a touch as it squeezes (the tissue thickens).
    const lit = colour.mul(light).mul(through.mul(0.5).add(0.75))
        .mul(vMore.z.mul(0.15).add(1));

    // The water: the body hazed as the fish are, the light carried through it per channel.
    const dist = length(positionWorld.sub(cameraPosition));
    const carried = exp(dist.mul(vec3(-0.0160, -0.0082, -0.0046)));
    const seen = throughSurfaceNode(positionWorld, cameraPosition, seaLevel);
    const body = grade(haze(lit, positionWorld)).mul(alpha);
    const added = gradeLight(glow.mul(carried).mul(uLife));
    material.outputNode = vec4(body.add(added).mul(seen.tint).mul(seen.share), alpha.mul(seen.share));
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.blending = THREE.NormalBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // Behind the 1->2 steam while it is up; drawn before its shell (12), so it covers them.
    material.depthNode = behindSteamDepth(positionWorld);
    material.fog = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-jellyfish';
    mesh.frustumCulled = false;
    // After the sea (1), the visitors (1.5) and the fish (2); before the rays (3) and motes (4).
    mesh.renderOrder = 2.5;

    // ── the gate's CPU side: does any jelly in view still show through the surface? ──
    const at = { x: 0, y: 0, z: 0 };
    const eye = new THREE.Vector3();
    const frustum = new THREE.Frustum();
    const projView = new THREE.Matrix4();
    const sphere = new THREE.Sphere();
    const tops = jellies.map((j) => j.r * JELLY_KINDS[j.kind].height);
    /**
     * @param {THREE.Camera} camera
     * @param {number} time the world's clock
     */
    function seenFromAbove(camera, time) {
        if (!camera?.getWorldPosition) return false;
        camera.getWorldPosition(eye);
        if (!(eye.y > seaLevel)) return false;
        projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projView);
        return jellies.some((j, i) => {
            jellyAt(j, time, at);
            sphere.center.set(at.x, at.y - (jellyHang(j) * 0.5), at.z);
            sphere.radius = j.r + jellyHang(j);
            if (!frustum.intersectsSphere(sphere)) return false;
            at.y += tops[i];
            return throughSurfaceShare(eye, at, seaLevel) > ODYSSEY_THROUGH_SURFACE.floor;
        });
    }

    return {
        mesh,
        material,
        count: jellies.length,
        seenFromAbove,
        dispose() {
            material.dispose();
            geometry.dispose();
        },
    };
}
