/**
 * Stellar Velocity — what the board puts on the course.
 *
 *  - Hoops: every lock lays a hoop of light on the course ahead, in the piece's own colour. A
 *    hoop is a few arcs of plasma round the course, leaning its own way and turning slowly; it
 *    stands in the canyon as a ring of light (the cloud is marched with the nearest ones). A
 *    clear fires the drive and we go through every hoop we have laid: each comes at us ever
 *    faster, opens across the whole frame and is gone.
 *  - Bolts: a lock's light leaves the board as a bolt in the piece's colour and flies down the
 *    course to where its hoop will open: a bright head and a tail of motes strung along one arc.
 *  - Row jets: the cleared rows leave the card as short jets of light at their own heights,
 *    toward the sun, drawn in screen space so they line up with the rows exactly.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    instanceIndex,
    int,
    length,
    max,
    min,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BOLT_SLOTS, BOLT_TAIL, HOOP_SEGMENTS, HOOP_SLOTS, JET_LIFE, JET_SLOTS, TAU,
    mulberry32, svFxMaterial, svHash11, svPart, svQuadGeometry, svSeenCos,
} from './stellar-velocity-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The share of the sky's bunching the things on the course are shown with (as the canyon is). */
const COURSE_WARP = 0.5;

/** Where something true at `rel` (relative to the camera) is seen at speed `beta`. */
const seenPoint = (rel, beta) => {
    const range = max(length(rel), 1e-4);
    const dir = rel.div(range);
    const truth = clamp(dir.z.negate(), -1.0, 1.0);
    const seen = svSeenCos(truth, beta);
    const side = dir.xy.div(max(sqrt(max(float(1.0).sub(truth.mul(truth)), 1e-8)), 1e-4));
    return vec3(side.mul(sqrt(max(float(1.0).sub(seen.mul(seen)), 0.0))), seen.negate()).mul(range);
};

// ── Hoops ───────────────────────────────────────────────────────────────────────

