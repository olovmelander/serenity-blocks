/**
 * Vesper Chrysalis — what stands in the water: the two stands of crystal and the reeds.
 *
 * The crystals are six-sided, pointed, a little out of true. They are cut like the chrysalis:
 * every face mirrors the sky, the afterglow comes through the edges that face it, and a cold
 * light of their own gathers at their feet. The silk is made fast to the tallest of each stand,
 * so whatever runs down the silk leaves from here: a lock lights the stand on its side from the
 * foot up.
 *
 * The reeds stand in the shallows at the bottom corners of the view, dark against the lake,
 * and stir in a breath of wind.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fwidth,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    reflect,
    refract,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SUN_DIR,
    THREAD_PULSES,
    mulberry32,
    vcBell,
    vcEvening,
    vcFresnel,
    vcGemLights,
    vcMax3,
    vcPart,
    vcLuma,
    vcSkyBase,
    vcSkyLight,
} from './vesper-chrysalis-tsl.js';
import { CHIME_CLIMB } from './vesper-chrysalis-glints.js';
import { flatVarying } from '../shared/flat-varying.js';

const SUN_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, 0, SUN_DIR[2] / l];
})();

/** Sides of a crystal. */
const SIDES = 6;

/**
 * Every crystal of the plan, cut and stood in the world, in one geometry. A crystal is a
 * six-sided prism a little out of true, its shoulders at six different heights, so the six faces
 * that close it on its point are six different facets. Attributes:
 *   aSpire  (the crystal's seed, its side −1 | +1, height up it 0..1, its radius)
 *   aAxis   the crystal's own axis in the world (flat)
 *   aFace   (place across the face 0..1, 0 = a side of the prism | 1 = a facet of the point)
 *   aLocal  (turn round the crystal 0..1, metres up it)
 *   aEdge   barycentric distance to the facet's edges (the diagonal of a side is not one)
 * Returns the geometry, with the points that can glint in geometry.userData.glints.
 * @param {object[]} spires  the plan (planSpires)
 */
