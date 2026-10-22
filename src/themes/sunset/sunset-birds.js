/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the flock a chain of clears calls across the light.
 *
 * Gulls in a loose skein come in from one edge of the frame, cross in front of the sun (the moon
 * by night) a little above it and fly on out of the other side, black against the fire with the
 * light catching the ends of their wings. Each is one instance of a small mesh (a body and two
 * wings that bend at the elbow); the wings beat in the vertex stage, each bird at its own pace
 * and sometimes gliding. Their paths are closed-form in the world's clock.
 *
 * The instances carry their own place and heading (aBird, aWing) and the vertex stage builds
 * the whole transform: a positionNode's output is final, so an instance matrix would be lost.
 *
 * A chain keeps calling: a flock called while one is still on its way in JOINS it (the newcomers
 * close up from behind, so the skein grows with the chain), and one called later sets out as a
 * second flight beside the first. Nothing ever restarts a flock in the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, max, min, mix, positionGeometry, sin, smoothstep, vec3, vec4,
} from 'three/tsl';
import { mulberry32, smooth } from './sunset-core.js';

/** How long a flock takes to cross, and how far from the eye it flies (metres). */
export const FLOCK_SECONDS = 22;
export const FLOCK_RANGE = 58;
/** Flights in the air at once (they share the instances), and how long one takes newcomers. */
export const FLIGHTS = 2;
export const JOIN_SECONDS = FLOCK_SECONDS * 0.55;
/** A bird that joins a flight closes up from this far behind (metres) over this long (seconds). */
const CATCH_BACK = 14;
const CATCH_SECONDS = 3;
/** A founding bird's join time: long before any clock. */
const FOUNDER = -1e9;
/** The wing's elbow, as a share of the half span. */
const ELBOW = 0.48;
const HALF_SPAN = 0.62;

/** A gull from above: the body along +z (forward), wings along ±x; aSpan = |x| / half span. */
export function buildBirdGeometry() {
    const half = HALF_SPAN;
    const tri = [];
    const quad = (a, b, c, d) => tri.push(a, b, c, a, c, d);
    // Body: a long diamond.
    tri.push([0, 0, 0.3], [0.05, 0.01, 0.0], [0, 0, -0.32]);
    tri.push([0, 0, 0.3], [0, 0, -0.32], [-0.05, 0.01, 0.0]);
    [1, -1].forEach((side) => {
        const elbow = half * ELBOW;
        // Inner wing: broad, its trailing edge swept back.
        quad([0.04 * side, 0, 0.07], [elbow * side, 0, 0.03], [elbow * side, 0, -0.07], [0.04 * side, 0, -0.1]);
        // Outer wing: narrowing to a swept tip.
        tri.push([elbow * side, 0, 0.03], [half * side, 0, -0.16], [elbow * side, 0, -0.07]);
    });
    const positions = new Float32Array(tri.length * 3);
    const span = new Float32Array(tri.length);
    tri.forEach((p, i) => {
        positions[i * 3] = p[0];
        positions[i * 3 + 1] = p[1];
        positions[i * 3 + 2] = p[2];
        span[i] = Math.abs(p[0]) / half;
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));
    geometry.instanceCount = 0;
    return geometry;
}