/** @param {object} u */
export function createHoops(u) {
    const segments = HOOP_SEGMENTS;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const uvs = new Float32Array((segments + 1) * 2 * 2);
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const k = i / segments;
        positions.set([k, -0.5, 0, k, 0.5, 0], i * 6);
        uvs.set([k, 0, k, 1], i * 4);
        if (i < segments) {
            const a = i * 2;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.instanceCount = HOOP_SLOTS;

    const row = int(instanceIndex).mul(2);
    const A = u.hoops.element(row);
    const C = u.hoops.element(row.add(1));
    const depth = A.x;
    const radius = A.y;
    const seed = C.w;
    const beta = u.warp.mul(COURSE_WARP);
    // Each hoop leans a few degrees its own way, and the lean goes slowly round.
    const lean = svHash11(seed.mul(7.31).add(1.7)).sub(0.5).mul(0.42);
    const leanWay = seed.mul(2.39996).add(u.time.mul(0.045));
    const ringAt = (ang) => {
        const wound = ang.add(A.w).add(u.twist.mul(depth));
        const tip = sin(ang.sub(leanWay)).mul(lean).mul(radius);
        const rel = vec3(cos(wound).mul(radius), sin(wound).mul(radius), depth.add(tip).negate()).sub(u.camPos);
        return viewProjection(seenPoint(rel, beta).add(u.camPos));
    };
    const ang = positionGeometry.x.mul(TAU);
    const c0 = ringAt(ang);
    const c1 = ringAt(ang.add(TAU / segments));
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const along = s1.sub(s0);
    const dirS = along.add(vec2(1e-4, 0.0)).div(max(length(along), 1e-4));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    // The plasma's own thickness, and the glow round it (the quad is four cores wide).
    const corePx = max(radius.mul(0.042).div(max(c0.w, 0.05).mul(u.pixelAngle)), 1.4);
    const lit = step(1e-3, A.z).mul(step(0.03, c0.w));
    const widthPx = corePx.mul(4.0).mul(lit);
    const material = svFxMaterial('StellarVelocityHoops');
    material.vertexNode = vec4(
        c0.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(c0.w)),
        c0.z,
        c0.w,
    );
    // In a jump's tunnel the course is out of sight.
    const vLight = varying(
        C.rgb.mul(A.z.mul(1.6)).mul(u.iris).mul(u.breath).mul(float(1.0).sub(u.jump.mul(0.92))),
        'svHoopLight',
    );
    const vSeed = varying(vec2(seed, svHash11(seed.mul(3.17).add(0.4))), 'svHoopSeed');
    // Close to the lens a hoop is all glow; far off it is a hairline.
    const vNear = varying(smoothstep(6.0, 1.0, depth), 'svHoopNear');

    const st = uv();
    const q = clamp(st.y.sub(0.5).mul(2.0), -1.0, 1.0);
    const round = st.x;
    // One crescent of plasma: thick at its middle (the middle of the strip), drawn out to a
    // point at each end; the rest of the ring is only hinted. Bright knots run along it.
    const reach = vSeed.y.mul(0.34).add(0.5);
    const out = clamp(round.sub(0.5).abs().mul(2.0).div(reach), 0.0, 1.0);
    const swell = sqrt(max(float(1.0).sub(out.mul(out)), 0.0));
    const arcs = swell.mul(0.94).add(0.06);
    const knots = pow(u.fbmLod(vec2(round.mul(7.0).sub(u.time.mul(0.09)), vSeed.x.mul(0.23)), 0).g, 5.0).mul(3.5);
    const fibre = u.fbmLod(vec2(round.mul(15.0).add(u.time.mul(0.04)), q.mul(0.25).add(vSeed.x)), 0).b;
    const thin = q.div(max(swell.mul(0.85).add(0.15), 0.15));
    const core = exp(thin.mul(thin).mul(-18.0));
    const sheath = exp(q.mul(q).mul(-3.2)).mul(float(1.0).sub(smoothstep(0.75, 1.0, q.abs())));
    const body = core.mul(fibre.mul(0.9).add(0.7).add(knots)).add(sheath.mul(vNear.mul(0.22).add(0.12)));
    const white = core.mul(core).mul(0.4);
    material.colorNode = vec4(
        mix(vLight, vec3(svHoopPeak(vLight)), white).mul(body).mul(arcs),
        0.0,
    );

    return svPart('StellarVelocityHoops', geometry, material, 20);
}

/** The largest channel as a grey: what a hoop's core burns toward. */
function svHoopPeak(c) {
    return max(c.x, max(c.y, c.z));
}

// ── Bolts ───────────────────────────────────────────────────────────────────────