export function buildSpiresGeometry(spires) {
    const pos = [];
    const spire = [];
    const axis = [];
    const face = [];
    const local = [];
    const edge = [];
    const glints = [];
    const rand = mulberry32(431);
    const put = (p, c, hN, A, w, kind, around, bary) => {
        pos.push(p[0], p[1], p[2]);
        spire.push(c.seed, c.side, hN, c.radius);
        axis.push(A[0], A[1], A[2]);
        face.push(w, kind);
        local.push(around, hN * c.height);
        edge.push(bary[0], bary[1], bary[2]);
    };
    spires.forEach((c) => {
        const len = Math.hypot(c.lean[0], 1, c.lean[1]);
        const A = [c.lean[0] / len, 1 / len, c.lean[1] / len];
        // Two directions across the crystal.
        const ux = [A[1], -A[0], 0];
        const ul = Math.hypot(ux[0], ux[1], ux[2]) || 1;
        const U = [ux[0] / ul, ux[1] / ul, ux[2] / ul];
        const W = [A[1] * U[2] - A[2] * U[1], A[2] * U[0] - A[0] * U[2], A[0] * U[1] - A[1] * U[0]];
        const turn = rand() * Math.PI;
        const tilt = rand() * Math.PI * 2;
        const drop = 0.05 + rand() * 0.07;
        const shoulderAt = c.shard ? 0.62 : 0.8;
        const at = (k, radius, up) => {
            const ang = turn + (k / SIDES) * Math.PI * 2;
            const cu = Math.cos(ang) * radius;
            const cw = Math.sin(ang) * radius;
            return [
                c.x + U[0] * cu + W[0] * cw + A[0] * up,
                U[1] * cu + W[1] * cw + A[1] * up,
                c.z + U[2] * cu + W[2] * cw + A[2] * up,
            ];
        };
        const foot = [];
        const shoulder = [];
        const sh = [];
        for (let k = 0; k < SIDES; k++) {
            // It runs a little below the water so the mirror meets it cleanly.
            foot.push(at(k, c.radius * 1.06, -0.04 * c.height - 0.3));
            // The shoulders stand at different heights: the point is cut askew, as quartz is.
            const h = shoulderAt + drop * Math.cos((k / SIDES) * Math.PI * 2 + tilt) + (rand() - 0.5) * 0.03;
            sh.push(h);
            shoulder.push(at(k, c.radius * 0.86, h * c.height));
        }
        // (The point is on the axis: the silk is made fast to it, see spireTip.)
        const tip = [c.x + A[0] * c.height, A[1] * c.height, c.z + A[2] * c.height];
        for (let k = 0; k < SIDES; k++) {
            const j = (k + 1) % SIDES;
            const a0 = k / SIDES;
            const a1 = (k + 1) / SIDES;
            // A side of the prism: two triangles; their shared diagonal is no edge of the crystal.
            put(foot[k], c, 0, A, 0, 0, a0, [2, 0, 0]);
            put(shoulder[k], c, sh[k], A, 0, 0, a0, [0, 1, 0]);
            put(foot[j], c, 0, A, 1, 0, a1, [0, 0, 1]);
            put(foot[j], c, 0, A, 1, 0, a1, [1, 0, 0]);
            put(shoulder[k], c, sh[k], A, 0, 0, a0, [0, 1, 0]);
            put(shoulder[j], c, sh[j], A, 1, 0, a1, [0, 0, 2]);
            // A facet of the point.
            put(shoulder[k], c, sh[k], A, 0, 1, a0, [1, 0, 0]);
            put(tip, c, 1, A, 0.5, 1, (a0 + a1) / 2, [0, 1, 0]);
            put(shoulder[j], c, sh[j], A, 1, 1, a1, [0, 0, 1]);
            // What can glint: the facets of the point, and (on the tall ones) a place on each side.
            const mid = [
                (shoulder[k][0] + shoulder[j][0] + tip[0]) / 3,
                (shoulder[k][1] + shoulder[j][1] + tip[1]) / 3,
                (shoulder[k][2] + shoulder[j][2] + tip[2]) / 3,
            ];
            const e1 = [tip[0] - shoulder[k][0], tip[1] - shoulder[k][1], tip[2] - shoulder[k][2]];
            const e2 = [shoulder[j][0] - shoulder[k][0], shoulder[j][1] - shoulder[k][1], shoulder[j][2] - shoulder[k][2]];
            let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            const out = [mid[0] - (c.x + A[0] * mid[1]), 0, mid[2] - (c.z + A[2] * mid[1])];
            if (n[0] * out[0] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
            const nl = Math.hypot(n[0], n[1], n[2]) || 1;
            if (!c.shard || k % 3 === 0) {
                glints.push({
                    at: mid, normal: [n[0] / nl, n[1] / nl, n[2] / nl], seed: rand(), side: c.side,
                });
            }
            if (!c.shard && k % 2 === 0) {
                const up = 0.25 + rand() * 0.4;
                const p = at(k + 0.5, c.radius * 0.9, up * c.height);
                const o = [p[0] - (c.x + A[0] * up * c.height), p[1] - A[1] * up * c.height, p[2] - (c.z + A[2] * up * c.height)];
                const ol = Math.hypot(o[0], o[1], o[2]) || 1;
                glints.push({
                    at: p, normal: [o[0] / ol, o[1] / ol, o[2] / ol], seed: rand(), side: c.side,
                });
            }
        }
        // The point itself: a star on it whenever any lamp is near (its normal looks at the eye).
        glints.push({
            at: tip, normal: [-c.x * 0.012, 0.25, 0.97], seed: rand(), side: c.side,
        });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aSpire', new THREE.Float32BufferAttribute(spire, 4));
    geometry.setAttribute('aAxis', new THREE.Float32BufferAttribute(axis, 3));
    geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 2));
    geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 2));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 3));
    geometry.computeVertexNormals();
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, -96), 120);
    glints.forEach((g) => {
        const l = Math.hypot(g.normal[0], g.normal[1], g.normal[2]) || 1;
        g.normal = [g.normal[0] / l, g.normal[1] / l, g.normal[2] / l];
    });
    geometry.userData.glints = glints;
    return geometry;
}

/**
 * @param {object} u
 * @param {object[]} spires  the plan (planSpires), already cut to the tier
 * @param {object} [opts]
 * @param {boolean} [opts.fire=true]  split what comes through the crystal into its colours
 */
