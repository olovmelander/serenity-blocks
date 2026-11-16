/**
 * Vesper Chrysalis — the chrysalis, its halo and the silk it hangs by.
 *
 * The chrysalis is a jewel: a teardrop cut in triangular facets, hung by its wide end from a short
 * horn, with a diadem of gold beads round its shoulder. Each facet does what a facet of cut stone
 * does. It mirrors the evening (the sky, the lake's lanterns from below, and a flash when it
 * turns one of the evening's lamps to the eye). It lets the eye in: the ray is bent at the facet,
 * crosses the stone, and is thrown back by the cut of the far side, so every facet holds its own
 * piece of the sky, split a little into its colours. And it shows what is inside: a light that
 * beats like a heart and the folded wings of what the chain will hatch, seen through each facet
 * from that facet's own angle, so the thing inside is broken into panes that slide against each
 * other as the stone turns.
 *
 * It is never still: it hangs by silk, so it swings a little and turns slowly on its thread; what
 * is inside stirs, and now and then twitches. A chain of clears cracks it along its facets from
 * the shoulder down and lights the beads of the diadem one by one.
 *
 * The geometry is built about the point it hangs from (the top of the stalk, the origin): the
 * world turns and places it each frame (setPose), and the shader reads the same pose to look
 * into the stone in the stone's own frame.
 *
 * It hangs from threads of silk: a fan of them rising out of the frame and four long ones made
 * fast to the crystal stands at the edges of the view. They are hairlines (their width is set
 * in pixels), strung with dew that catches the afterglow, and every lock sends a bead of the
 * piece's colour running down them to the chrysalis.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    refract,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHRYSALIS,
    HEART,
    HEART_DROP,
    STALK,
    SUN_DIR,
    THREAD_PULSES,
    TAU,
    chrysalisProfile,
    mulberry32,
    vcBell,
    vcEvening,
    vcFresnel,
    vcGemLights,
    vcHash11,
    vcMax3,
    vcPart,
    vcSkyLight,
} from './vesper-chrysalis-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

export { STALK };

/** Seconds a bead of light takes to run the length of a thread. */
export const PULSE_TRAVEL = 0.75;

const SUN_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, 0, SUN_DIR[2] / l];
})();

const L = CHRYSALIS.length;
const R = CHRYSALIS.radius;
/** Facets round the stone, and the heights of its girdles (0 = foot, 1 = the top of the stalk). */
const AROUND = 8;
const GIRDLES = Object.freeze([
    // [height, how far the girdle stands out of the profile]
    [0.07, 1], [0.17, 1], [0.29, 1], [0.42, 1], [0.545, 1], [0.64, 1],
    // The shoulder ridge, then the cap's segments: each a step in from the last.
    [CHRYSALIS.shoulder, 1.05], [0.75, 0.985], [0.8, 1.035], [0.85, 0.975], [0.893, 1.02],
    [CHRYSALIS.neck, 1],
    // The stalk.
    [0.957, 1], [1, 1],
]);
/** How much the stone is flattened front to back. */
const FLAT = 0.86;
/** The gold spots low on the front of it (a turn round the stone, a height). */
const SPOTS = Object.freeze([[0.19, 0.3], [0.31, 0.3], [0.25, 0.21], [0.13, 0.36], [0.37, 0.36]]);
/** The stone as the shader sees it from inside: an ellipsoid about its middle. */
const HULL_AT = Object.freeze([0, -L * 0.55, 0]);
const HULL = Object.freeze([R * 0.97, L * 0.47, R * 0.97 * FLAT]);

/** A point of the stone's skin in its own frame: `turn` round it (0..1), `t` up it (0..1). */
export function chrysalisPoint(turn, t, out = [0, 0, 0], lift = 1) {
    const ang = turn * TAU;
    // The wing cases: two long swellings down the front that meet at the foot.
    const front = Math.cos(ang - Math.PI / 2);
    const cases = Math.max(0, front) ** 2 * Math.abs(Math.sin(ang - Math.PI / 2)) ** 0.6
        * Math.max(0, 1 - Math.abs(t - 0.36) / 0.34) * 0.2;
    const r = chrysalisProfile(t) * (1 + cases) * lift;
    out[0] = Math.cos(ang) * r;
    out[1] = (t - 1) * L;
    out[2] = Math.sin(ang) * r * FLAT;
    return out;
}

