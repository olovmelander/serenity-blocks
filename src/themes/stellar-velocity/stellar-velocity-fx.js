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
 *    A clear's comets are bolts too: each cleared row leaves its card and flies into the sun.
 *  - Shock rings: a hard drop's slam and a chain's gear change, thin rings that burst outward.
 *  - The twist's double helix: two strands of light that grow out of the sun toward us.
 *  - The young stars in the walls (the nursery): points of white-hot light with a halo.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    atan,
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
    BOLT_SLOTS, BOLT_TAIL, HELIX_FAR, HELIX_LIFE, HELIX_NEAR, HELIX_SEGMENTS, HELIX_SLOTS, HELIX_SPEED,
    HOOP_SEGMENTS, HOOP_SLOTS, SHOCK_SEGMENTS, SHOCK_SLOTS, TAU,
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
    // Four rows a bolt: (where it leaves, when), (where it lands, seconds of flight),
    // (colour, size), (how far its path bows, _, _, _).
    const table = Array.from({ length: BOLT_SLOTS * 4 }, () => new THREE.Vector4(0, 0, 0, -100));
    const rows = uniformArray(table, 'vec4');
    const base = int(mote.x.add(0.5)).mul(4);
    const from = rows.element(base);
    const to = rows.element(base.add(1));
    const tint = rows.element(base.add(2));
    const shape = rows.element(base.add(3));
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
        // The arc bows up and toward us before it falls in (a comet's long flight into the sun
        // bows far less for its length).
        const bow = vec3(0.0, 0.16, 0.22).mul(length(span)).mul(shape.x).mul(drawn.mul(float(1.0).sub(drawn)).mul(4.0));
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
        from: a, to: b, rgb, time, flight: seconds, size = 1, bow = 1,
    }) => {
        const slot = cursor % BOLT_SLOTS;
        cursor += 1;
        table[slot * 4].set(a[0], a[1], a[2], time);
        table[slot * 4 + 1].set(b[0], b[1], b[2], seconds);
        table[slot * 4 + 2].set(rgb[0], rgb[1], rgb[2], size);
        table[slot * 4 + 3].set(bow, 0, 0, 0);
        return slot;
    };
    part.reset = () => {
        cursor = 0;
        for (let i = 0; i < BOLT_SLOTS; i++) table[i * 4].set(0, 0, 0, -100);
    };
    part.table = table;
    return part;
}

// ── Shock rings ─────────────────────────────────────────────────────────────────

/**
 * Thin rings of white-hot light standing round the course that burst outward and are gone in
 * under a second: a hard drop's slam where its hoop opens, a chain's gear change ahead of us.
 * The world animates their radius and light; one row pair each: (depth, radius, light,
 * thickness) + (colour, _).
 * @param {object} u
 */
export function createShocks(u) {
    const segments = SHOCK_SEGMENTS;
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
    geometry.instanceCount = SHOCK_SLOTS;
    const table = Array.from({ length: SHOCK_SLOTS * 2 }, () => new THREE.Vector4(0, 0, 0, 1));
    const rows = uniformArray(table, 'vec4');
    const row = int(instanceIndex).mul(2);
    const A = rows.element(row);
    const C = rows.element(row.add(1));
    const beta = u.warp.mul(COURSE_WARP);
    const ringAt = (ang) => {
        const wound = ang.add(u.twist.mul(A.x));
        const rel = vec3(cos(wound).mul(A.y), sin(wound).mul(A.y), A.x.negate()).sub(u.camPos);
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
    const corePx = clamp(A.y.mul(0.018).mul(A.w).div(max(c0.w, 0.05).mul(u.pixelAngle)), 1.2, 22.0);
    const lit = step(1e-3, A.z).mul(step(0.03, c0.w));
    const widthPx = corePx.mul(5.0).mul(lit);
    const material = svFxMaterial('StellarVelocityShocks');
    material.vertexNode = vec4(
        c0.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(c0.w)),
        c0.z,
        c0.w,
    );
    const vLight = varying(C.rgb.mul(A.z).mul(u.iris).mul(u.breath).mul(float(1.0).sub(u.jump.mul(0.9))), 'svShockLight');
    const q = clamp(uv().y.sub(0.5).mul(2.0), -1.0, 1.0).mul(5.0);
    // A white-hot hairline in a sheath of its own colour; brighter knots run round it.
    const core = exp(q.mul(q).mul(-1.4));
    const sheath = exp(q.abs().mul(-0.9)).mul(0.35);
    const knots = u.fbmLod(vec2(uv().x.mul(9.0), C.w), 0).g.mul(0.8).add(0.6);
    const white = mix(vLight, vec3(svHoopPeak(vLight)), core.mul(0.55));
    material.colorNode = vec4(white.mul(core.mul(knots).add(sheath)), 0.0);
    const part = svPart('StellarVelocityShocks', geometry, material, 22);
    part.table = table;
    return part;
}

