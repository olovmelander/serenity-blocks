/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE DOLPHINS, DRAWN (Odyssey masterpiece pass, follow-up 2026-11-17): the pod of
 * composition/odyssey-dolphin-pod.js in the world's own light and water.
 *
 * THE HULL is this module's own model, built here (no loader, no file): a body lofted through
 * thirteen measured sections (beak, melon, shoulder, the girth a third of the way back, the
 * narrow tail stock flattened side to side), a falcate dorsal fin, two pectoral fins and the
 * flukes with their notch, each fin a thin closed lens. Every surface is index-shared, so its
 * normals are smooth and the animal is round under the light. Countershaded: a dark slate back
 * and fins, grey flanks, a pale belly.
 *
 * ONE DRAW for the pod: the hull instanced, each dolphin's pose (place, heading, pitch, the
 * arch of its path, its tail's beat) read from a table the CPU fills each frame from the clock.
 * The vertex stage lays the body along its path's curve and runs the beat down it as a wave
 * that is nothing at the head and widest at the flukes.
 *
 * LIGHT. In the air it is lit by the world's sun and sky with the gleam of wet skin; under the
 * surface by the surface (the lamp every sea form here uses) and hazed by the world's water,
 * decided per fragment, so a dolphin half out of the sea is half in each light. The sea is
 * opaque from above: a dolphin that dives is hidden by the water it dived into, and one that
 * leaps is hidden from an eye below by the surface it left. Nothing is switched in view: far off
 * the pod shrinks to nothing before it is no longer submitted.
 *
 * THE SPLASHES are a second small draw: where each dolphin last left the water and where it
 * last went back in, a burst of spray and a ring of foam, for a second and a half. They belong to
 * the air: an eye under the surface sees the surface instead.
 *
 * THE SPLASH FROM BELOW (2026-11-19) is a third, for an eye under the surface (the owner: "when
 * we see them from under the water we don't see the splash when they jump and break the
 * surface"). Going in, a dolphin drags air down with it: a white cloud billows round the place
 * it went in and a trail of bubbles streams off its body along its dive, rising back, wobbling,
 * and gone at the surface. Coming out, a smaller cloud where its flukes leave. And on the
 * underside of the surface, lit through from above, the boil of white water where it broke
 * through and a ring running out from it. Every bubble's place is a function of its mark's age
 * (closed form, the mark rows the CPU writes each frame), so a seek shows the same bubbles; they
 * are lit by the surface and hazed by the water as the dolphins are.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, clamp, cos, cross, dot, float, instanceIndex, length, mix, normalGeometry,
    normalize, positionGeometry, positionLocal, positionWorld, sign, sin, smoothstep, texture, uniform, uniformArray, uv,
    varying, vec2, vec3, exp, int, max, min, step,
} from 'three/tsl';
import {
    DOLPHIN_POD, dolphinAt, dolphinDive, dolphinSplashes,
} from '../composition/odyssey-dolphin-pod.js';

export const DOLPHIN_LOOK = Object.freeze({
    back: Object.freeze([0.075, 0.10, 0.135]),
    flank: Object.freeze([0.27, 0.31, 0.36]),
    belly: Object.freeze([0.72, 0.75, 0.77]),
    /** Beyond `far[0]` u from the eye the pod shrinks, to nothing by `far[1]` (then it is not drawn). */
    far: Object.freeze([1500, 2600]),
});

/**
 * THE SPLASH FROM BELOW, in numbers. Per mark (a dolphin's last entry, its last exit): how many
 * `puffs` (soft sprites that make the white cloud) and `beads` (single bubbles with a bright rim)
 * it leaves, and over how much of its path they are shed (s after it went through: `shed` for
 * the beads, `puffShed` for the cloud). The low tier keeps `lowShare` of each.
 *   puff, bead  size (u radius; a puff's grows with the dolphin's length over 10 u), life (s),
 *               rise (u/s), how far the turbulence spreads them (u per 10 u of dolphin), alpha
 *   churn       the boil and the ring on the surface's underside: life (s), how far the ring
 *               runs (u per 10 u of dolphin), how far under the mean surface it lies (u)
 *   girth       where the air comes off: a share of the dolphin's length round its path
 *   pull        how hard the plunge drags the fresh cloud down (u/s, eased out)
 *   pixel       the least a bubble is drawn, as a share of its distance (about 1.5 px at 1080p);
 *               a smaller one is drawn that wide with its light spread thinner
 */