/**
 * The chrysalis as cut stone, about the point it hangs from. Every triangle is a facet (flat
 * normals), wound outward. Attributes: `uv` = (turn round it, height), `aGem` = (the facet's own
 * number 0..1, part 0 stone | 1 gold bead | 2 stalk, the bead's index, the facet's height),
 * `aEdge` = barycentric distance to the facet's edges. Returns the geometry and the facets
 * (centre and normal, in the stone's frame) for whatever wants to glint on them.
 */
export function buildChrysalisGeometry(seed = 5519) {
    const rand = mulberry32(seed);
    const pos = [];
    const uvs = [];
    const gem = [];
    const edge = [];
    const facets = [];
    const a = [0, 0, 0];
    /** One facet. `axisY` = the height its outward side is measured from. */
    const facet = (p0, p1, p2, uv0, uv1, uv2, part, index, centreOf = null) => {
        const cx = (p0[0] + p1[0] + p2[0]) / 3;
        const cy = (p0[1] + p1[1] + p2[1]) / 3;
        const cz = (p0[2] + p1[2] + p2[2]) / 3;
        const ux = p1[0] - p0[0];
        const uy = p1[1] - p0[1];
        const uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0];
        const vy = p2[1] - p0[1];
        const vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (!(len > 1e-9)) return;
        nx /= len;
        ny /= len;
        nz /= len;
        // Outward: away from the stone's axis (or from the bead's own centre).
        const ox = centreOf ? cx - centreOf[0] : cx;
        const oy = centreOf ? cy - centreOf[1] : (cy - HULL_AT[1]) * 0.12;
        const oz = centreOf ? cz - centreOf[2] : cz;
        const outward = nx * ox + ny * oy + nz * oz >= 0;
        const tri = outward ? [p0, p1, p2] : [p0, p2, p1];
        const tuv = outward ? [uv0, uv1, uv2] : [uv0, uv2, uv1];
        const id = rand();
        const height = cy / L + 1;
        for (let k = 0; k < 3; k++) {
            pos.push(tri[k][0], tri[k][1], tri[k][2]);
            uvs.push(tuv[k][0], tuv[k][1]);
            gem.push(id, part, index, height);
            edge.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
        }
        if (part === 0) {
            facets.push({
                at: [cx, cy, cz],
                normal: outward ? [nx, ny, nz] : [-nx, -ny, -nz],
                area: len / 2,
                seed: id,
            });
        }
    };

    // ── The stone and its stalk: girdles of points, every other one turned half a facet ──
    const rings = GIRDLES.map(([t, lift], j) => Array.from({ length: AROUND }, (_, i) => {
        const turn = (i + (j % 2) * 0.5) / AROUND;
        return { p: chrysalisPoint(turn, t, [0, 0, 0], lift), uv: [turn, t] };
    }));
    const foot = { p: [0, -L, 0], uv: [0, 0] };
    const top = { p: [0, 0, 0], uv: [0, 1] };
    for (let i = 0; i < AROUND; i++) {
        const i1 = (i + 1) % AROUND;
        facet(foot.p, rings[0][i].p, rings[0][i1].p, foot.uv, rings[0][i].uv, rings[0][i1].uv, 0, 0);
        const last = rings[rings.length - 1];
        facet(top.p, last[i].p, last[i1].p, top.uv, last[i].uv, last[i1].uv, 2, 0);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const lower = rings[j];
        const upper = rings[j + 1];
        const part = GIRDLES[j][0] >= CHRYSALIS.neck ? 2 : 0;
        for (let i = 0; i < AROUND; i++) {
            const i1 = (i + 1) % AROUND;
            if (j % 2 === 0) {
                // Lower points at i, upper at i + ½: one facet stands on the lower girdle…
                facet(lower[i].p, lower[i1].p, upper[i].p, lower[i].uv, lower[i1].uv, upper[i].uv, part, 0);
                // …and one hangs from the upper.
                facet(upper[i].p, lower[i1].p, upper[i1].p, upper[i].uv, lower[i1].uv, upper[i1].uv, part, 0);
            } else {
                facet(upper[i].p, lower[i].p, upper[i1].p, upper[i].uv, lower[i].uv, upper[i1].uv, part, 0);
                facet(lower[i].p, lower[i1].p, upper[i1].p, lower[i].uv, lower[i1].uv, upper[i1].uv, part, 0);
            }
        }
    }

    // ── The gold: the diadem's beads on the shoulder ridge, and the spots low on the front ──
    const bead = (turn, t, size, index) => {
        chrysalisPoint(turn, t, a, 1.03);
        const ang = turn * TAU;
        const out = [Math.cos(ang), 0, Math.sin(ang)];
        const along = [-Math.sin(ang), 0, Math.cos(ang)];
        const tips = [
            [a[0] + out[0] * size, a[1], a[2] + out[2] * size],
            [a[0] - out[0] * size * 0.4, a[1], a[2] - out[2] * size * 0.4],
            [a[0] + along[0] * size * 0.8, a[1], a[2] + along[2] * size * 0.8],
            [a[0] - along[0] * size * 0.8, a[1], a[2] - along[2] * size * 0.8],
            [a[0], a[1] + size * 1.1, a[2]],
            [a[0], a[1] - size * 1.1, a[2]],
        ];
        const centre = [a[0], a[1], a[2]];
        const st = [turn, t];
        [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]].forEach((f) => {
            facet(tips[f[0]], tips[f[1]], tips[f[2]], st, st, st, 1, index, centre);
        });
    };
    for (let i = 0; i < CHRYSALIS.diadem; i++) {
        bead((i + 0.5) / CHRYSALIS.diadem, CHRYSALIS.shoulder, R * 0.085, i);
    }
    SPOTS.forEach(([turn, t], i) => bead(turn, t, R * 0.06, CHRYSALIS.diadem + i));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aGem', new THREE.Float32BufferAttribute(gem, 4));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 3));
    geometry.computeVertexNormals();
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -L / 2, 0), L);
    geometry.userData.facets = facets;
    return geometry;
}

