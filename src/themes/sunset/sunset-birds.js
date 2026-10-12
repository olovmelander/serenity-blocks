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
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, max, min, mix, positionGeometry, sin, smoothstep, vec3, vec4,
} from 'three/tsl';
import { mulberry32, smooth } from './sunset-core.js';

/** How long a flock takes to cross, and how far from the eye it flies (metres). */
export const FLOCK_SECONDS = 22;
export const FLOCK_RANGE = 58;
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
    const flight = {
        at: -100, n: 0, az: 0, el: 0, dir: 1,
    };

    return {
        mesh,
        count,
        /** Send `n` birds across the light whose direction is `toward` (unit vector). */
        send(clock, n, toward, r = 0.5) {
            flight.at = clock;
            flight.n = Math.min(n, count);
            flight.az = Math.atan2(toward.x, -toward.z);
            const el = Math.asin(Math.max(-1, Math.min(1, toward.y)));
            // A little above the light, never into the sea, and in the picture when it is high.
            flight.el = Math.min(0.3 + r * 0.05, Math.max(0.035, el + 0.025 + r * 0.03));
            flight.dir = r < 0.7 ? 1 : -1;
        },
        reset() {
            flight.at = -100;
            flight.n = 0;
            geometry.instanceCount = 0;
        },
        airborne(clock) {
            const s = clock - flight.at;
            return s >= 0 && s <= FLOCK_SECONDS + 6 ? flight.n : 0;
        },
        update(clock) {
            const s = clock - flight.at;
            if (!(s >= 0 && s <= FLOCK_SECONDS + 6) || flight.n === 0) {
                geometry.instanceCount = 0;
                return;
            }
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
            for (let i = 0; i < flight.n; i += 1) {
                const b = birds[i];
                const wob = Math.sin(clock * 0.6 + b.wander) * 0.5;
                const y = 3.2 + Math.tan(flight.el) * FLOCK_RANGE + b.up + Math.sin(clock * 0.45 + b.wander) * 0.4;
                place.setXYZW(
                    i,
                    cx - fx * b.back + sx * (b.aside + wob),
                    y,
                    cz - fz * b.back + sz * (b.aside + wob),
                    1.8 * Math.max(0.001, grow),
                );
                // Bursts of beats and long glides.
                const gliding = smooth(0.55, 0.85, Math.sin(clock * 0.31 + b.glide) * 0.5 + 0.5);
                const bank = Math.sin(clock * 0.5 + b.wander) * 0.12;
                wing.setXYZW(i, clock * b.pace + b.phase, 1 - gliding * 0.85, heading, bank);
            }
            geometry.instanceCount = flight.n;
            place.needsUpdate = true;
            wing.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