/** @param {object} u */
export function createBolts(u) {
    const count = BOLT_SLOTS * BOLT_TAIL;
    const rand = mulberry32(0xb017);
    const aMote = new Float32Array(count * 4);
    for (let s = 0; s < BOLT_SLOTS; s++) {
        for (let j = 0; j < BOLT_TAIL; j++) {
            aMote.set([s, j / (BOLT_TAIL - 1), rand(), rand()], (s * BOLT_TAIL + j) * 4);
        }
    }
    const geometry = svQuadGeometry(count, { aMote: [aMote, 4] });
    const mote = attribute('aMote', 'vec4');
    // Three rows a bolt: (where it leaves, when), (where it lands, seconds of flight),
    // (colour, size).
    const table = Array.from({ length: BOLT_SLOTS * 3 }, () => new THREE.Vector4(0, 0, 0, -100));
    const rows = uniformArray(table, 'vec4');
    const base = int(mote.x.add(0.5)).mul(3);
    const from = rows.element(base);
    const to = rows.element(base.add(1));
    const tint = rows.element(base.add(2));
    const beta = u.warp.mul(COURSE_WARP);

    const flight = max(to.w, 0.01);
    const head = u.time.sub(from.w).div(flight);
    // The tail trails the head by up to a third of the way.
    const k = head.sub(mote.y.mul(0.3));
    const pathAt = (kk) => {
        const e = clamp(kk, 0.0, 1.0);
        // It is drawn in: slow off the card, fast into the course.
        const drawn = e.mul(e).mul(float(1.6).sub(e.mul(0.6)));
        const span = to.xyz.sub(from.xyz);
        // The arc bows up and toward us before it falls in.
        const bow = vec3(0.0, 0.16, 0.22).mul(length(span)).mul(drawn.mul(float(1.0).sub(drawn)).mul(4.0));
        const wobble = vec3(mote.z.sub(0.5), mote.w.sub(0.5), 0.0).mul(0.03).mul(mote.y).mul(float(1.0).sub(drawn));
        const rel = from.xyz.add(span.mul(drawn)).add(bow).add(wobble).sub(u.camPos);
        return viewProjection(seenPoint(rel, beta).add(u.camPos));
    };
    const c1 = pathAt(k);
    const c0 = pathAt(k.sub(0.035));
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const trail = s1.sub(s0);
    const trailLen = length(trail);
    const dirS = trail.add(vec2(1e-4, 0.0)).div(max(trailLen, 1e-4));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const along = positionGeometry.x.add(0.5);
    const clip = mix(c0, c1, along);
    const flying = step(0.0, k).mul(step(k, 1.0)).mul(step(0.02, min(c0.w, c1.w)));
    // The head is a few pixels wide and the tail thins away behind it; it shrinks as it flies off.
    const widthPx = max(tint.w.mul(float(1.0).sub(mote.y.mul(0.8))).mul(0.034).div(max(clip.w, 0.2).mul(u.pixelAngle)), 1.4)
        .mul(flying);
    const lead = dirS.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    const material = svFxMaterial('StellarVelocityBolts');
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const tailFade = float(1.0).sub(mote.y);
    const arriving = float(1.0).sub(smoothstep(0.86, 1.0, k));
    const hot = step(mote.y, 0.04);
    const vLight = varying(
        mix(tint.rgb, vec3(1.0), hot.mul(0.6)).mul(tailFade.mul(tailFade).mul(2.4).add(hot.mul(5.0)))
            .mul(arriving.mul(0.8).add(0.2))
            .mul(flying)
            .mul(u.iris),
        'svBoltLight',
    );
    const vTrail = varying(trailLen.div(max(widthPx, 1.0)), 'svBoltTrail');
    const q = uv().sub(0.5).mul(2.0);
    const stretch = vTrail.mul(0.5).add(1.0);
    const endX = max(q.x.abs().mul(stretch).sub(stretch.sub(1.0)), 0.0);
    const r2 = endX.mul(endX).add(q.y.mul(q.y));
    material.colorNode = vec4(vLight.mul(exp(r2.mul(-3.2))).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2))), 0.0);

    const part = svPart('StellarVelocityBolts', geometry, material, 40);
    let cursor = 0;
    /**
     * Throw one: `from` and `to` are true world points, `rgb` its colour.
     * @param {{ from: number[], to: number[], rgb: number[], time: number, flight: number, size?: number }} bolt
     */
    part.launch = ({
        from: a, to: b, rgb, time, flight: seconds, size = 1,
    }) => {
        const slot = cursor % BOLT_SLOTS;
        cursor += 1;
        table[slot * 3].set(a[0], a[1], a[2], time);
        table[slot * 3 + 1].set(b[0], b[1], b[2], seconds);
        table[slot * 3 + 2].set(rgb[0], rgb[1], rgb[2], size);
        return slot;
    };
    part.reset = () => {
        cursor = 0;
        for (let i = 0; i < BOLT_SLOTS; i++) table[i * 3].set(0, 0, 0, -100);
    };
    part.table = table;
    return part;
}

// ── Row jets ────────────────────────────────────────────────────────────────────