/**
 * @param {object} u  shared uniforms
 */
export function createChrysalis(u) {
    const geometry = buildChrysalisGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisShell';
    material.fog = false;
    material.toneMapped = false;

    const aGem = attribute('aGem', 'vec4');
    const vGem = flatVarying(aGem, 'vGem');
    const vLocal = varying(positionGeometry, 'vGemLocal');
    const vEdge = varying(attribute('aEdge', 'vec3'), 'vGemEdge');

    /** A world direction in the stone's frame, and back. */
    const toLocal = (d) => vec3(dot(d, u.relicX), dot(d, u.relicY), dot(d, u.relicZ));
    const toWorld = (d) => u.relicX.mul(d.x).add(u.relicY.mul(d.y)).add(u.relicZ.mul(d.z));
    const evening = (d) => vcEvening(u, d);

    material.fragmentNode = Fn(() => {
        const Nw = normalize(normalWorld).toVar();
        const Vw = normalize(cameraPosition.sub(positionWorld)).toVar();
        const ndv = clamp(dot(Nw, Vw), 0.0, 1.0).toVar();
        const P = vec3(vLocal).toVar();
        const part = vGem.y;
        const id = vGem.x;
        const isStone = float(1.0).sub(step(0.5, part)).toVar();
        const isStalk = step(1.5, part).toVar();
        const tAt = clamp(vGem.w, 0.0, 1.0).toVar();

        // ── The facet's face: it mirrors the evening and flashes on its lamps ──
        const Rw = reflect(Vw.negate(), Nw).toVar();
        const mirrored = evening(Rw).toVar();
        const lamps = vcGemLights(u, Rw).toVar();
        const fres = clamp(vcFresnel(ndv, 0.1).mul(1.25), 0.0, 1.0).toVar();
        // A thin film on the stone: the mirrored sky shifts hue from facet to facet.
        const film = cos(vec3(0.0, 2.1, 4.2).add(ndv.mul(7.0)).add(id.mul(TAU))).mul(0.5).add(0.5);
        const face = mirrored.mul(mix(vec3(1.0), film.mul(1.5), 0.32)).add(lamps).mul(fres).toVar();

        // ── Into the stone: the ray bends at the facet, crosses, and the far cut throws it back ──
        const Nl = toLocal(Nw).toVar();
        const Vl = toLocal(Vw).toVar();
        const Tl = refract(Vl.negate(), Nl, 1 / 1.5).toVar();
        const hullAt = vec3(HULL_AT[0], HULL_AT[1], HULL_AT[2]);
        const hull = vec3(HULL[0], HULL[1], HULL[2]);
        const pp = P.sub(hullAt).div(hull).toVar();
        const dd = Tl.div(hull).toVar();
        const qa = max(dot(dd, dd), 1e-5).toVar();
        const qb = dot(pp, dd).toVar();
        const qc = dot(pp, pp).sub(1.0);
        const across = max(sqrt(max(qb.mul(qb).sub(qa.mul(qc)), 0.0)).sub(qb).div(qa), 0.0).toVar();
        const Q = P.add(Tl.mul(across)).toVar();
        const far = normalize(Q.sub(hullAt).div(hull.mul(hull))).toVar();
        // The far side is cut too: its normal comes in steps, each step a facet.
        const cell = floor(far.mul(2.6).add(vec3(0.63, 0.81, 0.57))).toVar();
        const cut = normalize(cell).toVar();
        // No two cuts send back the same share: some stand dark, some blaze (a stone's contrast).
        const share = fract(dot(cell, vec3(0.37, 0.61, 0.83)).add(id.mul(0.31))).toVar();
        const blaze = mix(float(0.3), float(1.75), share.mul(share));
        const D2 = reflect(Tl, cut).toVar();
        const D2w = toWorld(D2).toVar();
        const cut2 = normalize(floor(D2.mul(3.3).add(vec3(0.91, 0.67, 0.79)))).toVar();
        const D3w = toWorld(reflect(D2, cut2)).toVar();
        // The lamps come back split into their colours: red bends least, blue most.
        const spread = normalize(cross(D2w, vec3(0.31, 0.9, 0.3)).add(vec3(1e-4, 0.0, 0.0))).mul(0.085).toVar();
        const fire = vec3(
            vcGemLights(u, normalize(D2w.sub(spread))).r,
            vcGemLights(u, D2w).g,
            vcGemLights(u, normalize(D2w.add(spread))).b,
        ).add(vcGemLights(u, D3w).mul(0.5));
        // The stone's own colour deepens with the way through it.
        const thick = clamp(across.div(R * 2), 0.0, 1.4).toVar();
        const stone = u.shell.div(max(vcMax3(u.shell), 1e-3)).toVar();
        const dye = mix(vec3(1.0), stone, clamp(thick.mul(0.8).add(0.12), 0.0, 1.0));
        const brilliance = evening(D2w).mul(0.9).add(evening(D3w).mul(0.35)).add(fire)
            .mul(dye)
            .mul(blaze)
            .toVar();

        // ── What is inside: seen where this facet's ray passes nearest the heart ──
        const heartAt = vec3(0.0, -HEART_DROP, 0.0);
        const nearest = clamp(dot(heartAt.sub(P), Tl), 0.0, across);
        const M = P.add(Tl.mul(nearest)).toVar();
        const rel = M.sub(heartAt).toVar();
        const dH = length(rel.mul(vec3(1.0, 0.55, 1.0))).div(R * 0.62);
        const heart = exp(dH.mul(dH).mul(-1.7)).toVar();
        // A heartbeat: two beats and a rest.
        const lub = exp(u.beat.x.mul(-7.0));
        const dub = exp(fract(u.beat.x.add(0.78)).mul(-9.0)).mul(0.6);
        const pulse = clamp(lub.add(dub), 0.0, 1.0).mul(0.5).add(0.5).toVar();
        // The folded wings, on the plane through the axis that faces this ray.
        const sideways = normalize(vec3(Tl.z, 0.0, Tl.x.negate()).add(vec3(1e-4, 0.0, 0.0)));
        const stir = u.beat.y;
        const fy = M.y.div(L).add(1.0).toVar();
        const fx = dot(rel, sideways).div(R)
            .add(sin(u.time.mul(0.9).add(fy.mul(7.0))).mul(stir.mul(0.035).add(0.012)))
            .toVar();
        const side = fx.abs().toVar();
        const span = smoothstep(0.72, 0.6, fy).mul(smoothstep(0.05, 0.2, fy));
        const breathe = sin(u.time.mul(0.55)).mul(stir.mul(0.07).add(0.03)).add(1.0);
        const width = clamp(float(0.72).sub(fy).mul(0.95), 0.0, 0.6).add(0.05).mul(breathe);
        const scallop = sin(fy.mul(46.0)).mul(0.03);
        const inWing = float(1.0).sub(smoothstep(width.sub(0.05), width.add(0.05), side.add(scallop))).mul(span)
            .mul(smoothstep(0.0, 0.05, side))
            .toVar();
        // Veins radiate from the root under the shoulder, light running out along them; an eye low on each.
        const veinAngle = atan(side, float(0.72).sub(fy)).toVar();
        const veins = vcBell(fract(veinAngle.mul(6.5)).sub(0.5).div(0.1));
        const flow = sin(fy.mul(11.0).add(u.time.mul(1.3)).add(floor(veinAngle.mul(6.5)).mul(1.9))).mul(0.4).add(0.6);
        const eyeD = length(vec2(side.sub(0.34), fy.sub(0.3)).mul(vec2(1.0, 1.4)));
        const eye = vcBell(eyeD.sub(0.075).div(0.028)).mul(0.7).add(vcBell(eyeD.div(0.035)).mul(0.5));
        const folded = mix(u.wingMid.mul(0.45), u.wingEdge, clamp(veins.mul(flow).mul(0.75).add(eye.mul(0.6)), 0.0, 1.0))
            .mul(inWing);
        // Its body: a spindle on the axis, segmented.
        const spindle = vcBell(side.div(0.085)).mul(smoothstep(0.1, 0.24, fy)).mul(smoothstep(0.78, 0.6, fy))
            .mul(sin(fy.mul(64.0)).mul(0.2).add(0.8));
        const fedTint = mix(u.core, u.fed.rgb, u.fed.w.mul(0.75)).toVar();
        const awake = u.wake.add(u.beat.z.mul(0.5)).toVar();
        const inner = fedTint.mul(heart).mul(awake.mul(2.3).add(0.25)).mul(pulse)
            .add(folded.mul(awake.mul(1.7).add(u.power.mul(0.9)).add(0.2)).mul(pulse.mul(0.5).add(0.5)))
            .add(mix(fedTint, vec3(1.0, 0.95, 0.85), 0.4).mul(spindle).mul(awake.mul(1.5).add(0.15)).mul(pulse))
            .toVar();

        // ── The facet's edges: hairlines of light, and the cracks a chain opens along them ──
        const toEdge = max(min(vEdge.x, min(vEdge.y, vEdge.z)), 0.0).toVar();
        const px = fwidth(toEdge).max(1e-5);
        const hairline = float(1.0).sub(smoothstep(px.mul(0.5), px.mul(1.7), toEdge)).toVar();
        const edges = mirrored.mul(0.8).add(u.glow.mul(0.22)).add(lamps.mul(0.6)).mul(hairline)
            .mul(0.5);
        // The cracks open at the shoulder and run down (and up) as the chain grows, facet by facet.
        const order = abs(tAt.sub(CHRYSALIS.shoulder)).mul(1.15).add(id.mul(0.22));
        const cracked = float(1.0).sub(smoothstep(u.crack.mul(0.95), u.crack.mul(0.95).add(0.1), order))
            .mul(step(0.01, u.crack)).toVar();
        const molten = mix(u.core, vec3(1.0, 0.92, 0.75), 0.4)
            .mul(exp(toEdge.mul(-20.0)).mul(cracked))
            .mul(pulse.mul(0.6).add(0.7))
            .mul(u.power.mul(1.5).add(1.3));

        // The last light comes through the edge that faces where the sun set.
        const rim = float(1.0).sub(ndv);
        const facing = clamp(dot(Nw, vec3(SUN_FLAT[0], 0.0, SUN_FLAT[2])), 0.0, 1.0);
        const through = u.glow.mul(facing).mul(rim.mul(rim)).mul(0.45);
        const body = u.shell.mul(vcSkyLight(u, Nw).mul(0.5).add(0.012));

        // However hard it burns it keeps its colour: the light rolls off, it never clips to white.
        const raw = inner.mul(cracked.mul(0.6).add(1.0)).add(molten).toVar();
        const light = raw.div(vcMax3(raw).mul(0.3).add(1.0)).mul(u.breath);
        const gemCol = face.add(brilliance.add(light).mul(float(1.0).sub(fres))).add(body).add(through).add(edges);

        // ── The gold: the diadem's beads light one for every step of the chain ──
        const bead = vGem.z;
        const onDiadem = step(bead, CHRYSALIS.diadem - 0.5);
        const litBead = mix(u.fed.w.mul(0.6).add(awake.mul(0.5)).add(0.2), step(bead.add(0.5), u.combo).mul(0.94).add(0.06), onDiadem);
        const twinkle = sin(u.time.mul(2.3).add(bead.mul(1.7))).mul(0.2).add(0.8);
        const goldCol = vec3(0.95, 0.63, 0.2).mul(vcSkyLight(u, Nw).mul(2.2).add(mirrored.mul(fres).mul(2.0)).add(0.06))
            .add(lamps.mul(vec3(1.0, 0.8, 0.45)))
            .add(vec3(1.0, 0.78, 0.36).mul(litBead.mul(twinkle).mul(4.6).add(0.1)).mul(u.breath));
        // ── The stalk: dark horn, with a rim of the sky ──
        const hornCol = vec3(0.018, 0.012, 0.02).add(mirrored.mul(fres).mul(0.5)).add(edges.mul(0.3));

        const isBead = float(1.0).sub(isStone).sub(isStalk);
        return vec4(gemCol.mul(isStone).add(goldCol.mul(isBead)).add(hornCol.mul(isStalk)), 1.0);
    })();

    const shell = new THREE.Mesh(geometry, material);
    shell.name = 'VesperChrysalisShellMesh';
    shell.frustumCulled = false;
    shell.renderOrder = 10;
    shell.matrixAutoUpdate = false;
    shell.position.set(STALK[0], STALK[1], STALK[2]);
    shell.updateMatrix();

    // ── The halo: the light it stands in ──
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicNodeMaterial();
    haloMat.name = 'VesperChrysalisHalo';
    haloMat.transparent = true;
    haloMat.blending = THREE.AdditiveBlending;
    haloMat.premultipliedAlpha = true;
    haloMat.depthWrite = false;
    haloMat.fog = false;
    haloMat.toneMapped = false;
    haloMat.side = THREE.DoubleSide;
    const haloLight = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d = length(q);
        const ang = atan(q.y, q.x);
        // Faint spokes that turn slowly, as light does through a crack.
        const spokes = u.noise(vec2(ang.div(TAU).mul(3.0).add(u.drift.mul(0.004)), d.mul(0.15).add(0.5))).r;
        const soft = exp(d.mul(-5.0)).mul(0.32).add(exp(d.mul(-13.0)).mul(0.8));
        const rays = exp(d.mul(-2.4)).mul(smoothstep(0.42, 0.8, spokes)).mul(u.power.mul(0.9).add(u.surge).add(0.12));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const tint = mix(u.core, u.fed.rgb, u.fed.w.mul(0.7));
        const lub = exp(u.beat.x.mul(-7.0));
        const dub = exp(fract(u.beat.x.add(0.78)).mul(-9.0)).mul(0.6);
        const beat = clamp(lub.add(dub), 0.0, 1.0);
        return tint.mul(soft.add(rays.mul(0.6))).mul(fade)
            .mul(u.wake.mul(1.5).add(u.fed.w.mul(0.5)).add(u.beat.z.mul(0.4)).add(0.03))
            .mul(beat.mul(0.3).add(0.85))
            .mul(u.breath);
    });
    haloMat.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    haloMat.outputNode = vec4(haloLight(), 0.0);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.name = 'VesperChrysalisHaloMesh';
    halo.position.set(HEART[0], HEART[1], HEART[2] - 2.5);
    halo.scale.set(64, 64, 1);
    halo.frustumCulled = false;
    halo.renderOrder = 60;

    const group = new THREE.Group();
    group.add(shell, halo);
    const part = vcPart('VesperChrysalisRelic', geometry, material, 10, { mesh: group });
    part.shell = shell;
    part.halo = halo;
    part.facets = geometry.userData.facets;
    const one = new THREE.Vector3(1, 1, 1);
    const hang = new THREE.Vector3();
    /**
     * Hang the chrysalis from `at` (a world point), turned by `quaternion`; its light is at `heart`.
     * @param {number[]} at
     * @param {THREE.Quaternion} quaternion
     * @param {number[]} heart
     */
    part.setPose = (at, quaternion, heart) => {
        hang.set(at[0], at[1], at[2]);
        shell.matrix.compose(hang, quaternion, one);
        shell.matrixWorldNeedsUpdate = true;
        halo.position.set(heart[0], heart[1], heart[2] - 2.5);
    };
    part.dispose = () => {
        haloGeo.dispose();
        haloMat.dispose();
    };
    return part;
}

