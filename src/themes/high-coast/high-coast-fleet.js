/**
 * High Coast — the sailing fleet.
 *
 * Sailboats reach round loops of open water on both sides of the card (each loop checked against
 * the baked sea floor), at a constant pace (their place is a closed form of the clock). A lock
 * sets a SPINNAKER in the piece's colour on a boat on its side of the board: it pops open, glows
 * where the low sun shines through it, holds while locks keep feeding it and is doused a while
 * after the last; the boat surges and its wake whitens. A lock that reaches a sail already flying
 * never douses it to set it again: it fills again from where it stands, its puff adds to the
 * boat's surge, and its colour turns toward the new piece's. In hot play every boat whose sail is
 * down sets one, and the sails burn in the low sun (u.heat.z). A T-spin brings the whole fleet
 * about from where its heel stands: every sail swings across and the boats heel the other way.
 * The boats ride the sea's level, so they sink with it as the land rises.
 *
 * Instanced: hulls and their rigs are one mesh (a part attribute tells hull, mast and sails apart),
 * spinnakers another (per-boat colour and how far each is set), wakes a third.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    exp,
    float,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    uv,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EYE, TIMING, bearingOf, clamp as clampJs, mulberry32, smooth,
} from './high-coast-core.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import { flatVarying } from '../shared/flat-varying.js';

/** The loops (centre x, z, radii, yaw), checked against the bake (all water, bearings in frame). */
export const LANES = Object.freeze([
    Object.freeze([-120, -560, 60, 40, 0.2]),
    Object.freeze([330, -640, 40, 30, 0.4]),
    Object.freeze([-200, -700, 50, 80, 0]),
    Object.freeze([240, -880, 100, 70, 0.1]),
    Object.freeze([-280, -900, 45, 240, 0]),
    Object.freeze([360, -760, 90, 60, 0.3]),
    Object.freeze([-250, -1500, 70, 220, 0.2]),
    Object.freeze([950, -1950, 140, 90, 0]),
]);
/** Boat speed (metres a second) and size (hull length; the rig scales with it). */
export const BOAT = Object.freeze({ speed: 3.2, length: 10 });

/** A boat's place on its loop at time t: { x, z, heading (radians, 0 = −z), side } (closed form). */
export function boatPlace(lane, phase, t, out = {}) {
    const [cx, cz, rx, rz, yaw] = lane;
    const mean = (rx + rz) / 2;
    const a = phase + (t * BOAT.speed) / mean;
    const lx = Math.cos(a) * rx;
    const lz = Math.sin(a) * rz;
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    out.x = cx + ca * lx - sa * lz;
    out.z = cz + sa * lx + ca * lz;
    // The tangent (direction of travel).
    const tx = -Math.sin(a) * rx;
    const tz = Math.cos(a) * rz;
    const dx = ca * tx - sa * tz;
    const dz = sa * tx + ca * tz;
    out.heading = Math.atan2(dx, -dz);
    out.side = bearingOf(out.x, out.z).bearing < 0 ? -1 : 1;
    return out;
}

function mergeParts(parts) {
    const pos = [];
    const nrm = [];
    const part = [];
    const st = [];
    for (const [geo, id] of parts) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        pos.push(...g.attributes.position.array);
        nrm.push(...g.attributes.normal.array);
        const uvs = g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2);
        st.push(...uvs);
        for (let i = 0; i < g.attributes.position.count; i++) part.push(id);
        if (g !== geo) g.dispose();
        geo.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(st, 2));
    out.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    return out;
}