// ── The twist's double helix ─────────────────────────────────────────────────────

/**
 * A T-spin winds two strands of light round the course: they grow out of the sun toward us,
 * turning as they come (the other way for a spin the other way), and stand for two seconds.
 * Two instances a helix. One row pair each: (birth, way it turns, light, phase) + (colour, _).
 * @param {object} u
 */
export function createHelix(u) {
    const segments = HELIX_SEGMENTS;
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
    geometry.instanceCount = HELIX_SLOTS * 2;
    const table = Array.from({ length: HELIX_SLOTS * 2 }, () => new THREE.Vector4(-100, 1, 0, 0));
    const rows = uniformArray(table, 'vec4');
    const inst = int(instanceIndex);
    const slot = inst.div(2);
    const strand = float(inst.sub(slot.mul(2)));
    const A = rows.element(slot.mul(2));
    const C = rows.element(slot.mul(2).add(1));
    const age = u.time.sub(A.x);
    const beta = u.warp.mul(COURSE_WARP);
    // Where the helix has grown to (depth): it leaves the sun and comes toward us.
    const head = float(HELIX_FAR).sub(age.mul(HELIX_SPEED));
    const strandAt = (k) => {
        const depth = mix(float(HELIX_FAR), float(HELIX_NEAR), k);
        const turn = A.w.add(strand.mul(Math.PI)).add(A.y.mul(depth.mul(0.5).add(age.mul(2.4))))
            .add(u.twist.mul(depth));
        const radius = float(0.66).add(sin(depth.mul(0.9).add(A.w)).mul(0.07));
        const rel = vec3(cos(turn).mul(radius), sin(turn).mul(radius), depth.negate()).sub(u.camPos);
        return viewProjection(seenPoint(rel, beta).add(u.camPos));
    };
    const k = positionGeometry.x;
    const c0 = strandAt(k);
    const c1 = strandAt(k.add(1 / segments));
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const along = s1.sub(s0);
    const dirS = along.add(vec2(1e-4, 0.0)).div(max(length(along), 1e-4));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const depthHere = mix(float(HELIX_FAR), float(HELIX_NEAR), k);
    const grown = smoothstep(head.sub(0.4), head.add(1.6), depthHere);
    const life = smoothstep(0.0, 0.05, age).mul(float(1.0).sub(smoothstep(HELIX_LIFE * 0.55, HELIX_LIFE, age)));
    const live = step(1e-3, A.z).mul(step(0.03, c0.w)).mul(step(0.0, age)).mul(step(age, HELIX_LIFE));
    const corePx = clamp(float(0.02).div(max(c0.w, 0.05).mul(u.pixelAngle)), 1.2, 9.0);
    const widthPx = corePx.mul(4.0).mul(live).mul(step(0.01, grown));
    const material = svFxMaterial('StellarVelocityHelix');
    material.vertexNode = vec4(
        c0.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(c0.w)),
        c0.z,
        c0.w,
    );
    // Its growing tip burns white; the strand is the piece's colour, fading toward the sun.
    const tip = exp(depthHere.sub(head).mul(depthHere.sub(head)).mul(-0.5)).mul(step(0.0, head.add(1.0)));
    const fromSun = smoothstep(float(HELIX_FAR), float(HELIX_FAR * 0.45), depthHere).mul(0.8).add(0.2);
    const vLight = varying(
        C.rgb.mul(A.z.mul(life).mul(grown).mul(fromSun.add(tip.mul(2.5))))
            .mul(u.iris)
            .mul(u.breath)
            .mul(float(1.0).sub(u.jump.mul(0.92))),
        'svHelixLight',
    );
    const vTip = varying(tip, 'svHelixTip');
    const q = clamp(uv().y.sub(0.5).mul(2.0), -1.0, 1.0).mul(4.0);
    const core = exp(q.mul(q).mul(-1.6));
    const sheath = exp(q.abs().mul(-1.1)).mul(0.3);
    const white = mix(vLight, vec3(svHoopPeak(vLight)), core.mul(vTip.mul(0.6).add(0.25)));
    material.colorNode = vec4(white.mul(core.add(sheath)), 0.0);
    const part = svPart('StellarVelocityHelix', geometry, material, 24);
    part.table = table;
    return part;
}