/**
 * The threads' plan: the fan that rises out of the frame, then the long ones to the stands.
 * @param {number} count          threads in all
 * @param {number[][]} anchors    where the long ones are made fast: [x, y, z, side]
 * @returns {{ a: number[], b: number[], sag: number, side: number, long: boolean, seed: number }[]}
 */
export function planThreads(count, anchors, seed = 811) {
    const rand = mulberry32(seed);
    const out = [];
    anchors.forEach((p) => {
        out.push({
            a: [...STALK], b: [p[0], p[1], p[2]], sag: 5.5 + rand() * 2.5, side: p[3], long: true, seed: rand(),
        });
    });
    const fan = Math.max(0, count - anchors.length);
    for (let i = 0; i < fan; i++) {
        const f = fan > 1 ? i / (fan - 1) : 0.5;
        const lean = (f - 0.5) * 2;
        out.push({
            a: [...STALK],
            b: [
                STALK[0] + lean * 46 + (rand() - 0.5) * 6,
                STALK[1] + 62 + rand() * 16,
                STALK[2] - 6 + (rand() - 0.5) * 22,
            ],
            sag: 0.6 + rand() * 1.4,
            side: Math.sign(lean) || 1,
            long: false,
            seed: rand(),
        });
    }
    return out;
}

/** A point of a thread at fraction `s` (0 = at the chrysalis, 1 = where it is made fast). */
export function threadPoint(thread, s, out = [0, 0, 0]) {
    const droop = thread.sag * 4 * s * (1 - s);
    out[0] = thread.a[0] + (thread.b[0] - thread.a[0]) * s;
    out[1] = thread.a[1] + (thread.b[1] - thread.a[1]) * s - droop;
    out[2] = thread.a[2] + (thread.b[2] - thread.a[2]) * s;
    return out;
}