export const DOLPHIN_BELOW = Object.freeze({
    entry: Object.freeze({
        puffs: 22, beads: 60, shed: 1.0, puffShed: 0.45,
    }),
    exit: Object.freeze({
        puffs: 10, beads: 26, shed: 0.4, puffShed: 0.25,
    }),
    lowShare: 0.6,
    puff: Object.freeze({
        size: Object.freeze([0.55, 1.5]),
        life: Object.freeze([1.0, 2.2]),
        rise: Object.freeze([0.3, 0.9]),
        spread: 2.4,
        alpha: 0.62,
    }),
    bead: Object.freeze({
        size: Object.freeze([0.07, 0.28]),
        life: Object.freeze([1.4, 3.2]),
        rise: Object.freeze([0.8, 2.4]),
        spread: 1.2,
        alpha: 0.95,
    }),
    churn: Object.freeze({ life: 2.4, reach: 4.2, depth: 0.12 }),
    /** How bright the air is under the surface (it turns the surface's light back), and the churn. */
    light: Object.freeze({ puff: 1.25, bead: 1.35, churn: 1.35 }),
    girth: 0.1,
    pull: 1.8,
    pixel: 0.0016,
});
/** A bubble's part: a puff of the cloud, a bead, the churn on the surface's underside. */
const BELOW_ROLE = Object.freeze({ puff: 0, bead: 1, churn: 2 });

/**
 * The bubbles' instances, one mark after another (each dolphin's entry, then its exit): per
 * instance (mark, role, four 0..1 seeds). Deterministic (a hash of the instance's number).
 * @param {number} dolphins
 * @param {string} [quality]
 * @returns {{ count: number, a: Float32Array, b: Float32Array }}
 */