/** How far (screen heights) a jet reaches. */
export const JET_REACH = 0.3;

/** @param {object} u */
export function createRowJets(u) {
    const aJet = new Float32Array(JET_SLOTS);
    for (let i = 0; i < JET_SLOTS; i++) aJet[i] = i;
    const geometry = svQuadGeometry(JET_SLOTS, { aJet: [aJet, 1] });
    // Two rows a jet: (where it leaves the card, UV y down; birth; strength), (colour, _).
    const table = Array.from({ length: JET_SLOTS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
    const rows = uniformArray(table, 'vec4');
    const base = int(attribute('aJet', 'float').add(0.5)).mul(2);
    const A = rows.element(base);
    const C = rows.element(base.add(1));
    const age = u.time.sub(A.z);
    const k = clamp(age.div(JET_LIFE), 0.0, 1.0);
    const live = step(0.0, age).mul(step(age, JET_LIFE)).mul(step(1e-3, A.w));
    // Screen heights, y up: the way from where it leaves to the sun.
    const aspect = u.viewport.x.div(u.viewport.y);
    const start = vec2(A.x.mul(aspect), float(1.0).sub(A.y));
    const sun = vec2(u.sunUv.x.mul(aspect), float(1.0).sub(u.sunUv.y));
    const way = sun.sub(start);
    const far = max(length(way), 1e-3);
    const dir = way.div(far);
    const side = vec2(dir.y.negate(), dir.x);
    // The jet runs out fast and its light runs along it after.
    const reach = min(float(JET_REACH).mul(float(1.0).sub(exp(k.mul(-7.0)))), far.mul(0.9));
    const along = positionGeometry.x.add(0.5);
    const widthPx = float(5.0).mul(A.w).mul(live);
    const at = start.add(dir.mul(along.mul(reach))).add(side.mul(positionGeometry.y.mul(2.0).mul(widthPx).div(u.viewport.y)));
    const material = svFxMaterial('StellarVelocityRowJets');
    material.vertexNode = vec4(at.x.div(aspect).mul(2.0).sub(1.0), at.y.mul(2.0).sub(1.0), 1.0, 1.0);
    const vLight = varying(C.rgb.mul(A.w).mul(float(1.0).sub(k)).mul(float(1.0).sub(k)).mul(live)
        .mul(u.iris), 'svJetLight');
    const vAge = varying(k, 'svJetAge');
    const st = uv();
    const q = clamp(st.y.sub(0.5).mul(2.0), -1.0, 1.0);
    // It tapers to a point, and a bright bead runs out along it.
    const taper = float(1.0).sub(st.x);
    const across = exp(q.mul(q).div(max(taper.mul(taper), 0.02)).mul(-3.5));
    const bead = exp(st.x.sub(vAge.mul(1.6)).mul(st.x.sub(vAge.mul(1.6))).mul(-60.0)).mul(2.2);
    const root = smoothstep(0.0, 0.06, st.x);
    material.colorNode = vec4(vLight.mul(across).mul(taper.mul(1.2).add(bead)).mul(root), 0.0);

    const part = svPart('StellarVelocityRowJets', geometry, material, 45);
    let cursor = 0;
    /**
     * Fire one jet per point. `points` are where the rows leave the card (UV, y down).
     * @param {{ x: number, y: number }[]} points
     */
    part.fire = (points, rgb, time, strength = 1) => {
        for (let i = 0; i < points.length && i < 4; i++) {
            const slot = cursor % JET_SLOTS;
            cursor += 1;
            table[slot * 2].set(points[i].x, points[i].y, time + i * 0.03, strength);
            table[slot * 2 + 1].set(rgb[0], rgb[1], rgb[2], 0);
        }
    };
    part.reset = () => {
        cursor = 0;
        for (let i = 0; i < JET_SLOTS; i++) table[i * 2].set(0, 0, -100, 0);
    };
    part.table = table;
    return part;
}