export function createFlock({ count, U, seed = 29 }) {
    const geometry = buildBirdGeometry();
    const place = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const wing = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    place.setUsage(THREE.DynamicDrawUsage);
    wing.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aBird', place);
    geometry.setAttribute('aWing', wing);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'sunset-birds';
    const aSpan = attribute('aSpan', 'float');
    const aBird = attribute('aBird', 'vec4');
    const aWing = attribute('aWing', 'vec4');
    material.positionNode = Fn(() => {
        const p = positionGeometry.toVar();
        // aBird: where the bird is (xyz) and its size. aWing: x the beat's phase, y its depth
        // (0 gliding), z the heading (radians, as the world's bearings), w how far it banks.
        const beat = sin(aWing.x);
        const lag = sin(aWing.x.sub(0.9));
        const a1 = beat.mul(0.62).mul(aWing.y).add(0.08);
        const a2 = lag.mul(0.75).mul(aWing.y).sub(0.05);
        const s = aSpan.mul(HALF_SPAN);
        const inner = min(s, HALF_SPAN * ELBOW);
        const outer = max(s.sub(HALF_SPAN * ELBOW), 0.0);
        const lift = inner.mul(sin(a1)).add(outer.mul(sin(a1.add(a2))));
        // Bank about the body, then turn to the heading (+z of the model flies that way).
        const cb = cos(aWing.w);
        const sb = sin(aWing.w);
        const y0 = p.y.add(lift);
        const bx = p.x.mul(cb).sub(y0.mul(sb));
        const by = p.x.mul(sb).add(y0.mul(cb));
        const ch = cos(aWing.z);
        const sh = sin(aWing.z);
        // Forward (+z) becomes (sin h, 0, −cos h); right (+x) becomes (cos h, 0, sin h).
        const wx = bx.mul(ch).add(p.z.mul(sh));
        const wz = bx.mul(sh).sub(p.z.mul(ch));
        return vec3(wx, by, wz).mul(aBird.w).add(aBird.xyz);
    })();
    material.colorNode = Fn(() => {
        // A silhouette: the sky's light on it faintly, the key light catching the wing's end.
        const { light } = U;
        const edge = smoothstep(0.55, 1.0, aSpan);
        const keyLight = mix(light.cloudRim, light.moonGlint, U.moonKey).mul(0.05);
        return vec4(light.ambient.mul(0.027).add(keyLight.mul(edge)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sunset-birds';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    const rand = mulberry32(seed + 101);
    /** Each bird's place in the skein and its own pace. */
    const birds = Array.from({ length: count }, (_, i) => {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        return {
            back: rank * (1.15 + rand() * 0.5) + rand() * 0.6,
            aside: side * rank * (0.75 + rand() * 0.35) + (rand() - 0.5) * 0.8,
            up: (rand() - 0.5) * 1.3 + rank * 0.1,
            pace: 2.6 + rand() * 0.9,
            phase: rand() * Math.PI * 2,
            glide: rand() * 10,
            wander: rand() * 6,
        };
    });
    /** The flights: each its own line across the light; `joined` is each bird's join time. */
    const flights = Array.from({ length: FLIGHTS }, () => ({
        at: -100, n: 0, az: 0, el: 0, dir: 1, joined: new Float64Array(count).fill(FOUNDER),
    }));
    const inAir = (f, clock) => {
        const s = clock - f.at;
        return f.n > 0 && s >= 0 && s <= FLOCK_SECONDS + 6;
    };
    /** Birds no other flight in the air is using. */
    const roomBeside = (f, clock) => {
        let used = 0;
        for (let k = 0; k < FLIGHTS; k += 1) {
            if (flights[k] !== f && inAir(flights[k], clock)) used += flights[k].n;
        }
        return Math.max(0, count - used);
    };
    /** Newcomers join `f`: the skein grows to `n`, the new birds closing up from behind. */
    const join = (f, n, clock) => {
        const next = Math.min(n, roomBeside(f, clock));
        for (let i = f.n; i < next; i += 1) f.joined[i] = clock;
        if (next > f.n) f.n = next;
    };

    return {
        mesh,
        count,
        /**
         * Call `n` birds across the light whose direction is `toward` (unit vector). A flight still
         * on its way in takes them (it grows to `n`); otherwise a free flight sets out; if every
         * flight is in the air and past taking newcomers, the youngest grows. Never a restart.
         */
        send(clock, n, toward, r = 0.5) {
            const want = Math.min(n, count);
            if (!(want > 0)) return;
            let joining = null;
            let free = null;
            let youngest = null;
            for (let k = 0; k < FLIGHTS; k += 1) {
                const f = flights[k];
                if (!inAir(f, clock)) {
                    if (!free) free = f;
                } else {
                    if (clock - f.at < JOIN_SECONDS && (!joining || f.at > joining.at)) joining = f;
                    if (!youngest || f.at > youngest.at) youngest = f;
                }
            }
            if (joining || !free) {
                join(joining || youngest, want, clock);
                return;
            }
            const other = flights.find((f) => f !== free && inAir(f, clock)) || null;
            free.at = clock;
            free.joined.fill(FOUNDER);
            free.n = Math.min(want, roomBeside(free, clock));
            free.az = Math.atan2(toward.x, -toward.z);
            const el = Math.asin(Math.max(-1, Math.min(1, toward.y)));
            // A little above the light, never into the sea, and in the picture when it is high; a
            // second flight keeps a line of its own, over or under the first, the same way across.
            let apart = 0;
            free.dir = r < 0.7 ? 1 : -1;
            if (other) {
                apart = other.el > 0.12 ? -0.04 : 0.05;
                free.dir = other.dir;
            }
            free.el = Math.min(0.3 + r * 0.05, Math.max(0.035, el + 0.025 + r * 0.03 + apart));
        },
        reset() {
            for (let k = 0; k < FLIGHTS; k += 1) {
                flights[k].at = -100;
                flights[k].n = 0;
            }
            geometry.instanceCount = 0;
        },
        airborne(clock) {
            let n = 0;
            for (let k = 0; k < FLIGHTS; k += 1) if (inAir(flights[k], clock)) n += flights[k].n;
            return n;
        },
        update(clock) {
            let at = 0;
            for (let k = 0; k < FLIGHTS; k += 1) {
                const flight = flights[k];
                if (!inAir(flight, clock)) continue;
                const s = clock - flight.at;
                // The leader's bearing sweeps across the light: from 32 degrees one side to 32 the other.
                const sweep = 0.56;
                const u = s / FLOCK_SECONDS;
                const lead = flight.az + flight.dir * (-sweep + 2 * sweep * u);
                const heading = lead + flight.dir * Math.PI * 0.5;
                const fx = Math.sin(heading);
                const fz = -Math.cos(heading);
                const sx = -fz;
                const sz = fx;
                const cx = Math.sin(lead) * FLOCK_RANGE;
                const cz = -Math.cos(lead) * FLOCK_RANGE;
                const grow = smooth(0, 1.2, s) * (1 - smooth(FLOCK_SECONDS + 4, FLOCK_SECONDS + 6, s));
                // A second flight's birds keep their own beat.
                const own = k * 1.7;
                for (let i = 0; i < flight.n && at < count; i += 1) {
                    const b = birds[i];
                    // A newcomer comes in from behind the skein and closes up to its place.
                    const late = clock - flight.joined[i];
                    const back = b.back + CATCH_BACK * (1 - smooth(0, CATCH_SECONDS, late));
                    const wob = Math.sin(clock * 0.6 + b.wander + own) * 0.5;
                    const y = 3.2 + Math.tan(flight.el) * FLOCK_RANGE + b.up
                        + Math.sin(clock * 0.45 + b.wander + own) * 0.4;
                    place.setXYZW(
                        at,
                        cx - fx * back + sx * (b.aside + wob),
                        y,
                        cz - fz * back + sz * (b.aside + wob),
                        1.8 * Math.max(0.001, grow * smooth(0, 1, late)),
                    );
                    // Bursts of beats and long glides.
                    const gliding = smooth(0.55, 0.85, Math.sin(clock * 0.31 + b.glide + own) * 0.5 + 0.5);
                    const bank = Math.sin(clock * 0.5 + b.wander + own) * 0.12;
                    wing.setXYZW(at, clock * b.pace + b.phase + own, 1 - gliding * 0.85, heading, bank);
                    at += 1;
                }
            }
            geometry.instanceCount = at;
            if (at > 0) {
                place.needsUpdate = true;
                wing.needsUpdate = true;
            }
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