export function createSpires(u, spires, opts = {}) {
    const fire = opts.fire !== false;
    const geometry = buildSpiresGeometry(spires);
    const n = spires.length;
    const mesh = new THREE.Mesh(geometry, null);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisSpires';
    material.fog = false;
    material.toneMapped = false;
    const vSpire = flatVarying(vec4(attribute('aSpire', 'vec4').xy, 0.0, attribute('aSpire', 'vec4').w), 'vSpire');
    const vHeight = varying(attribute('aSpire', 'vec4').z, 'vSpireH');
    const vAxis = flatVarying(attribute('aAxis', 'vec3'), 'vSpireAxis');
    const vFace = varying(attribute('aFace', 'vec2'), 'vSpireFace');
    const vLocal = varying(attribute('aLocal', 'vec2'), 'vSpireLocal');
    const vEdge = varying(attribute('aEdge', 'vec3'), 'vSpireEdge');
    material.fragmentNode = Fn(() => {
        const N = normalize(normalWorld).toVar();
        const V = normalize(cameraPosition.sub(positionWorld)).toVar();
        const ndv = clamp(dot(N, V), 0.0, 1.0).toVar();
        const h = clamp(vHeight, 0.0, 1.0).toVar();
        const A = normalize(vAxis).toVar();
        const seed = vSpire.x;
        const across = clamp(vFace.x, 0.0, 1.0).toVar();

        // ── The face: it mirrors the evening and flashes on its lamps ──
        const R = reflect(V.negate(), N).toVar();
        const mirrored = vcEvening(u, R).toVar();
        const lamps = vcGemLights(u, R).toVar();
        const fres = clamp(vcFresnel(ndv, 0.08).mul(1.3), 0.0, 1.0).toVar();

        // ── Through the crystal ──
        // The ray bends in at this face. In the middle of a face it leaves by the face opposite,
        // which is parallel: the sky behind shows straight through, only tinted. Toward a face's
        // side it leaves by the next face but one, a 60° prism: that light is thrown far aside
        // and split into its colours, which is the bright band down each edge of a crystal.
        const T = refract(V.negate(), N, 1 / 1.52).toVar();
        const sideways = across.sub(0.5).toVar();
        const band = smoothstep(0.17, 0.4, sideways.abs()).toVar();
        const turnBy = sideways.sign().mul(Math.PI * (2 / 3));
        const exitN = N.mul(cos(turnBy)).add(cross(A, N).mul(sin(turnBy))).add(A.mul(dot(A, N).mul(float(1.0).sub(cos(turnBy)))))
            .toVar();
        const leave = (index) => {
            const out = refract(T, exitN.negate(), index);
            // Past the critical angle the face is a mirror from inside.
            const kept = step(0.25, dot(out, out));
            return normalize(mix(reflect(T, exitN), out, kept).add(vec3(1e-4, 0.0, 0.0)));
        };
        const straight = vcEvening(u, V.negate()).toVar();
        const thrown = vec3(0.0).toVar();
        if (fire) {
            const dR = leave(1.47);
            const dG = leave(1.52);
            const dB = leave(1.57);
            thrown.assign(vec3(
                vcEvening(u, dR).add(vcGemLights(u, dR)).r,
                vcEvening(u, dG).add(vcGemLights(u, dG)).g,
                vcEvening(u, dB).add(vcGemLights(u, dB)).b,
            ));
        } else {
            const dG = leave(1.52);
            thrown.assign(vcEvening(u, dG).add(vcGemLights(u, dG)));
        }
        const stone = u.crystal.div(max(vcMax3(u.crystal), 1e-3)).toVar();
        const through = mix(straight.mul(mix(vec3(1.0), stone, 0.55)).mul(0.85), thrown.mul(mix(vec3(1.0), stone, 0.3)).mul(1.15), band)
            .toVar();

        // ── Inside: veils of inclusions run up the crystal, each stone its own; and here and
        // there a healed crack that holds a rainbow when the light finds it ──
        const grain = u.noise(vec2(vLocal.x.mul(2.3).add(seed.mul(7.0)).add(ndv.mul(0.12)), vLocal.y.mul(0.19).add(seed.mul(3.0))))
            .toVar();
        const veils = smoothstep(0.52, 0.85, grain.r).mul(0.7).add(grain.g.mul(0.3)).toVar();
        const flaw = smoothstep(0.66, 0.74, u.noise(vec2(vLocal.x.mul(1.1).add(seed.mul(11.0)), vLocal.y.mul(0.06).add(seed))).b);
        const phase = dot(V, cross(A, N)).mul(26.0).add(grain.a.mul(9.0)).add(seed.mul(40.0))
            .add(u.drift.mul(0.21));
        const caught = smoothstep(0.55, 0.98, sin(phase.mul(0.5)).mul(0.5).add(0.5));
        const rainbow = cos(vec3(0.0, 2.1, 4.2).add(phase)).mul(0.5).add(0.5).mul(flaw)
            .mul(caught)
            .mul(0.55);

        // ── A facet's edges: a hairline of light where two faces meet ──
        const toEdge = max(min(vEdge.x, min(vEdge.y, vEdge.z)), 0.0).toVar();
        const px = fwidth(toEdge).max(1e-5);
        const hairline = float(1.0).sub(smoothstep(px.mul(0.6), px.mul(1.8), toEdge));
        const rim = float(1.0).sub(ndv);
        const facing = clamp(dot(N, vec3(SUN_FLAT[0], 0.0, SUN_FLAT[2])), 0.0, 1.0);
        const afterglow = u.glow.mul(facing).mul(rim).mul(0.4);
        const body = u.crystal.mul(vcSkyLight(u, N)).mul(veils.mul(0.3).add(0.1));
        // A cold light of its own, gathered at the foot and breathing.
        const breathe = sin(u.drift.mul(0.5).add(seed.mul(40.0))).mul(0.25).add(0.75);
        const own = u.crystal.mul(exp(h.mul(-3.2)).mul(0.8).add(rim.mul(rim).mul(0.22))).mul(breathe)
            .mul(u.power.mul(0.9).add(0.5));
        // What runs down the silk leaves from here: the stand on that side lights from the foot up.
        const run = vec3(0.0).toVar();
        for (let i = 0; i < THREAD_PULSES; i++) {
            const P = u.pulseA[i];
            const age = u.time.sub(P.x);
            const mine = float(1.0).sub(step(0.5, abs(P.y.sub(vSpire.y)).mul(abs(P.y))));
            const front = age.mul(2.6);
            const lit = vcBell(h.sub(front).div(0.3)).add(exp(age.mul(-3.0)).mul(0.25)).mul(step(0.0, age))
                .mul(exp(age.mul(-1.6)));
            run.addAssign(u.pulseC[i].mul(lit.mul(mine).mul(P.z)));
        }
        // A chime climbs it from the waterline.
        const chimeAge = u.time.sub(u.chime.x).sub(positionWorld.y.mul(CHIME_CLIMB / 100));
        const chime = u.chimeTint.mul(vcBell(chimeAge.sub(0.12).div(0.3)).add(exp(max(chimeAge, 0.0).mul(-2.4)).mul(0.3).mul(step(0.0, chimeAge))))
            .mul(u.chime.y);
        const light = own.add(run.mul(u.pulsesLive).mul(rim.mul(0.7).add(0.5)).mul(1.6)).add(chime.mul(veils.mul(0.6).add(0.5)))
            .mul(u.breath);
        const catching = clamp(vcLuma(mirrored).mul(6.0).add(facing.mul(0.5)), 0.0, 1.0);
        const glint = hairline.mul(catching.mul(0.7).add(0.3)).mul(mirrored.mul(1.1).add(u.glow.mul(0.3)).add(u.crystal.mul(0.05)))
            .mul(u.breath.mul(0.5).add(0.5));
        const col = mirrored.add(lamps).mul(fres)
            .add(through.add(rainbow).mul(float(1.0).sub(fres)))
            .add(body)
            .add(afterglow)
            .add(light)
            .add(glint);
        return vec4(col, 1.0);
    })();
    mesh.material = material;
    mesh.frustumCulled = false;
    const part = vcPart('VesperChrysalisSpires', geometry, material, 12, { mesh });
    part.count = n;
    part.glints = geometry.userData.glints;
    return part;
}