export function buildDolphinBubbles(dolphins, quality = 'high') {
    const B = DOLPHIN_BELOW;
    const share = quality === 'low' ? B.lowShare : 1;
    const kinds = [B.entry, B.exit].map((k) => ({
        puffs: Math.max(1, Math.round(k.puffs * share)), beads: Math.max(1, Math.round(k.beads * share)),
    }));
    const rand01 = (n) => {
        let h = Math.imul(n ^ 0x2c1b3c6d, 2654435761);
        h = Math.imul(h ^ (h >>> 15), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    // Each instance's (mark, role), in order: per dolphin its entry's puffs, beads and churn, then
    // its exit's.
    const plan = [];
    for (let i = 0; i < dolphins; i += 1) {
        kinds.forEach((k, kind) => {
            const mark = (i * 2) + kind;
            for (let j = 0; j < k.puffs; j += 1) plan.push([mark, BELOW_ROLE.puff]);
            for (let j = 0; j < k.beads; j += 1) plan.push([mark, BELOW_ROLE.bead]);
            plan.push([mark, BELOW_ROLE.churn]);
        });
    }
    const n = plan.length;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    plan.forEach(([mark, role], i) => {
        a.set([mark, role, rand01((i * 8) + 1), rand01((i * 8) + 2)], i * 4);
        b.set([rand01((i * 8) + 3), rand01((i * 8) + 4), rand01((i * 8) + 5), rand01((i * 8) + 6)], i * 4);
    });
    return { count: n, a, b };
}

/** The body's sections: [t along the body (0 beak tip .. 1), half-height over the axis, under it, half-width]. */
const SECTIONS = [
    [0.000, 0.004, 0.004, 0.006], [0.035, 0.014, 0.016, 0.020], [0.085, 0.021, 0.027, 0.031],
    [0.108, 0.056, 0.040, 0.050], [0.160, 0.082, 0.058, 0.072], [0.260, 0.098, 0.078, 0.090],
    [0.380, 0.104, 0.086, 0.094], [0.500, 0.098, 0.080, 0.086], [0.620, 0.082, 0.066, 0.066],
    [0.740, 0.060, 0.048, 0.040], [0.840, 0.040, 0.034, 0.020], [0.920, 0.026, 0.022, 0.012],
    [0.965, 0.012, 0.010, 0.010],
];

/** A section at `t`, eased between the measured ones (Catmull-Rom, so the loft has no corners). */
function sectionAt(t) {
    let i = 0;
    while (i < SECTIONS.length - 2 && t > SECTIONS[i + 1][0]) i += 1;
    const p0 = SECTIONS[Math.max(0, i - 1)];
    const p1 = SECTIONS[i];
    const p2 = SECTIONS[i + 1];
    const p3 = SECTIONS[Math.min(SECTIONS.length - 1, i + 2)];
    const u = Math.max(0, Math.min(1, (t - p1[0]) / (p2[0] - p1[0])));
    const cr = (k) => {
        const v = 0.5 * ((2 * p1[k]) + ((p2[k] - p0[k]) * u) + (((2 * p0[k]) - (5 * p1[k]) + (4 * p2[k]) - p3[k]) * u * u)
            + ((-p0[k] + (3 * p1[k]) - (3 * p2[k]) + p3[k]) * u * u * u));
        return Math.max(0.002, v);
    };
    return { top: cr(1), bottom: cr(2), wide: cr(3) };
}

/**
 * The dolphin: a unit-long hull, beak at +z 0.5, flukes at -z, back +y.
 * @returns {THREE.BufferGeometry} position, normal, color (indexed, smooth)
 */
export function buildDolphinHull() {
    const positions = [];
    const colours = [];
    const index = [];
    const L = DOLPHIN_LOOK;
    const mix3 = (a, b, t) => [a[0] + ((b[0] - a[0]) * t), a[1] + ((b[1] - a[1]) * t), a[2] + ((b[2] - a[2]) * t)];
    const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - (2 * t)); };
    const push = (p, c) => { positions.push(p[0], p[1], p[2]); colours.push(c[0], c[1], c[2]); return (positions.length / 3) - 1; };

    // ── the body ──
    const RINGS = 34;
    const SIDES = 16;
    const END = SECTIONS.at(-1)[0];
    const ring0 = [];
    for (let j = 0; j <= RINGS; j += 1) {
        // Closer rings toward the head, where the profile turns fastest.
        const t = END * ((j / RINGS) ** 1.25);
        const s = sectionAt(t);
        const row = [];
        for (let i = 0; i < SIDES; i += 1) {
            const a = (i / SIDES) * Math.PI * 2;
            const up = Math.sin(a);
            const p = [Math.cos(a) * s.wide, up * (up >= 0 ? s.top : s.bottom), 0.5 - t];
            // Countershading: the back's cape down to the flank, the belly pale; the lower jaw pale.
            const cape = ss(0.05, 0.55, up);
            const under = ss(-0.15, -0.65, up);
            const c = mix3(mix3(L.flank, L.back, cape), L.belly, under);
            row.push(push(p, c));
        }
        ring0.push(row);
    }
    for (let j = 0; j < RINGS; j += 1) {
        for (let i = 0; i < SIDES; i += 1) {
            const i1 = (i + 1) % SIDES;
            index.push(ring0[j][i], ring0[j + 1][i], ring0[j][i1], ring0[j][i1], ring0[j + 1][i], ring0[j + 1][i1]);
        }
    }
    const nose = push([0, 0, 0.503], L.flank);
    const tail = push([0, 0, 0.5 - END - 0.004], L.back);
    for (let i = 0; i < SIDES; i += 1) {
        const i1 = (i + 1) % SIDES;
        index.push(nose, ring0[0][i], ring0[0][i1]);
        index.push(tail, ring0[RINGS][i1], ring0[RINGS][i]);
    }

    // ── fins: thin closed lenses through their own sections (leading edge, trailing edge, thickness) ──
    const fin = (sections, thick, colour) => {
        const rows = sections.map(({ le, te, th }) => {
            const mid = [le[0] + ((te[0] - le[0]) * 0.38), le[1] + ((te[1] - le[1]) * 0.38), le[2] + ((te[2] - le[2]) * 0.38)];
            return [
                push(le, colour),
                push([mid[0] + (thick[0] * th), mid[1] + (thick[1] * th), mid[2] + (thick[2] * th)], colour),
                push(te, colour),
                push([mid[0] - (thick[0] * th), mid[1] - (thick[1] * th), mid[2] - (thick[2] * th)], colour),
            ];
        });
        for (let k = 0; k < rows.length - 1; k += 1) {
            for (let i = 0; i < 4; i += 1) {
                const i1 = (i + 1) % 4;
                index.push(rows[k][i], rows[k + 1][i], rows[k][i1], rows[k][i1], rows[k + 1][i], rows[k + 1][i1]);
            }
        }
        const last = rows.at(-1);
        index.push(last[0], last[2], last[1], last[0], last[3], last[2]);
    };
    const zAt = (t) => 0.5 - t;
    // The dorsal fin: swept back, its trailing edge hollow (falcate).
    const dorsal = [];
    for (let k = 0; k <= 6; k += 1) {
        const h = k / 6;
        const leZ = zAt(0.415) - (0.115 * (h ** 1.15));
        const chord = 0.185 * ((1 - h) ** 0.75) * (1 - (0.30 * Math.sin(Math.PI * h)));
        const rootY = sectionAt(0.48).top - 0.006;
        dorsal.push({ le: [0, rootY + (0.118 * h), leZ], te: [0, rootY + (0.118 * h), leZ - Math.max(0.004, chord)], th: 0.012 * (1 - (0.85 * h)) });
    }
    fin(dorsal, [1, 0, 0], L.back);
    // The flukes: two lobes swept back from the tail stock, a notch between them.
    const chords = [0.062, 0.080, 0.070, 0.054, 0.034, 0.006];
    [-1, 1].forEach((side) => {
        const lobe = [];
        for (let k = 0; k <= 5; k += 1) {
            const h = k / 5;
            const leZ = zAt(0.905) - (0.085 * (h ** 1.1));
            lobe.push({ le: [side * 0.142 * h, 0.001, leZ], te: [side * 0.142 * h, 0.001, leZ - chords[k]], th: 0.0085 * (1 - (0.8 * h)) });
        }
        fin(lobe, [0, side, 0], L.back);
    });
    // The pectoral fins: out, down and back from the shoulder.
    [-1, 1].forEach((side) => {
        const flipper = [];
        const dir = [side * 0.60, -0.42, -0.68];
        const thick = [side * 0.57, 0.82, 0];
        for (let k = 0; k <= 4; k += 1) {
            const h = k / 4;
            const le = [(side * 0.074) + (dir[0] * 0.17 * h), -0.052 + (dir[1] * 0.17 * h), zAt(0.245) + (dir[2] * 0.17 * h)];
            const chord = 0.068 * (1 - (h ** 1.6)) + 0.004;
            flipper.push({ le, te: [le[0] - (side * 0.006), le[1] - 0.006, le[2] - chord], th: 0.009 * (1 - (0.8 * h)) });
        }
        fin(flipper, thick, mix3(L.back, L.flank, 0.25));
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * @param {object} o
 * @param {number} o.seaLevel
 * @param {string} [o.quality] 'high' | 'low'
 * @param {*} o.noiseTex the world's tiling detail texture (b = value noise)
 * @param {(colour: *, worldPosition: *) => *} o.haze the world's air and water, per fragment
 * @param {(colour: *) => *} o.grade the world's output grade
 * @param {(colour: *) => *} o.gradeLight the grade for the splashes (no fade toward dark)
 * @param {(worldPosition: *) => *} [o.depthNode] the 1->2 steam's depth rule
 * @param {*} o.sunDir vec3 uniform (toward the sun)
 * @param {*} o.sunColour vec3 uniform
 * @param {*} o.skyLight vec3 node: the sky's light on a surface facing up
 */
export function createOdysseyDolphins({
    seaLevel, quality = 'high', noiseTex, haze, grade, gradeLight, depthNode = null, sunDir, sunColour, skyLight,
}) {
    const P = DOLPHIN_POD;
    const dolphins = quality === 'low' ? P.dolphins.slice(0, P.lowCount) : P.dolphins;
    const count = dolphins.length;
    const group = new THREE.Group();
    group.name = 'odyssey-dolphin-pod';
    group.visible = false;

    // ── the pod ──
    const rows = Array.from({ length: count * 3 }, () => new THREE.Vector4());
    const uRows = uniformArray(rows, 'vec4');
    const hull = buildDolphinHull();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(hull.index);
    geo.setAttribute('position', hull.attributes.position);
    geo.setAttribute('normal', hull.attributes.normal);
    geo.setAttribute('color', hull.attributes.color);
    geo.instanceCount = count;
    const mat = new THREE.MeshBasicNodeMaterial();
    {
        const r0 = uRows.element(instanceIndex.mul(3));
        const r1 = uRows.element(instanceIndex.mul(3).add(1));
        const r2 = uRows.element(instanceIndex.mul(3).add(2));
        const p = positionGeometry;
        const t = float(0.5).sub(p.z);
        // The beat: a wave down the body, nothing at the head, widest at the flukes.
        const wave = sin(r1.z.sub(t.mul(4.4))).mul(t.mul(t).mul(0.085).add(0.003)).mul(r2.y);
        // The arch: the body lies along the curve of its own path.
        const arch = r1.w.mul(p.z).mul(p.z).mul(0.5);
        const lx = p.x.mul(r2.x);
        const ly = p.y.add(wave).add(arch).mul(r2.x);
        const lz = p.z.mul(r2.x);
        const cp = cos(r1.x);
        const sp = sin(r1.x);
        const cy = cos(r0.w);
        const sy = sin(r0.w);
        const turn = (v) => {
            // Pitch about the body's side axis (nose up), then heading about the vertical.
            const py = v.y.mul(cp).add(v.z.mul(sp));
            const pz = v.z.mul(cp).sub(v.y.mul(sp));
            return vec3(v.x.mul(cy).add(pz.mul(sy)), py, pz.mul(cy).sub(v.x.mul(sy)));
        };
        mat.positionNode = vec3(r0.x, r0.y, r0.z).add(turn(vec3(lx, ly, lz)));
        const vNormal = varying(turn(normalGeometry), 'vDolphinNormal');
        const base = attribute('color', 'vec3');
        const wp = positionWorld;
        const eye = normalize(cameraPosition.sub(wp));
        // (The fins are thin lenses seen from either side: the normal is the one facing the eye.)
        const nRaw = normalize(vNormal);
        const n = nRaw.mul(sign(dot(nRaw, eye)).add(0.0001));
        // In the air: the sun, the sky, and the gleam of wet skin.
        const half = normalize(sunDir.add(eye));
        const gleam = clamp(dot(n, half), 0, 1).pow(42).mul(0.85);
        const rim = float(1).sub(clamp(dot(n, eye), 0, 1));
        const airLit = base.mul(sunColour.mul(clamp(dot(n, sunDir), 0, 1).mul(1.15))
            .add(skyLight.mul(n.y.mul(0.32).add(0.56))))
            .add(sunColour.mul(gleam))
            .add(skyLight.mul(rim.mul(rim).mul(rim).mul(0.30)));
        // Under the surface: the surface is the lamp, and a belly seen from below is in its own
        // shadow (a dark shape against the bright water, as the sea's other animals are).
        const lamp = mix(float(0.10), float(1.12), clamp(n.y.mul(0.5).add(0.5), 0, 1).pow(1.25));
        const waterLit = base.mul(lamp);
        const under = smoothstep(float(seaLevel + 0.25), float(seaLevel - 0.6), wp.y);
        mat.colorNode = grade(haze(mix(airLit, waterLit, under), wp));
        if (depthNode) mat.depthNode = depthNode(wp);
        mat.side = THREE.DoubleSide;
        mat.fog = false;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'odyssey-dolphins';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);

    // ── the splashes: per dolphin a burst and a ring where it left the water, and where it went in ──
    const splashCount = count * 4;
    const splashData = new Float32Array(splashCount * 4);
    const splashAttr = new THREE.InstancedBufferAttribute(splashData, 4);
    splashAttr.setUsage(THREE.DynamicDrawUsage);
    const splashGeo = new THREE.InstancedBufferGeometry();
    {
        const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
        splashGeo.setIndex(quadGeo.index);
        splashGeo.setAttribute('position', quadGeo.attributes.position);
        splashGeo.setAttribute('uv', quadGeo.attributes.uv);
        splashGeo.setAttribute('aSplash', splashAttr);
        splashGeo.instanceCount = splashCount;
        quadGeo.dispose();
    }
    const uEyeAbove = uniform(0);
    const splashMat = new THREE.MeshBasicNodeMaterial();
    {
        const s = attribute('aSplash', 'vec4');
        const life = clamp(s.z.div(P.splashLife), 0, 1);
        const ring = s.w;
        const q = positionLocal;
        // The burst stands up from the water and faces the eye; the ring lies on the water.
        const toEye = cameraPosition.sub(vec3(s.x, float(seaLevel), s.y));
        const side = normalize(cross(vec3(0, 1, 0), toEye).add(vec3(1e-4, 0, 0)));
        const grow = life.pow(0.5);
        // (Lower and narrower since 2026-11-21, sea audit item 20: the tall V read as a whale's blow.)
        const burstW = grow.mul(3.0).add(1.1);
        const burstH = grow.mul(2.2).add(0.8);
        const burst = vec3(s.x, float(seaLevel + 0.1), s.y)
            .add(side.mul(q.x.mul(burstW)))
            .add(vec3(0, 1, 0).mul(q.y.add(0.5).mul(burstH)));
        const ringR = life.pow(0.7).mul(4.6).add(1.0);
        const flat = vec3(s.x.add(q.x.mul(ringR.mul(2))), float(seaLevel + 0.16), s.y.add(q.y.mul(ringR.mul(2))));
        splashMat.positionNode = mix(burst, flat, ring);
        const sUv = uv();
        const seed = s.x.mul(0.37).add(s.y.mul(0.11));
        // The burst: a fan of spray, wider the higher it is, broken into drops, thinning as it falls.
        const fan = float(1).sub(smoothstep(float(0.55), float(1.0), abs(sUv.x.sub(0.5)).div(sUv.y.mul(0.42).add(0.10))));
        const drops = smoothstep(float(0.42), float(0.70), texture(noiseTex, vec2(sUv.x.mul(0.9).add(seed), sUv.y.mul(0.5).sub(life.mul(0.35)))).b);
        const burstA = fan.mul(drops.mul(0.75).add(0.25))
            .mul(float(1).sub(smoothstep(float(0.45), float(1.0), sUv.y)))
            .mul(float(1).sub(smoothstep(float(0.25), float(0.48), life)));
        // RIPPLES, NOT A TARGET (2026-11-21, sea audit item 20): one opaque white band of constant
        // width read as a target ring laid on the sea. Now a few thin crests running out from where
        // it went through, the outer the strongest, broken by a lace, in the water's own pale sky
        // tone rather than paper white, and gone sooner.
        const rr = length(sUv.sub(vec2(0.5))).mul(2);
        const crestAt = (c, w) => smoothstep(float(c - w), float(c), rr).mul(float(1).sub(smoothstep(float(c), float(c + w), rr)));
        const crests = crestAt(0.90, 0.06).add(crestAt(0.66, 0.06).mul(0.55)).add(crestAt(0.42, 0.05).mul(0.3));
        const lace = smoothstep(float(0.40), float(0.66), texture(noiseTex, sUv.mul(0.7).add(vec2(seed, life.mul(0.2)))).b);
        const ringA = crests.mul(lace.mul(0.85).add(0.15)).mul(float(1).sub(life).pow(1.6));
        splashMat.colorNode = gradeLight(mix(vec3(0.95, 0.98, 1.0).mul(1.05), vec3(0.80, 0.91, 0.97), ring));
        splashMat.opacityNode = mix(burstA.mul(0.85), ringA.mul(0.55), ring)
            .mul(float(1).sub(smoothstep(float(0.985), float(1.0), life)))
            .mul(uEyeAbove);
        splashMat.alphaTest = 0.01;
        splashMat.transparent = true;
        splashMat.depthWrite = false;
        splashMat.side = THREE.DoubleSide;
        splashMat.fog = false;
    }
    const splashMesh = new THREE.Mesh(splashGeo, splashMat);
    splashMesh.name = 'odyssey-dolphin-splashes';
    splashMesh.frustumCulled = false;
    splashMesh.renderOrder = 6;
    group.add(splashMesh);

    // ── the splash from below: the air each dolphin takes down, and the churn on the underside ──
    const BW = DOLPHIN_BELOW;
    const markRows = Array.from({ length: count * 2 * 3 }, () => new THREE.Vector4());
    const uMarks = uniformArray(markRows, 'vec4');
    const bubbles = buildDolphinBubbles(count, quality);
    const bubbleGeo = new THREE.InstancedBufferGeometry();
    {
        const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
        bubbleGeo.setIndex(quadGeo.index);
        bubbleGeo.setAttribute('position', quadGeo.attributes.position);
        bubbleGeo.setAttribute('uv', quadGeo.attributes.uv);
        bubbleGeo.setAttribute('aBelowA', new THREE.InstancedBufferAttribute(bubbles.a, 4));
        bubbleGeo.setAttribute('aBelowB', new THREE.InstancedBufferAttribute(bubbles.b, 4));
        bubbleGeo.instanceCount = bubbles.count;
        quadGeo.dispose();
    }
    const uEyeUnder = uniform(0);
    const bubbleMat = new THREE.MeshBasicNodeMaterial();
    {
        const a = attribute('aBelowA', 'vec4');
        const b = attribute('aBelowB', 'vec4');
        // The mark's three rows: where and when and which (0 in, 1 out); its heading, the pace and
        // the dolphin's length; its dive (depth, time under) and how strongly it is drawn.
        const row = int(a.x.mul(3).add(0.5));
        const r0 = uMarks.element(row);
        const r1 = uMarks.element(row.add(1));
        const r2 = uMarks.element(row.add(2));
        const isExit = r0.w;
        const role = a.y;
        const isPuff = float(1).sub(step(0.5, role));
        const isChurn = step(1.5, role);
        const isBead = float(1).sub(isPuff).sub(isChurn);
        const scale = r1.w.div(10);
        const dir = vec2(r1.x, r1.y);
        // Where on its path it was shed (biased to where it went through), and when.
        const shed = mix(
            mix(float(BW.entry.shed), float(BW.entry.puffShed), isPuff),
            mix(float(BW.exit.shed), float(BW.exit.puffShed), isPuff),
            isExit,
        );
        // (The cloud bunches at the plunge; the beads string out along the dive.)
        const tau = shed.mul(mix(a.z.pow(1.3), a.z.mul(a.z), isPuff));
        const age = r0.z.sub(tau.add(a.w.mul(0.1))).toVar();
        // Going in, the air rides the dive (its middle's arc under the surface); coming out it is
        // left where the flukes leave, behind the place the body broke through, and shallow.
        const w = min(tau.div(max(r2.y, float(1e-3))), float(1));
        const yDive = r2.x.mul(4).mul(w).mul(float(1).sub(w)).negate();
        const yOut = b.x.mul(1.1).add(0.15).mul(scale).negate();
        const along = mix(r1.z.mul(tau), r1.w.mul(0.25).mul(b.w).negate(), isExit);
        const t = max(age, float(0));
        const settle = float(1).sub(exp(t.mul(-3)));
        // Round its path at the body's girth, then spread by the turbulence.
        const spin = b.y.mul(Math.PI * 2);
        const spread = mix(float(BW.bead.spread), float(BW.puff.spread), isPuff).mul(scale);
        const reach = r1.w.mul(BW.girth).mul(b.z.mul(0.8).add(0.35))
            .add(spread.mul(float(1).sub(exp(t.mul(-2.2)))));
        const side = vec2(dir.y.negate(), dir.x);
        const wob = sin(t.mul(6.5).add(b.w.mul(40))).mul(0.1).mul(isBead);
        const drag = r1.z.mul(0.06).mul(settle).mul(float(1).sub(isExit));
        const flat = vec2(r0.x, r0.y)
            .add(dir.mul(along.add(drag)))
            .add(side.mul(cos(spin).mul(reach).add(wob)));
        const rise = mix(
            mix(float(BW.bead.rise[0]), float(BW.bead.rise[1]), b.z),
            mix(float(BW.puff.rise[0]), float(BW.puff.rise[1]), b.z),
            isPuff,
        );
        const pull = settle.mul(BW.pull / 3).mul(float(1).sub(isExit)).mul(float(1).sub(w));
        const yRel = min(
            mix(yDive, yOut, isExit).add(sin(spin).mul(reach).mul(0.6)).add(rise.mul(t)).sub(pull),
            float(-0.05),
        ).toVar();
        const centre = vec3(flat.x, float(seaLevel).add(yRel), flat.y);
        // Its life: a puff thins fast, a bead lives until it reaches the surface; coming out,
        // everything is shorter.
        const life = mix(
            mix(float(BW.bead.life[0]), float(BW.bead.life[1]), b.w),
            mix(float(BW.puff.life[0]), float(BW.puff.life[1]), b.w),
            isPuff,
        ).mul(mix(float(1), float(0.6), isExit));
        const alive = step(0.0, age).mul(float(1).sub(step(life, age))).mul(step(1e-3, r2.z));
        // Facing the eye; never thinner than a pixel and a half, its light spread thinner when
        // drawn wider than it is.
        const toEye = cameraPosition.sub(centre);
        const dist = max(length(toEye), float(1e-3));
        const fwd = toEye.div(dist);
        const right = normalize(cross(vec3(0, 1, 0), fwd).add(vec3(1e-4, 0, 0)));
        const up = cross(fwd, right);
        const size = mix(
            mix(float(BW.bead.size[0]), float(BW.bead.size[1]), b.x.mul(b.x)),
            mix(float(BW.puff.size[0]), float(BW.puff.size[1]), b.x).mul(scale).mul(settle.mul(0.6).add(0.7)),
            isPuff,
        );
        const drawn = max(size, dist.mul(BW.pixel));
        const cover = size.div(drawn).pow(2);
        const q = positionLocal;
        const sprite = centre.add(right.mul(q.x.mul(drawn).mul(2))).add(up.mul(q.y.mul(drawn).mul(2)));
        // The churn lies flat under the surface: the boil, and the ring running out of it.
        const churnLife = mix(float(BW.churn.life), float(BW.churn.life * 0.7), isExit);
        const churnAge = r0.z;
        const churnR = scale.mul(float(BW.churn.reach).mul(float(1).sub(exp(churnAge.mul(-1.5)))).add(0.8));
        const churnAlive = float(1).sub(step(churnLife, churnAge)).mul(step(1e-3, r2.z));
        const churn = vec3(
            r0.x.add(q.x.mul(churnR).mul(2)),
            float(seaLevel - BW.churn.depth),
            r0.y.add(q.y.mul(churnR).mul(2)),
        );
        const shown = mix(alive, churnAlive, isChurn);
        bubbleMat.positionNode = mix(sprite, churn, isChurn).mul(shown)
            .add(vec3(r0.x, float(seaLevel - 1), r0.y).mul(float(1).sub(shown)));
        // How it fades: in at birth, out over the end of its life and as a bead nears the surface.
        const lifeT = clamp(age.div(life), 0, 1);
        const fade = smoothstep(float(0), float(0.08), age)
            .mul(float(1).sub(smoothstep(float(0.55), float(1), lifeT)))
            .mul(float(1).sub(smoothstep(float(-0.55), float(-0.06), yRel).mul(isBead)))
            .mul(cover);
        const churnT = clamp(churnAge.div(churnLife), 0, 1);
        const vFade = varying(mix(fade, float(1).sub(churnT).pow(1.5), isChurn).mul(r2.z), 'vDolphinBelowFade');
        const vRole = varying(role, 'vDolphinBelowRole');
        const vChurnT = varying(churnT, 'vDolphinBelowChurnT');
        const vSeed = varying(b.y.add(r0.x.mul(0.13)), 'vDolphinBelowSeed');
        const sUv = uv();
        const rr = length(sUv.sub(vec2(0.5))).mul(2);
        const fPuff = float(1).sub(step(0.5, vRole));
        const fChurn = step(1.5, vRole);
        const fBead = float(1).sub(fPuff).sub(fChurn);
        // A puff: a soft white clump broken into foam by the noise.
        const clump = texture(noiseTex, sUv.mul(0.45).add(vec2(vSeed, vSeed.mul(0.7)))).b;
        const puffA = exp(rr.mul(rr).mul(-3.2)).mul(float(1).sub(smoothstep(float(0.8), float(1), rr)))
            .mul(smoothstep(float(0.28), float(0.7), clump).mul(0.8).add(0.2))
            .mul(BW.puff.alpha);
        // A bead: a bright rim (the surface's light turned back inside it), a clear middle, and a
        // glint near its top where the light comes from.
        const rim = smoothstep(float(0.52), float(0.84), rr).mul(float(1).sub(smoothstep(float(0.84), float(1), rr)));
        const glintP = sUv.sub(vec2(0.4, 0.72));
        const glint = exp(dot(glintP, glintP).mul(-140));
        const beadA = rim.add(float(1).sub(rr).max(0).mul(0.15)).add(glint.mul(0.8)).min(1).mul(BW.bead.alpha);
        // The churn: a boil of white water that shrinks into the middle as the ring runs out,
        // both broken into lace.
        const lace = smoothstep(float(0.34), float(0.62), texture(noiseTex, sUv.mul(0.8).add(vec2(vSeed, vChurnT.mul(0.25)))).b);
        const boil = float(1).sub(smoothstep(float(0.18), float(0.5), rr.add(vChurnT.mul(0.25))))
            .mul(float(1).sub(smoothstep(float(0.2), float(0.75), vChurnT)));
        const ring = smoothstep(float(0.62), float(0.8), rr).mul(float(1).sub(smoothstep(float(0.82), float(1), rr)));
        const churnA = boil.add(ring.mul(0.7)).mul(lace.mul(0.6).add(0.4)).min(1);
        // Lit by the surface over it: brighter on top; the churn is lit through from above.
        const light = mix(
            mix(float(BW.light.puff), float(BW.light.bead), fBead).mul(mix(float(0.75), float(1.1), sUv.y)),
            float(BW.light.churn),
            fChurn,
        );
        bubbleMat.colorNode = grade(haze(vec3(0.84, 0.93, 1.0).mul(light), positionWorld));
        bubbleMat.opacityNode = puffA.mul(fPuff).add(beadA.mul(fBead)).add(churnA.mul(fChurn))
            .mul(vFade)
            .mul(uEyeUnder);
        bubbleMat.alphaTest = 0.01;
        bubbleMat.transparent = true;
        bubbleMat.depthWrite = false;
        bubbleMat.side = THREE.DoubleSide;
        bubbleMat.fog = false;
    }
    const bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    bubbleMesh.name = 'odyssey-dolphin-bubbles';
    bubbleMesh.frustumCulled = false;
    // After the sea's underside (drawn first, not depth-written), so the air under it shows.
    bubbleMesh.renderOrder = 6;
    group.add(bubbleMesh);
    const dives = dolphins.map((d) => dolphinDive(d));

    const pose = /** @type {any} */ ({});
    const marks = { exit: { x: 0, z: 0, age: 0 }, entry: { x: 0, z: 0, age: 0 } };
    const state = { drawn: false, scale: 0 };

    return {
        group,
        state,
        meshes: [mesh, splashMesh, bubbleMesh],
        /**
         * @param {number} time the world's clock (s)
         * @param {{ x: number, y: number, z: number }|null} eye the eye's world position
         * @param {boolean} life whether the sea's life is here (the 1->2 carry)
         */
        update(time, eye, life) {
            const dx = (eye?.x ?? 0) - P.centre[0];
            const dz = (eye?.z ?? 0) - P.centre[1];
            const dy = (eye?.y ?? seaLevel) - seaLevel;
            const dist = Math.hypot(dx, dy, dz);
            // Far off it shrinks to nothing before it stops being drawn: never a switch in view.
            const f = Math.max(0, Math.min(1, (DOLPHIN_LOOK.far[1] - dist) / (DOLPHIN_LOOK.far[1] - DOLPHIN_LOOK.far[0])));
            const scale = f * f * (3 - (2 * f));
            const drawn = life && scale > 0 && eye !== null;
            state.drawn = drawn;
            state.scale = scale;
            group.visible = drawn;
            if (!drawn) return;
            for (let i = 0; i < count; i += 1) {
                const d = dolphins[i];
                dolphinAt(d, time, pose);
                rows[i * 3].set(pose.x, seaLevel + pose.y, pose.z, pose.yaw);
                rows[(i * 3) + 1].set(pose.pitch, 0, pose.beat, pose.bend);
                rows[(i * 3) + 2].set(d.length * scale, pose.beatAmp, 0, 0);
                dolphinSplashes(d, time, marks);
                // Four marks a dolphin: a burst and a ring where it left the water, and where it
                // went in. (Past its life a splash is simply not there: its opacity is zero.)
                for (let k = 0; k < 4; k += 1) {
                    const m = k < 2 ? marks.exit : marks.entry;
                    const o = (i * 16) + (k * 4);
                    splashData[o] = m.x;
                    splashData[o + 1] = m.z;
                    splashData[o + 2] = m.age;
                    splashData[o + 3] = k % 2;
                }
                // And from below, the same two marks with the dolphin's heading and dive: its
                // entry, then its exit.
                [marks.entry, marks.exit].forEach((m, kind) => {
                    const o = ((i * 2) + kind) * 3;
                    markRows[o].set(m.x, m.z, m.age, kind);
                    markRows[o + 1].set(m.tx ?? 1, m.tz ?? 0, dives[i].speed, d.length * scale);
                    markRows[o + 2].set(dives[i].depth, dives[i].time, scale, 0);
                });
            }
            splashAttr.needsUpdate = true;
            // The splashes belong to the air: an eye under the surface sees the surface instead,
            // and the air the dolphins take down with them.
            const above = Math.max(0, Math.min(1, ((eye.y - seaLevel) + 0.2) / 1.2));
            const under = Math.max(0, Math.min(1, ((seaLevel - eye.y) + 0.3) / 1.2));
            uEyeAbove.value = above * scale;
            uEyeUnder.value = under;
            mesh.visible = mesh.userData.filterVisible !== false;
            splashMesh.visible = above > 0 && splashMesh.userData.filterVisible !== false;
            bubbleMesh.visible = under > 0 && bubbleMesh.userData.filterVisible !== false;
        },
        dispose() {
            mat.dispose();
            splashMat.dispose();
            bubbleMat.dispose();
            bubbleGeo.dispose();
            hull.dispose();
        },
    };
}