// ── The young stars in the walls ────────────────────────────────────────────────

/**
 * The young stars burning inside the canyon's walls (the nursery): a white-hot point, a halo in
 * the colour of the gas it lights, and four short spikes. They come toward us with the cloud and
 * slide past; the gas in front of one dims it.
 * @param {object} u
 * @param {number} slots  rows of u.beacons: (true world position, light) + (colour of the gas it
 *                       lights, the light it casts on the gas)
 */
export function createBeacons(u, slots) {
    const aSlot = new Float32Array(slots);
    for (let i = 0; i < slots; i++) aSlot[i] = i;
    const geometry = svQuadGeometry(slots, { aSlot: [aSlot, 1] });
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(2);
    const A = u.beacons.element(base);
    const C = u.beacons.element(base.add(1));
    const beta = u.warp.mul(COURSE_WARP);
    const clip = viewProjection(seenPoint(A.xyz.sub(u.camPos), beta).add(u.camPos));
    const range = max(length(A.xyz.sub(u.camPos)), 0.05);
    // The halo is a fixed share of the frame near the lens and shrinks with distance; the core
    // never under a couple of pixels.
    const corePx = clamp(float(0.036).div(range.mul(u.pixelAngle)), 1.6, 7.0);
    const lit = step(1e-3, A.w).mul(step(0.05, clip.w));
    const halfPx = corePx.mul(9.0).mul(lit);
    const material = svFxMaterial('StellarVelocityBeacons');
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(2.0).mul(halfPx).div(u.viewport.mul(0.5)).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // The gas between us and it: the canyon's own target says how much of what is behind shows.
    const ndc = clip.xy.div(max(clip.w, 1e-3));
    const veil = u.canyonAt(vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)))).a;
    const shown = mix(veil, float(1.0), 0.45);
    const vLight = varying(A.w.mul(shown).mul(u.iris).mul(u.breath).mul(float(1.0).sub(u.jump.mul(0.95))), 'svBeaconLight');
    const vGas = varying(C.rgb, 'svBeaconGas');
    // Each turns its spikes its own way: by where it stands round the course (its row in the
    // table changes as the stars pass one another; its place does not).
    const vTilt = varying(atan(A.y, A.x).mul(1.7), 'svBeaconTilt');
    const q = uv().sub(0.5).mul(2.0);
    const r = length(q);
    // In core widths (the quad is 9 cores to a side from the middle).
    const rc = r.mul(9.0);
    const core = exp(rc.mul(rc).mul(-1.6));
    const halo = float(1.0).div(float(1.0).add(rc.mul(rc).mul(0.9))).mul(float(1.0).sub(smoothstep(0.55, 1.0, r)));
    const ca = cos(vTilt);
    const sa = sin(vTilt);
    const ax = q.x.mul(ca).add(q.y.mul(sa)).abs().mul(9.0);
    const ay = q.y.mul(ca).sub(q.x.mul(sa)).abs().mul(9.0);
    const spikes = exp(ay.mul(ay).mul(-9.0)).mul(exp(ax.mul(-0.55)))
        .add(exp(ax.mul(ax).mul(-9.0)).mul(exp(ay.mul(-0.55))))
        .mul(float(1.0).sub(smoothstep(0.6, 1.0, r)));
    const white = mix(vGas, vec3(1.0), 0.72);
    material.colorNode = vec4(
        white.mul(core.mul(5.0).add(spikes.mul(0.9))).add(vGas.mul(halo.mul(0.55))).mul(vLight),
        0.0,
    );
    return svPart('StellarVelocityBeacons', geometry, material, 15);
}