/**
 * @param {object} u
 * @param {ReturnType<typeof planThreads>} threads
 */
export function createThreads(u, threads) {
    const seg = 28;
    const perThread = (seg + 1) * 2;
    const n = threads.length;
    const position = new Float32Array(n * perThread * 3);
    const tangent = new Float32Array(n * perThread * 3);
    const info = new Float32Array(n * perThread * 4); // (s, across −1|+1, side, seed)
    const index = [];
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    threads.forEach((thread, k) => {
        for (let i = 0; i <= seg; i++) {
            const s = i / seg;
            threadPoint(thread, s, p);
            threadPoint(thread, Math.min(1, s + 1 / seg), q);
            if (i === seg) {
                threadPoint(thread, s - 1 / seg, q);
                for (let c = 0; c < 3; c++) q[c] = p[c] * 2 - q[c];
            }
            for (let e = 0; e < 2; e++) {
                const v = k * perThread + i * 2 + e;
                position.set(p, v * 3);
                tangent.set([q[0] - p[0], q[1] - p[1], q[2] - p[2]], v * 3);
                const kind = thread.long ? 2 : 0;
                info.set([s, e === 0 ? -1 : 1, thread.long ? thread.side : 0, thread.seed + kind], v * 4);
            }
            if (i < seg) {
                const b0 = k * perThread + i * 2;
                index.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangent, 3));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, -70), 500);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisThreads';
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;

    const aInfo = attribute('aInfo', 'vec4');
    const vInfo = varying(aInfo, 'vThread');
    // The thread's seed and kind, flat: interpolated, the seed (times 977 for the dew) picked
    // a different set of beads at every pixel.
    const vThreadSeed = flatVarying(aInfo.w, 'vThreadSeed');
    const vAcross = varying(aInfo.y, 'vThreadAcross');

    material.vertexNode = Fn(() => {
        const s = aInfo.x;
        // The silk stirs: most in the middle of a span, not at all where it is made fast.
        const slack = s.mul(float(1.0).sub(s)).mul(4.0);
        const stir = sin(u.drift.mul(0.7).add(aInfo.w.mul(40.0)).add(s.mul(5.0))).mul(slack).mul(0.35);
        // The silk goes where the chrysalis hangs: the fan with it, a long thread at that end only
        // (its other end is made fast to the crystal).
        const isLong = step(1.5, aInfo.w);
        const follow = mix(float(1.0), float(1.0).sub(s), isLong);
        const base = attribute('position', 'vec3').add(vec3(stir, stir.mul(0.3), 0.0)).add(u.perch.mul(follow));
        const along3 = attribute('aTangent', 'vec3').sub(u.perch.mul(isLong).mul(1 / seg));
        const viewProj = cameraProjectionMatrix.mul(cameraViewMatrix);
        const c0 = viewProj.mul(vec4(base, 1.0)).toVar();
        const c1 = viewProj.mul(vec4(base.add(along3), 1.0));
        const s0 = c0.xy.div(max(c0.w, 1e-4));
        const s1 = c1.xy.div(max(c1.w, 1e-4));
        const along = normalize(s1.sub(s0).mul(u.viewport).add(vec2(1e-5, 0.0)));
        const side = vec2(along.y.negate(), along.x);
        // 1.7 px wide, whatever its distance.
        const px = float(1.7);
        const off = side.mul(aInfo.y).mul(px).div(u.viewport).mul(c0.w);
        return vec4(c0.xy.add(off), c0.z, c0.w);
    })();

    const light = Fn(() => {
        const s = vInfo.x;
        const long = step(1.5, vThreadSeed);
        const seed = fract(vThreadSeed);
        const profile = float(1.0).sub(abs(vAcross));
        // Silk: next to nothing, except where it catches the evening.
        const sheen = sin(s.mul(31.0).add(seed.mul(60.0)).add(u.drift.mul(0.35))).mul(0.5).add(0.5);
        const silk = u.horizon.mul(0.05).add(u.glow.mul(sheen.mul(sheen).mul(sheen)).mul(0.1))
            .mul(long.mul(0.6).add(0.7));
        // Dew: beads strung along it.
        const count = mix(float(46.0), float(120.0), long);
        const at = s.mul(count);
        const bead = vcBell(fract(at).sub(0.5).div(0.2)).mul(step(0.5, vcHash11(floor(at).add(seed.mul(977.0)))));
        const wink = sin(u.time.mul(1.4).add(floor(at).mul(2.1))).mul(0.35).add(0.65);
        const dew = mix(u.glow, vec3(1.0, 0.95, 0.9), 0.5).mul(bead.mul(wink)).mul(0.55);
        // A bead of the piece's colour runs down to the chrysalis and wakes the dew as it passes.
        const run = vec3(0.0).toVar();
        for (let i = 0; i < THREAD_PULSES; i++) {
            const A = u.pulseA[i];
            const age = u.time.sub(A.x);
            const head = float(1.0).sub(age.div(PULSE_TRAVEL));
            const mine = float(1.0).sub(step(0.5, abs(A.y.sub(vInfo.z)).mul(abs(A.y))));
            const live = step(0.0, age).mul(step(age, PULSE_TRAVEL * 1.6)).mul(mine).mul(A.z);
            const x = s.sub(head);
            const body = vcBell(x.div(0.035)).add(vcBell(x.sub(0.09).div(0.12)).mul(0.3));
            const lit = body.add(bead.mul(vcBell(x.div(0.2))).mul(1.2));
            run.addAssign(u.pulseC[i].mul(lit).mul(live).mul(long.mul(4.6).add(2.4)));
        }
        const near = float(1.0).sub(smoothstep(0.86, 1.0, s).mul(float(1.0).sub(long)));
        return silk.add(dew).add(run.mul(u.pulsesLive)).mul(profile).mul(near)
            .mul(u.breath);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(light(), 0.0);

    const part = vcPart('VesperChrysalisThreads', geometry, material, 62);
    part.count = n;
    return part;
}