/** A sail: a triangle (three points) with a gentle belly, as a small grid. */
function sailGeometry(a, b, c, belly = 0.4, n = 6) {
    const pos = [];
    const st = [];
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const C = new THREE.Vector3(...c);
    const normal = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
    const point = (i, j) => {
        // Barycentric grid over the triangle; the belly is largest in its middle.
        const u = i / n;
        const v = j / n;
        const p = A.clone().lerp(B, u).lerp(C, v * 1);
        const w = u * (1 - u) * (1 - v) * 4;
        return p.addScaledVector(normal, belly * w);
    };
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n - i; j++) {
            const p00 = point(i, j);
            const p10 = point(i + 1, j);
            const p01 = point(i, j + 1);
            pos.push(...p00.toArray(), ...p10.toArray(), ...p01.toArray());
            st.push(i / n, j / n, (i + 1) / n, j / n, i / n, (j + 1) / n);
            if (j < n - i - 1) {
                const p11 = point(i + 1, j + 1);
                pos.push(...p10.toArray(), ...p11.toArray(), ...p01.toArray());
                st.push((i + 1) / n, j / n, (i + 1) / n, (j + 1) / n, i / n, (j + 1) / n);
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(st, 2));
    g.computeVertexNormals();
    return g;
}

/** A boat (bow toward −z, unit scale = metres; length 10): hull, deck house, mast, main, jib. */
export function boatGeometry() {
    const hull = new THREE.Shape();
    hull.moveTo(-1.5, 4.2);
    hull.quadraticCurveTo(-1.7, 0.5, -0.9, -3.6);
    hull.lineTo(0, -5.0);
    hull.lineTo(0.9, -3.6);
    hull.quadraticCurveTo(1.7, 0.5, 1.5, 4.2);
    hull.lineTo(-1.5, 4.2);
    const hullGeo = new THREE.ExtrudeGeometry(hull, { depth: 1.1, bevelEnabled: false });
    // The shape lies in x-y; turn it so y becomes −z (bow forward) and the depth goes down.
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.translate(0, 0.75, 0);
    const house = new THREE.BoxGeometry(1.6, 0.6, 2.6);
    house.translate(0, 1.0, 0.8);
    const mast = new THREE.CylinderGeometry(0.06, 0.08, 13, 5);
    mast.translate(0, 7.2, -0.6);
    // Main: luff up the mast, foot along the boom, leech back to the head (starboard by default).
    const main = sailGeometry([0.05, 1.6, -0.5], [0.05, 13.4, -0.6], [0.05, 1.7, 3.9], 0.5);
    const jib = sailGeometry([0.05, 1.2, -4.8], [0.05, 11.6, -0.75], [0.05, 1.3, -0.9], 0.45);
    return mergeParts([[hullGeo, 0], [house, 1], [mast, 2], [main, 3], [jib, 3]]);
}

/** The spinnaker: a balloon sail ahead of the mast (unit set; scaled down to nothing when doused). */
export function spinnakerGeometry() {
    const pos = [];
    const st = [];
    const rows = 10;
    const cols = 12;
    const point = (i, j) => {
        const v = i / rows;
        const u = j / cols;
        const width = Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.7 * 5.2 * (0.35 + 0.65 * v) + 0.15;
        const x = (u - 0.5) * width;
        const y = 1.4 + v * 12.2;
        const bulge = Math.cos((u - 0.5) * Math.PI) * Math.sin(Math.PI * Math.min(1, v * 1.02)) * 3.2;
        const z = -1.0 - 3.4 * v ** 0.6 - bulge;
        return [x, y, z];
    };
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const a = point(i, j);
            const b = point(i, j + 1);
            const c = point(i + 1, j);
            const d = point(i + 1, j + 1);
            pos.push(...a, ...c, ...b, ...b, ...c, ...d);
            st.push(j / cols, i / rows, j / cols, (i + 1) / rows, (j + 1) / cols, i / rows);
            st.push((j + 1) / cols, i / rows, j / cols, (i + 1) / rows, (j + 1) / cols, (i + 1) / rows);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(st, 2));
    g.computeVertexNormals();
    return g;
}

function boatMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'HighCoastBoats';
    material.fog = false;
    // Flat: the part is tested for equality, which an interpolated value fails here and there.
    const part = flatVarying(attribute('aPart', 'float'), 'vBoatPart');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const hull = mix(vec3(0.62, 0.62, 0.6), vec3(0.03, 0.06, 0.12), smoothstep(0.55, 0.45, positionLocal.y));
        const wood = vec3(0.32, 0.22, 0.13);
        const sail = vec3(0.78, 0.76, 0.7);
        const albedo = mix(mix(mix(hull, wood, part.equal(1.0).select(1.0, 0.0)), vec3(0.6, 0.6, 0.58), part.equal(2.0).select(1.0, 0.0)), sail, part.equal(3.0).select(1.0, 0.0));
        const L = u.sunDir;
        const view = normalize(P.sub(u.eye));
        // Sails are thin: lit from either side, glowing where the sun shines through them.
        const facing = dot(n, L).abs();
        const through = clamp(dot(view, L), 0.0, 1.0).pow(3.0).mul(part.equal(3.0).select(0.8, 0.0));
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(facing.mul(0.75).add(through)).mul(shadow).mul(u.sunUp).add(u.fill.mul(0.9))
            .add(u.bounce.mul(0.4))).toVar();
        // Running lights when the sun is low: the masthead.
        lit.addAssign(vec3(2.4, 2.2, 1.6).mul(smoothstep(12.9, 13.1, positionLocal.y)).mul(u.lamps));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

function spinnakerMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'HighCoastSpinnakers';
    material.fog = false;
    const sail = attribute('aSail', 'vec4');
    // A sail being set fills and shivers (amplitude from how fresh it is; pace constant).
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const fill = sail.w;
        const luff = sin(u.time.mul(9.0).add(p.y.mul(1.3))).mul(0.12).mul(float(1.0).sub(fill).mul(fill).mul(4.0));
        return vec3(p.x, p.y, p.z.add(luff));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const st = uv();
        // Panels: horizontal seams, a lighter head and foot band.
        const seam = smoothstep(0.86, 0.95, st.y.mul(7.0).fract()).mul(0.2);
        const albedo = sail.xyz.mul(float(1.0).sub(seam));
        const L = u.sunDir;
        const view = normalize(P.sub(u.eye));
        const facing = dot(n, L).abs();
        // The low sun through coloured nylon: the sail glows in its own colour (and, as play runs
        // hot, every sail in the bay burns with it: u.heat.z).
        const through = clamp(dot(view, L), 0.0, 1.0).pow(2.0).mul(1.4).add(u.heat.z);
        const shadow = shadowAt(t.shadow, P.xz);
        const lit = albedo.mul(u.sun.mul(facing.mul(0.7).add(through)).mul(shadow).mul(u.sunUp).add(u.fill.mul(1.1))
            .add(u.bounce.mul(0.5)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

function wakeMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.name = 'HighCoastWakes';
    material.fog = false;
    const wake = attribute('aWake', 'vec4');
    material.colorNode = Fn(() => {
        const st = uv();
        // A V spreading behind the boat: two arms and a churned centre line, fading aft.
        const x = st.x.sub(0.5).mul(2.0);
        // The plane's v runs from its aft end (0) to the boat (1): distance aft is 1 − v.
        const y = float(1.0).sub(st.y);
        const arm = exp(x.abs().sub(y.mul(0.85)).mul(x.abs().sub(y.mul(0.85))).mul(-260.0));
        const centre = exp(x.mul(x).mul(-90.0)).mul(float(1.0).sub(y).mul(0.8));
        const fade = float(1.0).sub(smoothstep(0.2, 1.0, y));
        const foam = max(arm, centre).mul(fade).mul(wake.x);
        const colour = u.fill.mul(1.4).add(u.sun.mul(0.18).mul(u.sunUp));
        return vec4(aerial(u, positionWorld, colour), clamp(foam, 0.0, 0.85));
    })();
    return material;
}

/** The spinnaker filling: it pops open (overshooting) over its first second (`age` since set). */
export function spinnakerRise(age) {
    if (!(age >= 0)) return 0;
    return clampJs(1.12 * smooth(0, 0.45, age) - 0.12 * smooth(0.45, 1.1, age), 0, 1.12);
}

/** How far a spinnaker stands: filling since `setAt`, doused TIMING.spinnaker after its last lock `fedAt`. */
export function spinnakerOpen(boat, time) {
    return spinnakerRise(time - boat.setAt) * (1 - smooth(TIMING.spinnaker, TIMING.spinnaker + 2.2, time - boat.fedAt));
}

/** The inverse of smooth(0, 1, x) on [0, 1]. */
const unsmooth = (v) => 0.5 - Math.sin(Math.asin(1 - 2 * clampJs(v, 0, 1)) / 3);
/** A sail this far set counts as down: a new lock may set it fresh. */
const DOWN = 0.02;
/** A sail turning to a new piece's colour takes this long (seconds). */
const RECOLOUR = 0.8;
/** A lock's puff in a flying sail: how hard (a hard drop more), and how fast it eases (seconds). */
const PUFF = Object.freeze({
    soft: 0.3, hard: 0.6, cap: 1.2, release: 2.5,
});

export function createFleet(u, t, tier) {
    const count = [4, 6, 8][Math.min(2, Math.max(0, tier.props))];
    const lanes = LANES.slice(0, count);
    const random = mulberry32(0xf1ee7);
    const boats = lanes.map((lane) => ({
        lane,
        phase: random() * Math.PI * 2,
        scale: 1.45 + random() * 0.3,
        /** The piece colour the sail turns to, and the colour it turns from since `blendAt`. */
        colour: [1, 1, 1],
        from: [1, 1, 1],
        blendAt: -1e6,
        /** When the sail began to fill, and when a lock last fed it (the hold counts from there). */
        setAt: -1e6,
        fedAt: -1e6,
        hard: 0,
        /** The locks' puffs in the sail (a decaying sum: each feed adds, never restarts). */
        puff: 0,
        puffAt: -1e6,
        place: {},
    }));
    const shown = [0, 0, 0];
    /** The sail's colour at `time`: turning from `from` to `colour`. */
    const colourAt = (b, time, out = shown) => {
        const k = smooth(0, RECOLOUR, time - b.blendAt);
        for (let c = 0; c < 3; c++) out[c] = b.from[c] + (b.colour[c] - b.from[c]) * k;
        return out;
    };
    const puffAt = (b, time) => (time >= b.puffAt ? b.puff * Math.exp(-(time - b.puffAt) / PUFF.release) : b.puff);
    /**
     * A lock reaches a boat's sail. A sail that is down is set fresh in the piece's colour; one
     * already flying is never doused to be set again: it fills again from where it stands, its hold
     * starts over, and its colour turns toward the new piece's.
     */
    const feed = (b, rgb, time, hard) => {
        const open = spinnakerOpen(b, time);
        if (open < DOWN) {
            b.setAt = time;
            b.blendAt = -1e6;
            for (let c = 0; c < 3; c++) {
                b.colour[c] = rgb[c];
                b.from[c] = rgb[c];
            }
            b.hard = hard ? 1 : 0;
        } else {
            colourAt(b, time, b.from);
            for (let c = 0; c < 3; c++) b.colour[c] = rgb[c];
            b.blendAt = time;
            // Being doused: it fills again from where it stands (the same rise, met part-way).
            if (time - b.setAt > 1.1 && open < 0.999) b.setAt = time - 0.45 * unsmooth(Math.min(1, open / 1.12));
            b.hard = Math.max(b.hard, hard ? 1 : 0);
        }
        b.fedAt = time;
        b.puff = Math.min(PUFF.cap, puffAt(b, time) + (hard ? PUFF.hard : PUFF.soft));
        b.puffAt = time;
    };
    /** Of `boats` (on `side`, or any when side is 0): a sail that is down first (the one down longest), else the stalest flying one. */
    const pick = (side, time, downOnly = false) => {
        let down = null;
        let flying = null;
        for (const b of boats) {
            boatPlace(b.lane, b.phase, time, b.place);
            if (side !== 0 && b.place.side !== side) continue;
            if (spinnakerOpen(b, time) < DOWN) {
                if (!down || b.fedAt < down.fedAt) down = b;
            } else if (!flying || b.fedAt < flying.fedAt) flying = b;
        }
        return downOnly ? down : down || flying;
    };
    const boatGeo = boatGeometry();
    const boatMat = boatMaterial(u, t);
    const hulls = new THREE.InstancedMesh(boatGeo, boatMat, count);
    hulls.name = 'HighCoastBoats';
    const sailGeo = spinnakerGeometry();
    const sailData = new Float32Array(count * 4);
    const sailAttr = new THREE.InstancedBufferAttribute(sailData, 4);
    sailGeo.setAttribute('aSail', sailAttr);
    const sailMat = spinnakerMaterial(u, t);
    const sails = new THREE.InstancedMesh(sailGeo, sailMat, count);
    sails.name = 'HighCoastSpinnakers';
    const wakeGeo = new THREE.PlaneGeometry(1, 1);
    wakeGeo.rotateX(-Math.PI / 2);
    wakeGeo.translate(0, 0, 0.5);
    const wakeData = new Float32Array(count * 4);
    const wakeAttr = new THREE.InstancedBufferAttribute(wakeData, 4);
    wakeGeo.setAttribute('aWake', wakeAttr);
    const wakeMat = wakeMaterial(u);
    const wakes = new THREE.InstancedMesh(wakeGeo, wakeMat, count);
    wakes.name = 'HighCoastWakes';
    for (const mesh of [hulls, sails, wakes]) {
        mesh.frustumCulled = false;
        mesh.renderOrder = mesh === wakes ? 5 : 2;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    sailAttr.setUsage(THREE.DynamicDrawUsage);
    wakeAttr.setUsage(THREE.DynamicDrawUsage);

    const state = {
        tackAt: -1e6, side: 1, sideFrom: 1, swingFrom: 0, swingAt: -1e6, amount: 1,
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    /** Where the fleet's heel stands between the two tacks at `time` (−1 … 1). */
    const tackSideAt = (time) => state.sideFrom
        + (state.side - state.sideFrom) * smooth(0, TIMING.tack, time - state.tackAt);
    /** How far the sails stand swung through the light at `time` (a re-tack carries the last swing on). */
    const swingAt = (time) => {
        const k = smooth(0, TIMING.tack, time - state.tackAt);
        const own = state.tackAt > -1e5 ? Math.sin(Math.PI * k) * state.amount : 0;
        const carried = state.swingFrom * (1 - smooth(0, TIMING.tack * 0.6, time - state.swingAt));
        return Math.min(1.2, own + carried);
    };

    const part = {
        mesh: hulls,
        meshes: [hulls, sails, wakes],
        boats,
        reset() {
            state.tackAt = -1e6;
            state.side = 1;
            state.sideFrom = 1;
            state.swingFrom = 0;
            state.swingAt = -1e6;
            state.amount = 1;
            for (const b of boats) {
                b.setAt = -1e6;
                b.fedAt = -1e6;
                b.blendAt = -1e6;
                b.hard = 0;
                b.puff = 0;
                b.puffAt = -1e6;
            }
        },
        /**
         * A lock on `side` (−1 left of the card, 1 right) reaches a boat there: a sail that is down
         * is set in the piece's colour, or (every sail there flying) the stalest one fills again and
         * turns toward it. Returns the boat's place.
         */
        setSpinnaker(side, rgb, time, hard = false) {
            const best = pick(side, time) || pick(0, time);
            feed(best, rgb, time, hard);
            boatPlace(best.lane, best.phase, time, best.place);
            return best.place;
        },
        /** Hot play: a boat whose sail is down anywhere in the bay sets one too (none down: nothing). */
        setSpare(rgb, time) {
            const spare = pick(0, time, true);
            if (spare) feed(spare, rgb, time, false);
            return spare ? spare.place : null;
        },
        /**
         * T-spin: every boat comes about, from where its heel stands now (a second T-spin mid-tack
         * turns them back from there; the sails' swing carries on). `amount` scales the swing.
         */
        tack(time, amount = 1) {
            state.swingFrom = swingAt(time);
            state.swingAt = time;
            state.sideFrom = tackSideAt(time);
            state.side = -state.side;
            state.tackAt = time;
            state.amount = amount;
        },
        update(time, dt, world) {
            const sea = world ? world.u.sea.value : 0;
            const breeze = world ? world.u.breeze.value : 1;
            const tackSide = tackSideAt(time);
            const swing = swingAt(time);
            boats.forEach((b, i) => {
                const p = boatPlace(b.lane, b.phase, time, b.place);
                // The spinnaker pops open (overshooting), holds while locks feed it, then is doused.
                const open = spinnakerOpen(b, time);
                const surge = open * (1 + b.hard * 0.6 + puffAt(b, time));
                const heel = (0.16 + 0.08 * breeze + 0.06 * surge) * tackSide;
                // Bow along the heading (the geometry's bow is −z; a turn by −heading points it there).
                e.set(0, -p.heading + swing * 0.5, heel * Math.cos(swing * 0.5), 'YXZ');
                q.setFromEuler(e);
                const s = b.scale;
                sc.set(s, s, s);
                pos.set(p.x, sea - 0.15, p.z);
                m.compose(pos, q, sc);
                hulls.setMatrixAt(i, m);
                const set = Math.max(0.0001, open);
                sc.set(s * set, s * set, s * set);
                m.compose(pos, q, sc);
                sails.setMatrixAt(i, m);
                const c = colourAt(b, time);
                sailData.set([c[0], c[1], c[2], clampJs(open, 0, 1)], i * 4);
                // The wake: longer and whiter while the spinnaker pulls.
                const length = 26 + 30 * surge;
                sc.set(9 * s + 6 * surge, 1, length);
                m.compose(pos.set(p.x, sea + 0.05, p.z), q, sc);
                wakes.setMatrixAt(i, m);
                wakeData.set([0.35 + 0.5 * surge, 0, 0, 0], i * 4);
            });
            hulls.instanceMatrix.needsUpdate = true;
            sails.instanceMatrix.needsUpdate = true;
            wakes.instanceMatrix.needsUpdate = true;
            sailAttr.needsUpdate = true;
            wakeAttr.needsUpdate = true;
        },
        getState() {
            return {
                boats: boats.length,
                set: boats.filter((b) => b.setAt > -1e5).length,
                side: state.side,
            };
        },
        exportState() {
            return {
                tackAt: state.tackAt,
                side: state.side,
                sideFrom: state.sideFrom,
                swingFrom: state.swingFrom,
                swingAt: state.swingAt,
                amount: state.amount,
                boats: boats.map((b) => ({
                    colour: b.colour.slice(),
                    from: b.from.slice(),
                    blendAt: b.blendAt,
                    setAt: b.setAt,
                    fedAt: b.fedAt,
                    hard: b.hard,
                    puff: b.puff,
                    puffAt: b.puffAt,
                })),
            };
        },
        importState(s) {
            if (!s) return;
            const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
            state.tackAt = s.tackAt;
            state.side = s.side;
            state.sideFrom = s.sideFrom;
            state.swingFrom = num(s.swingFrom, 0);
            state.swingAt = num(s.swingAt, -1e6);
            state.amount = num(s.amount, 1);
            s.boats?.forEach((saved, i) => {
                const b = boats[i];
                if (!b) return;
                b.colour = saved.colour.slice();
                b.from = Array.isArray(saved.from) ? saved.from.slice() : saved.colour.slice();
                b.blendAt = num(saved.blendAt, -1e6);
                b.setAt = saved.setAt;
                // An older save held the sail from when it was set.
                b.fedAt = num(saved.fedAt, saved.setAt);
                b.hard = saved.hard;
                b.puff = num(saved.puff, 0);
                b.puffAt = num(saved.puffAt, -1e6);
            });
        },
        dispose() {
            boatGeo.dispose();
            boatMat.dispose();
            sailGeo.dispose();
            sailMat.dispose();
            wakeGeo.dispose();
            wakeMat.dispose();
            for (const mesh of [hulls, sails, wakes]) mesh.dispose?.();
        },
    };
    part.update(0, 0, null);
    return part;
}

export { EYE, texture };
