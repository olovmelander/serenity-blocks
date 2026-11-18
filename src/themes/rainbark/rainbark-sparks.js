/**
 * Rainbark — the sparks: what a beat throws into the light.
 *
 * Bark that tears lets go of more than its strip: bark dust, pollen shaken from the crowns, beads
 * of sap. In this grove's light each of them is a point of gold. One instanced draw of soft specks,
 * a slot each, written when a beat spends them (SPARKS in the core; the world aims them):
 *
 *   a lock      a pinch of dust where the strip lets go
 *   a knock     a ring of dust shaken off the struck side of the trunk, thrown up it
 *   the Shed    sap beads and dust along each split ring
 *   the Moult   a storm of them down the lanes with the front
 *   a twist     a helix of specks winding up round the trunk the strip unwinds from
 *   a gap       pollen drifting down the new beam
 *   the Floor   slow lights rising from the floor
 *   the Climb   a veil of them hanging in the air the walkway rises through
 *
 * A speck's whole flight is closed form in the clock: it leaves its origin at its velocity, slowed
 * by the air (SPARKS.drag), sinking or rising (its own gravity), optionally winding round a pivot
 * (a trunk's axis), fading in fast and out slowly, tumbling in and out of the light. A slot is one
 * speck for its whole life (never re-cut by a later beat: a new beat takes the slots whose specks
 * are spent, else those nearest their end), so nothing in flight ever jumps.
 *
 * Additive (vec4(rgb, 0)), depth-tested, out of the card's band. Every slot is drawn every frame
 * (a spent one has no size), so the first frame compiles the pipeline.
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
    dot,
    exp,
    float,
    length,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SPARKS,
    mulberry32,
    rbAirTransmittance,
    rbFxMaterial,
    rbPart,
} from './rainbark-tsl.js';

/** Floats per speck: (origin, t0) (velocity, life) (colour, pixels) (pivot x, pivot z, turn rate, gravity). */
export const SPARK_STRIDE = 16;
/** The sparks draw last among the additive effects. */
const SPARK_ORDER = 75;

/**
 * Where a speck stands `age` seconds into its flight (the vertex stage's CPU twin; tests and the
 * smoothness probe read it): out[0..2] its place, out[3] how lit it is (0 … 1, its fade).
 */
export function sparkAt(rec, offset, age, out = [0, 0, 0, 0]) {
    const life = rec[offset + 7];
    if (!(life > 0) || !(age >= 0) || age >= life) {
        out[0] = rec[offset];
        out[1] = rec[offset + 1];
        out[2] = rec[offset + 2];
        out[3] = 0;
        return out;
    }
    const k = SPARKS.drag;
    const reach = (1 - Math.exp(-k * age)) / k;
    let x = rec[offset] + rec[offset + 4] * reach;
    const y = rec[offset + 1] + rec[offset + 5] * reach - 0.5 * rec[offset + 15] * age * age;
    let z = rec[offset + 2] + rec[offset + 6] * reach;
    const turn = rec[offset + 14];
    if (turn !== 0) {
        const a = turn * reach;
        const rx = x - rec[offset + 12];
        const rz = z - rec[offset + 13];
        x = rec[offset + 12] + rx * Math.cos(a) - rz * Math.sin(a);
        z = rec[offset + 13] + rx * Math.sin(a) + rz * Math.cos(a);
    }
    const fin = Math.min(1, age / SPARKS.fadeIn);
    const f = Math.max(0, Math.min(1, (age / life - SPARKS.fadeOut) / (1 - SPARKS.fadeOut)));
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = fin * fin * (3 - 2 * fin) * (1 - f * f * (3 - 2 * f));
    return out;
}