/**
 * Reeds in the shallows at the bottom corners of the view: long leaves that bow over, and
 * reed-mace standing among them, each stem with its dark head. They are dark against the lake;
 * the side of the set sun lines them with its last light, and they stir in a breath of wind (a
 * gust that crosses the lake bends them as it passes).
 * @param {object} u
 * @param {number} count
 */
export function createReeds(u, count) {
    const seg = 7;
    const pos = [];
    const index = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        pos.push(-0.5, t, 0, 0.5, t, 0);
        if (i < seg) {
            const b = i * 2;
            index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    const n = Math.max(1, count);
    const rand = mulberry32(977);
    const base = new Float32Array(n * 4); // (x, z, height, seed)
    const kind = new Float32Array(n * 2); // (0 leaf | 1 reed-mace, how far it bows)
    for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        // Clumps hard against the bottom corners.
        const clump = Math.floor(rand() * 3);
        const cx = side * (4.6 + clump * 2.2 + rand() * 1.8);
        const cz = -(6.0 + clump * 2.4 + rand() * 2.6);
        const mace = rand() < 0.22;
        base.set([cx + (rand() - 0.5) * 1.6, cz + (rand() - 0.5) * 1.6, mace ? 2.3 + rand() * 1.1 : 1.2 + rand() * 1.9, rand()], i * 4);
        kind.set([mace ? 1 : 0, mace ? 0.12 : 0.35 + rand() * 0.75], i * 2);
    }
    geometry.setAttribute('aReed', new THREE.InstancedBufferAttribute(base, 4));
    geometry.setAttribute('aReedKind', new THREE.InstancedBufferAttribute(kind, 2));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = count > 0 ? n : 0;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisReeds';
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    const aReed = attribute('aReed', 'vec4');
    const aKind = attribute('aReedKind', 'vec2');
    const vAt = varying(vec2(positionGeometry.x, positionGeometry.y), 'vReedAt');
    const vKind = flatVarying(vec2(aKind.x, aReed.w), 'vReedKind');
    material.positionNode = Fn(() => {
        const t = positionGeometry.y;
        // A breath of wind; a gust bends them over as it passes.
        const gustBehind = u.time.sub(u.gust.z).mul(24.0).sub(aReed.x.mul(u.gust.x).add(aReed.y.mul(u.gust.y)).add(230.0));
        const gust = smoothstep(0.0, 10.0, gustBehind).mul(exp(max(gustBehind, 0.0).mul(-0.026))).mul(u.gust.w);
        const sway = sin(u.drift.mul(0.9).add(aReed.w.mul(30.0)).add(aReed.x.mul(0.6))).mul(0.16)
            .add(sin(u.drift.mul(2.1).add(aReed.w.mul(70.0))).mul(0.04))
            .add(gust.mul(u.gust.x).mul(0.5));
        const bend = t.mul(t).mul(aReed.z);
        const lean = aReed.w.sub(0.5).mul(aKind.y).mul(2.0);
        // A leaf tapers to a point and bows over; a reed-mace is a thin stem with a thick head near its top.
        const leaf = float(1.0).sub(t).pow(0.7).mul(0.085);
        const head = smoothstep(0.66, 0.7, t).mul(float(1.0).sub(smoothstep(0.9, 0.93, t))).mul(0.085).add(0.02)
            .mul(float(1.0).sub(smoothstep(0.93, 1.0, t).mul(0.7)));
        const wide = mix(leaf, head, aKind.x);
        // A bowed leaf's tip hangs: the bend takes height off it.
        const droop = bend.mul(lean.abs()).mul(t).mul(0.5);
        return positionLocal.mul(vec3(0.0, 0.0, 1.0)).add(vec3(
            aReed.x.add(positionGeometry.x.mul(wide)).add(bend.mul(sway.add(lean))),
            t.mul(aReed.z).sub(droop),
            aReed.y.add(bend.mul(sway).mul(0.4)),
        ));
    })();
    material.fragmentNode = Fn(() => {
        const t = clamp(vAt.y, 0.0, 1.0);
        const across = vAt.x.mul(2.0);
        const mace = vKind.x;
        // Dark blades; their upper halves catch a little of the sky, and the edge that faces the
        // set sun is lined with what is left of it.
        const sky = vcSkyBase(u, normalize(vec3(0.3, 0.5, -0.8)));
        const blade = mix(u.range.mul(0.5), u.range.add(sky.mul(0.1)), smoothstep(0.2, 1.0, t));
        const lined = smoothstep(0.35, 1.0, across).mul(smoothstep(0.1, 0.6, t)).mul(0.3);
        const rib = vcBell(across.div(0.25)).mul(0.04);
        const leafCol = blade.add(u.glow.mul(lined)).add(sky.mul(rib));
        // The head: a dark velvet that holds a warm edge.
        const onHead = smoothstep(0.66, 0.7, t).mul(float(1.0).sub(smoothstep(0.9, 0.93, t)));
        const velvet = vec3(0.06, 0.035, 0.03).mul(sky.mul(1.5).add(0.3)).add(u.glow.mul(smoothstep(0.2, 1.0, across)).mul(0.22));
        const maceCol = mix(leafCol, velvet, onHead);
        return vec4(mix(leafCol, maceCol, mace), 1.0);
    })();
    mesh.material = material;
    mesh.frustumCulled = false;
    const part = vcPart('VesperChrysalisReeds', geometry, material, 14, { mesh });
    part.count = mesh.count;
    return part;
}