function sparkMaterial(u) {
    const material = rbFxMaterial('RainbarkSparks');
    const aA = attribute('aSparkA', 'vec4');
    const aB = attribute('aSparkB', 'vec4');
    const aC = attribute('aSparkC', 'vec4');
    const aD = attribute('aSparkD', 'vec4');
    const vLight = varying(vec3(0.0), 'rbSparkLight');
    const vAt = varying(vec2(0.0), 'rbSparkAt');
    const S = SPARKS;
    material.positionNode = Fn(() => {
        const life = aB.w;
        const age = u.time.sub(aA.w).toVar();
        const live = step(0.0, age).mul(step(age, life)).mul(step(1e-4, life)).toVar();
        const a = clamp(age, 0.0, 600.0).toVar();
        const reach = float(1.0).sub(exp(a.mul(-S.drag))).div(S.drag).toVar();
        const flown = aA.xyz.add(aB.xyz.mul(reach)).sub(vec3(0.0, aD.w.mul(a).mul(a).mul(0.5), 0.0)).toVar();
        // Winding round its pivot (a trunk's axis), slowing as the air slows it.
        const turn = aD.z.mul(reach);
        const rel = flown.xz.sub(aD.xy).toVar();
        const c = cos(turn);
        const s = sin(turn);
        const P = vec3(
            aD.x.add(rel.x.mul(c)).sub(rel.y.mul(s)),
            flown.y,
            aD.y.add(rel.x.mul(s)).add(rel.y.mul(c)),
        ).toVar();
        const fin = smoothstep(0.0, S.fadeIn, a);
        const fout = float(1.0).sub(smoothstep(life.mul(S.fadeOut), life, a));
        // Tumbling in and out of the light, each on its own beat (its start salts it).
        const salt = aA.w.mul(7.31).add(aA.x.mul(3.7)).add(aA.z.mul(5.3));
        const tumble = sin(a.mul(mix(float(S.twinkle[0]), float(S.twinkle[1]), sin(salt).mul(0.5).add(0.5))).add(salt))
            .mul(S.flash * 0.5).add(1 - S.flash * 0.5);
        // Out of the card's band.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(P, 1.0)).toVar();
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const away = max(max(r.x.sub(scr.x), scr.x.sub(r.z)), max(r.y.sub(scr.y), scr.y.sub(r.w)));
        const keep = live.mul(smoothstep(0.0, S.card, away)).mul(step(0.0, clip.w)).toVar();
        const lit = fin.mul(fout).mul(tumble).mul(keep);
        vLight.assign(aC.xyz.mul(lit).mul(rbAirTransmittance(u, P)).mul(u.iris));
        vAt.assign(positionGeometry.xy);
        const dist = length(cameraPosition.sub(P));
        const angle = max(u.tanHalf.y.mul(2 / 1080).mul(aC.w), u.pixelAngle.mul(S.least));
        // (It shrinks as it goes out; a spent one has no size.)
        const half = dist.mul(angle).mul(fout.mul(0.4).add(0.6)).mul(step(0.001, keep));
        return P.add(u.camRight.mul(positionGeometry.x.mul(half))).add(u.camUp.mul(positionGeometry.y.mul(half)));
    })();
    material.colorNode = Fn(() => {
        const at = clamp(vAt, -1.0, 1.0);
        const d2 = dot(at, at);
        // A soft speck with a hot heart.
        const spot = exp(d2.mul(-4.5)).add(exp(d2.mul(-22.0)).mul(0.8));
        return vec4(max(vLight, vec3(0.0)).mul(spot), 0.0);
    })();
    return material;
}

/**
 * The sparks part.
 * @param {object} u      the shared uniforms
 * @param {number} count  speck slots (the tier's)
 */
export function createSparks(u, count) {
    const slots = Math.max(1, Math.round(count) || 1);
    const data = new Float32Array(slots * SPARK_STRIDE);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const buffer = new THREE.InstancedInterleavedBuffer(data, SPARK_STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSparkA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aSparkB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aSparkC', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geometry.setAttribute('aSparkD', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
    geometry.instanceCount = slots;
    const part = rbPart('RainbarkSparks', geometry, sparkMaterial(u), SPARK_ORDER);
    let cursor = 0;
    let spawned = 0;
    let dirty = true;

    /**
     * The slot a new speck at time t takes: the first spent one from the cursor on, else the one
     * nearest its end (a storm never cuts a speck just thrown while one nearly gone could make room).
     */
    const take = (t) => {
        let slot = -1;
        let soonest = Infinity;
        for (let k = 0; k < slots; k++) {
            const s = (cursor + k) % slots;
            const o = s * SPARK_STRIDE;
            const end = data[o + 7] > 0 ? data[o + 3] + data[o + 7] : -Infinity;
            if (end <= t) {
                slot = s;
                break;
            }
            if (end < soonest) {
                soonest = end;
                slot = s;
            }
            // (Looking past a handful of live slots costs more than the speck is worth.)
            if (k >= 24 && slot >= 0) break;
        }
        cursor = (slot + 1) % slots;
        return slot;
    };

    /**
     * Throw `n` specks at time t. `place(i, rng, rec)` writes one speck's 16 floats into `rec`
     * (origin xyz, start, velocity xyz, life, rgb, pixels, pivot x z, turn rate, gravity) and
     * returns false to skip it. Each speck's randomness comes from its own seeded stream (the count
     * of bursts so far and its index), so a replay throws the same specks.
     */
    const rec = new Float32Array(SPARK_STRIDE);
    part.emit = (t, n, place) => {
        const thrown = Math.max(0, Math.min(slots, Math.round(n) || 0));
        spawned += 1;
        for (let i = 0; i < thrown; i++) {
            const rng = mulberry32(((spawned * 2654435761) + i * 2246822519) >>> 0);
            rec.fill(0);
            if (place(i, rng, rec, thrown) === false) continue;
            if (!(rec[7] > 0)) continue;
            const slot = take(t);
            data.set(rec, slot * SPARK_STRIDE);
            dirty = true;
        }
    };

    // ── The shapes a beat throws (each one job object, reused: nothing is made at event time) ──

    const between = (range, r) => range[0] + (range[1] - range[0]) * r;
    /** A speck's light: `a` or, for a share `mix` of them, `b` (scene-linear), each a little its own. */
    const tint = (out, look, rng) => {
        const c = look.colorB && rng() < (look.mix ?? 0.5) ? look.colorB : look.color;
        const k = (look.gain ?? 1) * (0.7 + 0.6 * rng());
        out[8] = c[0] * k;
        out[9] = c[1] * k;
        out[10] = c[2] * k;
        out[11] = between(look.px, rng());
    };
    const job = {
        t: 0, at: null, look: null,
    };

    /**
     * A puff from a point: specks thrown round a direction (nx, ny, nz), `spread` of the way to
     * every direction, their origins scattered `jitter` metres, over `over` seconds.
     */
    const placePuff = (i, rng, out) => {
        const { at, look } = job;
        const a = rng() * Math.PI * 2;
        const zc = rng() * 2 - 1;
        const sr = Math.sqrt(Math.max(0, 1 - zc * zc));
        const s = at.spread ?? 0.6;
        let dx = (at.nx ?? 0) * (1 - s) + sr * Math.cos(a) * s;
        let dy = (at.ny ?? 0) * (1 - s) + zc * s;
        let dz = (at.nz ?? 0) * (1 - s) + sr * Math.sin(a) * s;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;
        const speed = between(look.speed, rng());
        const j = at.jitter ?? 0;
        out[0] = at.x + (rng() - 0.5) * j;
        out[1] = at.y + (rng() - 0.5) * (at.tall ?? j);
        out[2] = at.z + (rng() - 0.5) * j;
        out[3] = job.t + rng() * (look.over ?? 0);
        out[4] = dx * speed;
        out[5] = dy * speed + (look.up ?? 0) * rng();
        out[6] = dz * speed;
        out[7] = between(look.life, rng());
        tint(out, look, rng);
        out[15] = look.gravity ?? 0.6;
        return true;
    };
    part.puff = (t, n, at, look) => {
        job.t = t;
        job.at = at;
        job.look = look;
        part.emit(t, n, placePuff);
    };

    /**
     * A ring round a trunk: specks off its surface across an arc (from `thetaL` over `span` radians,
     * or `spread` either side of `theta`), within `halfH` of the height y, thrown outward.
     */
    const placeRing = (i, rng, out, thrown) => {
        const { at, look } = job;
        const f = thrown > 1 ? (i + rng() * 0.8 - 0.4) / (thrown - 1) : 0.5;
        const theta = at.span !== undefined
            ? at.thetaL + at.span * Math.max(0.03, Math.min(0.97, f))
            : at.theta + (f - 0.5) * 2 * at.spread;
        const ox = Math.cos(theta);
        const oz = Math.sin(theta);
        const speed = between(look.speed, rng());
        out[0] = at.axisX + ox * (at.radius + 0.05);
        out[1] = at.y + (rng() - 0.5) * 2 * (at.halfH ?? 0.1);
        out[2] = at.axisZ + oz * (at.radius + 0.05);
        out[3] = job.t + rng() * (look.over ?? 0.12) + (look.sweep ?? 0) * Math.max(0, Math.min(1, f));
        out[4] = ox * speed;
        out[5] = (look.up ?? 0) * (0.4 + 0.6 * rng()) + (rng() - 0.5) * speed * 0.5;
        out[6] = oz * speed;
        out[7] = between(look.life, rng());
        tint(out, look, rng);
        out[15] = look.gravity ?? 0.9;
        return true;
    };
    part.ring = (t, n, at, look) => {
        job.t = t;
        job.at = at;
        job.look = look;
        part.emit(t, n, placeRing);
    };

    /**
     * A helix round a trunk's axis: specks leaving its surface from yTop down to yBot as a strip
     * unwinds (over `over` seconds, top first), winding round the axis at `turn` radians a second
     * and rising.
     */
    const placeHelix = (i, rng, out, thrown) => {
        const { at, look } = job;
        const f = thrown > 1 ? i / (thrown - 1) : 0;
        const theta = at.theta + f * at.turns * Math.PI * 2 + (rng() - 0.5) * 0.5;
        const r = at.radius + 0.1 + 0.25 * rng();
        out[0] = at.axisX + Math.cos(theta) * r;
        out[1] = at.yTop + (at.yBot - at.yTop) * f + (rng() - 0.5) * 0.15;
        out[2] = at.axisZ + Math.sin(theta) * r;
        out[3] = job.t + f * (look.over ?? 1) + rng() * 0.08;
        // (A little outward, so the winding opens as it rises.)
        out[4] = Math.cos(theta) * 0.35;
        out[5] = look.rise * (0.6 + 0.8 * rng());
        out[6] = Math.sin(theta) * 0.35;
        out[7] = between(look.life, rng());
        tint(out, look, rng);
        out[12] = at.axisX;
        out[13] = at.axisZ;
        out[14] = look.turn * (0.75 + 0.5 * rng()) * (at.sense ?? 1);
        out[15] = look.gravity ?? 0.15;
        return true;
    };
    part.helix = (t, n, at, look) => {
        job.t = t;
        job.at = at;
        job.look = look;
        part.emit(t, n, placeHelix);
    };

    /**
     * A veil hanging in the air in front of the eye: specks over the lens's width (`tanX` its half
     * width a metre of depth) from `near` to `far` metres, between `lo` and `hi` of their depth over
     * the eye (plus `lift` metres), arriving over `over` seconds, drifting at (vx, vy, vz).
     */
    const placeVeil = (i, rng, out) => {
        const { at, look } = job;
        const d = at.near + (at.far - at.near) * rng() * rng();
        out[0] = at.eyeX + (rng() * 2 - 1) * at.tanX * d * 1.1;
        out[1] = at.eyeY + d * (at.lo + (at.hi - at.lo) * rng()) + (at.lift ?? 0);
        out[2] = at.eyeZ - d;
        out[3] = job.t + rng() * (look.over ?? 1);
        out[4] = (look.vx ?? 0) + (rng() - 0.5) * 0.3;
        out[5] = (look.vy ?? 0) * (0.5 + rng());
        out[6] = (look.vz ?? 0) + (rng() - 0.5) * 0.3;
        out[7] = between(look.life, rng());
        tint(out, look, rng);
        out[15] = look.gravity ?? 0;
        return true;
    };
    part.veil = (t, n, at, look) => {
        job.t = t;
        job.at = at;
        job.look = look;
        part.emit(t, n, placeVeil);
    };

    /** Drop every speck (a seek, a new session). */
    part.reset = () => {
        data.fill(0);
        cursor = 0;
        spawned = 0;
        dirty = true;
    };

    /** Upload what changed this frame. */
    part.commit = () => {
        if (!dirty) return;
        dirty = false;
        buffer.needsUpdate = true;
    };

    /** How many specks are in flight at time t (diagnostics and tests). */
    part.liveAt = (t) => {
        let live = 0;
        for (let s = 0; s < slots; s++) {
            const o = s * SPARK_STRIDE;
            if (data[o + 7] > 0 && t >= data[o + 3] && t < data[o + 3] + data[o + 7]) live += 1;
        }
        return live;
    };

    part.count = slots;
    part.data = data;
    return part;
}
